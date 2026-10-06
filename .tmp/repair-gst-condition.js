require('dotenv').config();
require('ts-node/register');
const fs = require('node:fs');
const path = require('node:path');
const { evaluateConditions, getConditionBranch } = require('../src/app/services/chatbot/engine/condition.logic');
const knex = require('knex')({
  client: 'pg',
  connection: { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 8000 },
  pool: { min: 0, max: 1 }, acquireConnectionTimeout: 10000,
});
const nodeId = '1795a684-4310-4a85-9161-4447ccf87d17';
const botId = '7d60009f-3e57-4f82-995b-0ff32b8f673b';
const faultyEdgeId = 'a422961a-e9c3-4d31-9773-912b429e59cb';
const falseTarget = '4258501f-0c1c-4424-8b17-792f5eeef0de';
const trueTarget = '8f0637a0-1ab7-4381-aef2-4f52239309e1';
const parse = value => typeof value === 'string' ? JSON.parse(value) : value;

(async () => {
  try {
    await knex.transaction(async trx => {
      const node = await trx('chat_bot_node').where({ id: nodeId, chatBotId: botId }).forUpdate().first();
      const edges = await trx('chat_bot_edge').where({ source: nodeId, chatBotId: botId }).forUpdate().select('*');
      if (!node) throw new Error('The expected condition node no longer exists');
      const data = parse(node.data);
      const condition = data.attributes?.conditions?.find(rule => rule.field === '{{http_response.success}}' && rule.comparator === 'equals');
      const faultyEdge = edges.find(edge => edge.id === faultyEdgeId);
      if (!condition || condition.value !== '' || faultyEdge?.target !== trueTarget || getConditionBranch(faultyEdge) !== false ||
          !edges.some(edge => edge.target === falseTarget && getConditionBranch(edge) === false)) {
        throw new Error('Flow changed since inspection; no repair was applied');
      }
      fs.writeFileSync(path.join(__dirname, 'gst-condition-before-repair.json'), JSON.stringify({
        node: { id: node.id, data: node.data }, edge: { id: faultyEdge.id, target: faultyEdge.target },
      }, null, 2), { flag: 'wx' });
      condition.value = 'true';
      const repairedEdges = edges.map(edge => edge.id === faultyEdgeId ? { ...edge, target: falseTarget } : edge);
      for (const success of [true, false]) {
        const evaluation = evaluateConditions(data.attributes, { http_response: { success, data: { valid: success } } });
        const targets = [...new Set(repairedEdges.filter(edge => getConditionBranch(edge) === evaluation).map(edge => edge.target))];
        if (evaluation !== success || targets.length !== 1 || targets[0] !== (success ? trueTarget : falseTarget)) {
          throw new Error('Repaired flow failed branch validation');
        }
      }
      await trx('chat_bot_node').where({ id: nodeId, chatBotId: botId }).update({ data: JSON.stringify(data) });
      await trx('chat_bot_edge').where({ id: faultyEdgeId, source: nodeId, chatBotId: botId }).update({ target: falseTarget });
    });
    const node = await knex('chat_bot_node').select('data').where({ id: nodeId }).first();
    const edges = await knex('chat_bot_edge').select('target', 'label', 'data').where({ source: nodeId });
    for (const success of [true, false]) {
      const evaluation = evaluateConditions(parse(node.data).attributes, { http_response: { success } });
      const targets = [...new Set(edges.filter(edge => getConditionBranch(edge) === evaluation).map(edge => edge.target))];
      if (targets.length !== 1 || targets[0] !== (success ? trueTarget : falseTarget)) throw new Error('Saved flow verification failed');
      console.log(JSON.stringify({ httpSuccess: success, evaluation, destination: success ? 'registration' : 'failure message', verified: true }));
    }
    const constraints = await knex.raw("SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid = 'users'::regclass AND conname = 'users_role_check'");
    console.log(JSON.stringify({ userRoleConstraints: constraints.rows }));
  } catch (error) {
    console.error('Repair error:', error.code || error.message);
    process.exitCode = 1;
  } finally { await knex.destroy(); }
})();
