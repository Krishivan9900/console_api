const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const phone = require('../src/phone');

// Evaluate model queries against fixture rows without opening a database connection.
class Query {
  constructor(rows) { this.rows = rows; this.matches = () => true; }
  and(predicate) { const previous = this.matches; this.matches = row => previous(row) && predicate(row); return this; }
  where(value) {
    if (typeof value === 'function') {
      const group = new Query(this.rows);
      value(group);
      return this.and(row => group.matches(row));
    }
    return this.and(row => Object.entries(value).every(([key, expected]) => row[key] === expected));
  }
  whereIn(key, values) { return this.and(row => values.includes(row[key])); }
  orWhereIn(key, values) { const previous = this.matches; this.matches = row => previous(row) || values.includes(row[key]); return this; }
  whereNull(key) { return this.and(row => row[key] == null); }
  async first() { return this.rows.find(row => this.matches(row)); }
}

function model(name, rows) {
  class BaseModel { query() { return new Query(rows); } }
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, `../src/app/models/${name}.model.ts`), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText, {
    exports, console: { log() {} },
    require(name) {
      if (name === '@surefy/models/base.model') return { BaseModel };
      if (name === '../../phone') return phone;
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  return exports.default;
}

test('WhatsApp and national phone numbers find the same user in new and legacy storage formats', async () => {
  for (const storedPhone of ['9372597458', '919372597458']) {
    const user = { id: 'fpo', phone: storedPhone };
    const users = model('user', [user]);
    for (const input of ['9372597458', '919372597458', '+91 93725 97458']) {
      assert.equal((await users.findByPhone(input)).id, 'fpo');
      assert.equal((await users.findByEmailOrPhone(input)).id, 'fpo');
    }
  }
});

test('10-digit numbers starting with 91 remain complete when looked up from WhatsApp', async () => {
  const users = model('user', [{ id: 'user', phone: '9123456789' }]);
  assert.equal((await users.findByPhone('9123456789')).id, 'user');
  assert.equal((await users.findByPhone('919123456789')).id, 'user');
});

test('national user phones still find WhatsApp contacts for registration metadata updates', async () => {
  const contacts = model('contact', [
    { id: 'deleted', phone_number: '9372597458', deleted_at: new Date() },
    { id: 'active', phone_number: '919372597458' },
  ]);
  assert.equal((await contacts.findByUserPhoneNumber('9372597458')).id, 'active');
});

test('email login and non-Indian international numbers retain their meaning', async () => {
  const users = model('user', [
    { id: 'phone-user', phone: '1234567890' },
    { id: 'email-user', email: 'owner1234567890@example.test' },
    { id: 'international-user', phone: '14155552671' },
    { id: 'deleted-user', phone: '9372597458', deleted_at: new Date() },
  ]);
  assert.equal((await users.findByEmailOrPhone('owner1234567890@example.test')).id, 'email-user');
  assert.equal((await users.findByPhone('+1 415 555 2671')).id, 'international-user');
  assert.equal(await users.findByPhone('4155552671'), undefined);
  assert.equal(await users.findByEmailOrPhone('919372597458'), undefined);
});
