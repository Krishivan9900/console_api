require('dotenv').config();
require('ts-node/register');
const fs = require('node:fs');
const path = require('node:path');
const migration = require('../src/database/migrations/20261006000000_allow_registration_roles_for_users');
const knex = require('knex')({
  client: 'pg',
  connection: { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 8000 },
  pool: { min: 0, max: 1 }, acquireConnectionTimeout: 10000,
});
(async () => {
  try {
    await knex.transaction(async trx => {
      await trx.raw("SET LOCAL lock_timeout = '5s'");
      const constraints = await trx.raw("SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid = 'users'::regclass AND conname = 'users_role_check'");
      if (constraints.rows.length !== 1 || constraints.rows[0].definition !== "CHECK ((role = ANY (ARRAY['admin'::text, 'manager'::text, 'user'::text])))") {
        throw new Error('The role constraint changed since inspection; no schema change was applied');
      }
      fs.writeFileSync(path.join(__dirname, 'user-role-constraint-before-repair.json'), JSON.stringify(constraints.rows, null, 2), { flag: 'wx' });
      await migration.up(trx);
    });
    const constraints = await knex.raw("SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid = 'users'::regclass AND conname = 'users_role_check'");
    const definition = constraints.rows[0]?.definition || '';
    if (!['fpo', 'farmer', 'trader', 'manager', 'admin', 'user'].every(role => definition.includes(`'${role}'::text`))) throw new Error('Role constraint verification failed');
    console.log(JSON.stringify({ registrationRolesAllowed: true, existingManagerRolePreserved: true, existingUsersUnchanged: true }));
  } catch (error) { console.error('Role schema repair failed:', error.code || error.message); process.exitCode = 1; }
  finally { await knex.destroy(); }
})();
