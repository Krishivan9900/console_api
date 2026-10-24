require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const knex = require('knex')({
  client: 'pg', connection: { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 8000 },
  pool: { min: 0, max: 1 }, acquireConnectionTimeout: 10000,
});
const externalUserId = '6ac48aa0b29395f555c18267';
const localUserId = 'a5431216-08b3-4d2b-932c-4276d3635530';
const companyId = 'e964154b-7ed9-423d-bee3-c6e190dc0ab2';
(async () => {
  try {
    const result = await knex.transaction(async trx => {
      const user = await trx('users').select('id', 'user_id').where({ id: localUserId, name: 'Ramesh Patil', phone: '9876543210', company_id: companyId }).whereNull('deleted_at').forUpdate().first();
      if (!user || user.user_id) throw new Error('User link changed since inspection; no repair applied');
      const contacts = await trx('contacts').select('id', 'reference_id').where({ company_id: companyId })
        .whereIn('phone_number', ['9876543210', '919876543210', '+919876543210']).whereNull('deleted_at').forUpdate();
      if (contacts.some(contact => contact.reference_id && contact.reference_id !== externalUserId)) {
        throw new Error('A contact has a different external link; no repair applied');
      }
      fs.writeFileSync(path.join(__dirname, 'ramesh-link-before-repair.json'), JSON.stringify({ user, contacts }, null, 2), { flag: 'wx' });
      await trx('users').where({ id: localUserId }).update({ user_id: externalUserId });
      if (contacts.length) await trx('contacts').whereIn('id', contacts.map(contact => contact.id)).update({ reference_id: externalUserId });
      return { contactsUpdated: contacts.length };
    });
    const saved = await knex('users').select('user_id').where({ id: localUserId }).first();
    if (saved.user_id !== externalUserId) throw new Error('Saved link verification failed');
    console.log(JSON.stringify({ name: 'Ramesh Patil', phone: '9876543210', user_id: saved.user_id, ...result, verified: true }));
  } catch (error) { console.error('Ramesh link repair failed:', error.code || error.message); process.exitCode = 1; }
  finally { await knex.destroy(); }
})();
