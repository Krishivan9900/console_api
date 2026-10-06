require('dotenv').config();
require('ts-node/register');
const fs = require('node:fs');
const path = require('node:path');
const knex = require('knex')({
  client: 'pg', connection: { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 8000 },
  pool: { min: 0, max: 1 }, acquireConnectionTimeout: 10000,
});
const parse = value => typeof value === 'string' ? JSON.parse(value) : value;
const phone = '919869650435';
const companyId = 'e964154b-7ed9-423d-bee3-c6e190dc0ab2';
const botId = '7d60009f-3e57-4f82-995b-0ff32b8f673b';
const menuIds = ['0194bdc1-e326-4ff7-a135-9a15cbb051c7', 'b6af02c0-5425-4dfc-ab3d-b631dca1740e', '74733528-2cdc-4dda-bf9f-0766d6e692af'];
(async () => {
  try {
    await knex.transaction(async trx => {
      const menus = await trx('chat_bot_node').where({ chatBotId: botId }).whereIn('id', menuIds).forUpdate();
      const session = await trx('chat_sessions').where({ id: '601e6e42-658e-4b8b-8abc-abe4b6f1e111', phone_number: phone, chatbot_id: botId }).forUpdate().first();
      const stored = await trx('stored_session_data').where({ id: '2cab0460-915e-41a9-b1eb-dbb84a0b5673', phone_number: phone, company_id: companyId }).forUpdate().first();
      const user = await trx('users').where({ id: 'e7f06885-d670-44a4-abd3-5d46f721168e', phone, company_id: companyId }).whereNull('deleted_at').forUpdate().first();
      const contact = await trx('contacts').where({ id: '500e7723-19d8-466c-aaf4-3e1c2234d233', phone_number: phone, company_id: companyId }).whereNull('deleted_at').forUpdate().first();
      if (menus.length !== 3 || !session || !stored || !user || !contact) throw new Error('Expected records changed; no repair applied');
      const variables = parse(session.variables);
      const storedData = parse(stored.data);
      if (variables.role || variables.details?.role !== 'fpo' || storedData.role !== 'fpo' || user.role_type !== 'fpo' || contact.role_type !== 'fpo') {
        throw new Error('Role fields changed since inspection; no repair applied');
      }
      for (const menu of menus) {
        const data = parse(menu.data);
        if (data.key !== '@whatsapp/send-list-message' || (data.attributes.variable && data.attributes.variable !== 'role')) {
          throw new Error('Role menu configuration changed; no repair applied');
        }
      }
      const replies = await trx('messages').select('content').where({ direction: 'inbound' })
        .whereRaw("content->>'from' = ?", [phone]).where('created_at', '>=', session.created_at).where('created_at', '<=', stored.created_at)
        .whereRaw("content->'interactive'->>'type' = ?", ['list_reply']).orderBy('created_at', 'desc');
      const selection = parse(replies[0]?.content)?.interactive?.list_reply;
      if (selection?.id !== 'row_1781057808417_syppf5' || selection.title !== 'Trader') throw new Error('Trader selection could not be verified');
      fs.writeFileSync(path.join(__dirname, 'selected-role-before-repair.json'), JSON.stringify({
        menus: menus.map(menu => ({ id: menu.id, data: menu.data })),
        session: { id: session.id, role: variables.role, detailsRole: variables.details?.role },
        stored: { id: stored.id, role: storedData.role },
        user: { id: user.id, role: user.role, role_type: user.role_type },
        contact: { id: contact.id, role_type: contact.role_type },
      }, null, 2), { flag: 'wx' });
      for (const menu of menus) {
        const data = parse(menu.data);
        data.attributes.variable = 'role';
        await trx('chat_bot_node').where({ id: menu.id, chatBotId: botId }).update({ data: JSON.stringify(data) });
      }
      variables.role = selection.title;
      variables.details = { ...variables.details, role: selection.title };
      storedData.role = 'trader';
      await trx('chat_sessions').where({ id: session.id }).update({ variables: JSON.stringify(variables) });
      await trx('stored_session_data').where({ id: stored.id }).update({ data: JSON.stringify(storedData) });
      await trx('users').where({ id: user.id }).update({ role: 'trader', role_type: 'trader' });
      await trx('contacts').where({ id: contact.id }).update({ role_type: 'trader' });
    });
    const user = await knex('users').select('role','role_type').where({ phone, company_id: companyId }).whereNull('deleted_at').first();
    const session = await knex('chat_sessions').select('variables').where({ id: '601e6e42-658e-4b8b-8abc-abe4b6f1e111' }).first();
    const menus = await knex('chat_bot_node').select('data').whereIn('id', menuIds);
    if (user.role !== 'trader' || user.role_type !== 'trader' || parse(session.variables).role !== 'Trader' || menus.some(menu => parse(menu.data).attributes.variable !== 'role')) {
      throw new Error('Saved role verification failed');
    }
    console.log(JSON.stringify({ phone: '9869650435', recordedSelection: 'Trader', consoleRole: user.role, consoleRoleType: user.role_type, configuredRoleMenus: menus.length, verified: true }));
  } catch (error) { console.error('Selected role repair failed:', error.code || error.message); process.exitCode = 1; }
  finally { await knex.destroy(); }
})();
