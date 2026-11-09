const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { DatabaseSync } = require("node:sqlite");

function listing(parent, search = "", order = "last_activity") {
  let query;
  const context = vm.createContext({
    window: {}, Date, LogMixin: { logStart() {} }, $: () => ({}),
    UserPrefs: { get: () => order },
    Page: { site_info: { content: {} }, cmd(name, args) { query = args[0]; } },
    Text: { sqlEscape: text => text.replace(/'/g, "''") },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../js/TopicList.js"), "utf8"), context);
  const list = context.window.TopicList;
  list.parent_topic_uri = parent;
  list.topic_search_query = search;
  list.loadTopics();
  return query;
}

function database() {
  const db = new DatabaseSync(":memory:", { enableDoubleQuotedStringLiterals: true });
  db.exec("CREATE TABLE json (json_id INTEGER PRIMARY KEY, directory TEXT, file_name TEXT)");
  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, "../dbschema.json")));
  for (const [name, table] of Object.entries(schema.tables)) {
    db.exec(`CREATE TABLE ${name} (${table.cols.map(([col, type]) => `${col} ${type}`).join(",")})`);
  }
  db.exec(`INSERT INTO json VALUES (1,'alice.epix','data.json'), (2,'alice.epix','content.json'),
    (3,'bob.epix','data.json'), (4,'bob.epix','content.json')`);
  return db;
}

function add(db, id, title, parent = null, author = 1, type = "group") {
  db.prepare("INSERT INTO topic (topic_id,title,body,type,parent_topic_uri,added,json_id) VALUES (?,?, '',?,?,?,?)")
    .run(id, title, type, parent, 1700000000 + id, author);
}

test("empty root groups remain visible before adding and after deleting their last topic", () => {
  const db = database();
  try {
    add(db, 1, "Empty group");
    for (const sort of ["last_activity", "topic_creation", "comments_num", "votes_num"]) {
      const rows = db.prepare(listing(null, "", sort)).all();
      assert.equal(rows.length, 1, `empty group visible with ${sort}`);
      assert.equal(rows[0].last_action, 1700000001);
    }
    add(db, 2, "A topic", "1_alice.epix", 1, null);
    assert.equal(db.prepare(listing()).all()[0].row_topic_sub_title, "A topic");
    db.exec("DELETE FROM topic WHERE topic_id = 2");
    assert.equal(db.prepare(listing()).all().length, 1);
  } finally { db.close(); }
});

test("groups with the same numeric ID from different authors are distinct", () => {
  const db = database();
  try {
    add(db, 1, "Alice group");
    add(db, 1, "Bob group", null, 3);
    add(db, 2, "Alice child", "1_alice.epix", 1, null);
    add(db, 3, "Bob child", "1_bob.epix", 3, null);
    assert.deepEqual(db.prepare(listing()).all().map(row => row.row_topic_uri).sort(), ["1_alice.epix", "1_bob.epix"]);
  } finally { db.close(); }
});

test("empty nested groups appear once and populated groups are not duplicated", () => {
  const db = database();
  try {
    add(db, 1, "Parent");
    add(db, 2, "Nested group", "1_alice.epix");
    let rows = db.prepare(listing("1_alice.epix")).all();
    assert.equal(rows.filter(row => row.row_topic_uri === "2_alice.epix").length, 1);
    add(db, 3, "Grandchild", "2_alice.epix", 1, null);
    rows = db.prepare(listing("1_alice.epix")).all();
    assert.equal(rows.filter(row => row.row_topic_uri === "2_alice.epix").length, 1);
  } finally { db.close(); }
});

function uris(db, parent, search) {
  return db.prepare(listing(parent, search)).all().map(row => row.row_topic_uri).sort();
}

test("root group searches honor words, authors, and topic/group types", () => {
  const db = database();
  try {
    add(db, 1, "Garden group");
    add(db, 2, "Music group", null, 3);
    add(db, 3, "Garden topic", null, 1, null);
    assert.deepEqual(uris(db, null, "Garden type:groups"), ["1_alice.epix"]);
    assert.deepEqual(uris(db, null, "Garden type:topics"), ["3_alice.epix"]);
    assert.deepEqual(uris(db, null, "author:bob type:group"), ["2_bob.epix"]);
    assert.deepEqual(uris(db, null, "unmatched"), []);
  } finally { db.close(); }
});

test("nested searches filter children but retain parent metadata", () => {
  const db = database();
  try {
    add(db, 1, "Parent");
    add(db, 2, "Garden group", "1_alice.epix");
    add(db, 3, "Music group", "1_alice.epix", 3);
    add(db, 4, "Garden topic", "1_alice.epix", 1, null);
    assert.deepEqual(uris(db, "1_alice.epix", "Garden"), ["1_alice.epix", "2_alice.epix", "4_alice.epix"]);
    assert.deepEqual(uris(db, "1_alice.epix", "unmatched"), ["1_alice.epix"]);
    assert.deepEqual(uris(db, "1_alice.epix", "author:bob"), ["1_alice.epix", "3_bob.epix"]);
    assert.deepEqual(uris(db, "1_alice.epix", "type:group"), ["1_alice.epix", "2_alice.epix", "3_bob.epix"]);
    assert.deepEqual(uris(db, "1_alice.epix", "type:topics"), ["1_alice.epix", "4_alice.epix"]);
    assert.deepEqual(uris(db, "1_alice.epix", "date-after:2099-01-01"), ["1_alice.epix"]);
  } finally { db.close(); }
});

test("comment thresholds retain parent metadata while filtering empty and populated groups", () => {
  const db = database();
  try {
    add(db, 1, "Parent");
    add(db, 2, "Empty group", "1_alice.epix");
    add(db, 3, "Populated group", "1_alice.epix");
    add(db, 4, "Child", "3_alice.epix", 1, null);
    db.exec("INSERT INTO comment (comment_id,topic_uri,body,added,json_id) VALUES (5,'4_alice.epix','Hello',1700000005,1)");
    assert.deepEqual(uris(db, "1_alice.epix", "comments:>0"), ["1_alice.epix", "3_alice.epix"]);
    assert.deepEqual(uris(db, "1_alice.epix", "comments:>10"), ["1_alice.epix"]);
    assert.deepEqual(uris(db, "1_alice.epix", "comments:=0"), ["1_alice.epix", "2_alice.epix"]);
  } finally { db.close(); }
});
