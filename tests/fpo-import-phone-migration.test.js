const assert = require('node:assert/strict');
const { test } = require('node:test');
const knex = require('knex');
const { moduleFrom } = require('./helpers/fpo-import-runtime');
const migration = moduleFrom('src/database/migrations/20261103000000_allow_missing_imported_farmer_phone.ts', {});

test('phone migration drops NOT NULL for current and legacy session tables without changing user phone uniqueness', async () => {
  const compiler = knex({ client: 'pg' });
  try {
    for (const existingTables of [['stored_session_data'], ['stored_sessiond_data'], ['stored_session_data', 'stored_sessiond_data'], []]) {
      const sql = [];
      await migration.up({ schema: {
        hasTable: async name => existingTables.includes(name),
        alterTable: async (name, alter) => sql.push(...compiler.schema.alterTable(name, alter).toSQL().map(query => query.sql)),
      } });
      for (const name of existingTables) {
        assert(sql.includes(`alter table "${name}" alter column "phone_number" drop not null`));
      }
      assert(sql.every(query => !/delete|drop table|users/i.test(query)));
      assert.equal(existingTables.length === 0, sql.length === 0);
    }
  } finally {
    await compiler.destroy();
  }
});
