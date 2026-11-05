const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require('node:path').join(__dirname, '../js/lib/epixkit.js'), 'utf8');
const address = '0x1111111111111111111111111111111111111111';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function setup(request, origin = 'http://127.0.0.1:42222') {
  const elements = new Map();
  class Element {
    children = []; style = {}; listeners = {}; _html = '';
    appendChild(child) { this.children.push(child); if (child.id) elements.set(child.id, child); }
    set innerHTML(value) {
      this._html = value; this.children = [];
      for (const match of value.matchAll(/id="([^"]+)"/g)) elements.set(match[1], new Element());
    }
    get innerHTML() { return this._html || this.children.map(child => child.textContent || '').join(''); }
    addEventListener(name, fn) { this.listeners[name] = fn; }
    querySelector(selector) {
      const key = this.id + selector;
      if (!elements.has(key)) elements.set(key, new Element());
      return elements.get(key);
    }
  }
  const events = new Map(), storage = new Map(), calls = [];
  const context = {
    console, Event, Promise, setTimeout, clearTimeout,
    document: { head: new Element(), body: new Element(), createElement: () => new Element(), createTextNode: text => ({ textContent: text }), getElementById: id => elements.get(id) },
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    origin,
    addEventListener(name, fn) { events.set(name, fn); },
    dispatchEvent() {},
  };
  context.window = context;
  if (request) context.ethereum = { isMetaMask: true, request(args) { calls.push(args); return request(args); } };
  vm.runInNewContext(source, context);
  context.EpixKit.init({ chainId: '0x77c', requestTimeoutMs: 30 });
  async function connect() {
    const result = context.EpixKit.connect().then(value => ({ value }), error => ({ error }));
    await delay(175);
    const list = elements.get('epixkit-list');
    if (list.children.length) list.children[0].onclick();
    await delay(0);
    return { result };
  }
  const close = () => elements.get('epixkit-modal').querySelector('.epixkit-close').listeners.click();
  return { context, elements, calls, storage, connect, close };
}

const success = ({ method }) => Promise.resolve(method === 'eth_accounts' || method === 'eth_requestAccounts' ? [address] : null);

test('an unresponsive wallet times out, explains restricted frames, and can be retried', async () => {
  let respond = false;
  const t = setup(args => respond ? success(args) : new Promise(() => {}), 'null');
  const first = await t.connect();
  assert.match((await first.result).error.message, /restricted frame/);
  assert.equal(t.context.EpixKit.isConnected(), false);
  assert.match(t.elements.get('epixkit-list').innerHTML, /desktop EpixNet browser/);
  respond = true;
  const retry = await t.connect();
  assert.equal((await retry.result).value.address, address);
  assert.equal(t.context.EpixKit.isConnected(), true);
  assert.deepEqual(t.calls.map(call => call.method), ['eth_requestAccounts', 'eth_requestAccounts', 'wallet_switchEthereumChain', 'eth_accounts']);
});

test('closing a pending connection settles it and ignores a late wallet approval', async () => {
  let release;
  const t = setup(() => new Promise(resolve => { release = resolve; }));
  const first = await t.connect();
  t.close();
  assert.equal((await first.result).error.message, 'User cancelled');
  release([address]); await delay(5);
  assert.equal(t.context.EpixKit.isConnected(), false);
  assert.equal(t.storage.size, 0);
  assert.equal(t.calls.length, 1);
  assert.equal(t.elements.get('epixkit-modal').style.display, 'none');
});

test('network switching also times out instead of leaving a spinner', async () => {
  const t = setup(args => args.method === 'wallet_switchEthereumChain' ? new Promise(() => {}) : success(args));
  const connection = await t.connect();
  assert.match((await connection.result).error.message, /wallet did not respond/);
  assert.equal(t.context.EpixKit.isConnected(), false);
});

test('unknown chains are added and the connected account is retained', async () => {
  const t = setup(args => args.method === 'wallet_switchEthereumChain' ? Promise.reject({ code: 4902 }) : success(args));
  const connection = await t.connect();
  assert.equal((await connection.result).value.address, address);
  assert.deepEqual(t.calls.map(call => call.method), ['eth_requestAccounts', 'wallet_switchEthereumChain', 'wallet_addEthereumChain', 'eth_accounts']);
});

test('an empty account list is an error, not a successful connection', async () => {
  const t = setup(args => args.method === 'eth_accounts' ? Promise.resolve([]) : success(args));
  const connection = await t.connect();
  assert.match((await connection.result).error.message, /did not share an account/);
  assert.equal(t.context.EpixKit.isConnected(), false);
});

test('the picker and no-wallet dialog can both be cancelled', async () => {
  for (const provider of [success, null]) {
    const t = setup(provider);
    const result = t.context.EpixKit.connect().catch(error => error.message);
    await delay(175); t.close();
    assert.match(await result, /User cancelled|No wallet detected/);
    assert.equal(t.calls.length, 0);
  }
});

test('a second simultaneous connection cannot replace the first request', async () => {
  const t = setup(() => new Promise(() => {}));
  const connection = await t.connect();
  await assert.rejects(t.context.EpixKit.connect(), /already in progress/);
  t.close(); await connection.result;
  assert.equal(t.calls.length, 1);
});
