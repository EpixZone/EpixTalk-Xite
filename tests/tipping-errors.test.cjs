const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const ethers = require("../js/lib/ethers.umd.min.js");

async function fixture(error) {
  const elements = new Map();
  const calls = [];
  const $ = selector => {
    if (!elements.has(selector)) {
      const element = { events: {}, value: "", textValue: "", textHistory: [], length: 0 };
      for (const method of ["hide", "show", "css", "focus", "empty", "append", "closest", "addClass", "removeClass"]) {
        element[method] = () => element;
      }
      element.on = (name, callback) => { element.events[name] = callback; return element; };
      element.val = value => value === undefined ? element.value : (element.value = value, element);
      element.text = value => {
        if (value === undefined) return element.textValue;
        element.textValue = value;
        element.textHistory.push(value);
        return element;
      };
      element.each = () => element;
      elements.set(selector, element);
    }
    return elements.get(selector);
  };
  let options;
  const context = {
    window: {}, document: { getElementById: () => null }, $, console,
    setTimeout: fn => fn(),
    Page: { chainEvmRpcUrl: async () => "https://rpc.test", chainBlockExplorerUrl: async () => "https://scan.test" },
    EpixKit: { init: value => { options = value; } },
    ethers: {
      ...ethers,
      JsonRpcProvider: class {},
      BrowserProvider: class { async getSigner() { return {}; } },
      Contract: class {
        async getContentInfo() { return { totalAmount: 0n, uniqueTippers: 0, topCount: 0, recentCount: 0 }; }
        async getTipperCount() { return 1; }
        async tipByXid(...args) {
          calls.push(args);
          if (error) throw error;
          return { wait: async () => { calls.push("confirmed"); } };
        }
      },
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../js/utils/Tipping.js"), "utf8"), context);
  context.window.Tipping.init();
  await new Promise(resolve => setImmediate(resolve));
  await options.onReconnect({ provider: {}, address: "0x" + "11".repeat(20), walletName: "Test Wallet" });
  context.window.Tipping.openTipModal("0x" + "22".repeat(32), "recipient", "epix");
  $(".tip-modal-amount").val("1.234567890123456789");
  $(".tip-modal-send").events.click();
  await new Promise(resolve => setImmediate(resolve));
  return { $, calls };
}

test("Tip displays the node's insufficient-balance error inside an ethers CALL_EXCEPTION", async () => {
  const { $ } = await fixture({
    code: "CALL_EXCEPTION", reason: null, shortMessage: "missing revert data",
    message: 'missing revert data (transaction={data:"private fixture"})',
    info: { error: { code: -32000, message: "rpc error: code = Unknown desc = insufficient balance for transfer" } },
  });
  assert.equal($(".tip-modal-error").textValue, "Not enough EPIX to cover this tip and the transaction fee.");
});

test("Tip displays decoded contract reasons before generic ethers text", async () => {
  const { $ } = await fixture({ code: "CALL_EXCEPTION", reason: "xID: name not found", shortMessage: "execution reverted" });
  assert.equal($(".tip-modal-error").textValue, "xID: name not found");
});

test("Tip reads nested RPC reasons and renders HTML-shaped text without markup", async () => {
  const { $ } = await fixture({
    code: "UNKNOWN_ERROR", shortMessage: "could not coalesce error",
    info: { error: { code: -32000, message: '<img src=x onerror="bad()"> execution reverted' } },
  });
  assert.equal($(".tip-modal-error").textValue, '<img src=x onerror="bad()"> execution reverted');
});

for (const code of [4001, "ACTION_REJECTED"]) {
  test(`Tip treats rejected wallet requests as cancellation (${code})`, async () => {
    const { $ } = await fixture({ code, message: "user rejected request" });
    assert.equal($(".tip-modal-error").textValue, "Tip cancelled.");
  });
}

test("Tip avoids displaying ethers transaction and request details", async () => {
  const { $ } = await fixture({ message: 'rpc failed (error={secret:"fixture"}, payload={data:"private fixture"})' });
  assert.equal($(".tip-modal-error").textValue, "rpc failed");
});

test("Tip bounds an untrusted RPC message", async () => {
  const { $ } = await fixture({ info: { error: { message: "x".repeat(1000) } } });
  assert.equal($(".tip-modal-error").textValue.length, 240);
});

test("Tip uses a safe fallback for an unknown error shape", async () => {
  const { $ } = await fixture({ info: { error: { message: { private: "fixture" } } } });
  assert.equal($(".tip-modal-error").textValue, "Transaction failed");
});

test("Tip keeps the exact amount and recipient and waits for confirmation on success", async () => {
  const { $, calls } = await fixture();
  assert.equal(calls.length, 2);
  assert.equal(calls[0][0], "0x" + "22".repeat(32));
  assert.equal(calls[0][1], "recipient");
  assert.equal(calls[0][2], "epix");
  assert.equal(calls[0][3].value, 1234567890123456789n);
  assert.equal(calls[1], "confirmed");
  assert.equal($(".tip-modal-error").textValue, "");
  assert.ok($(".tip-modal-success").textHistory.includes("Tip sent! 1.23 EPIX"));
});
