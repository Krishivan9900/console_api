const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function runtime({ saved = false, redisError = false } = {}) {
  const source = ts.createSourceFile('message.ts', fs.readFileSync(path.join(__dirname, '../src/app/services/message.service.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
  const method = source.statements.find(ts.isClassDeclaration).members.find(m => m.name?.getText(source) === 'claimInboundMessage');
  let claims = 0;
  const redisKeys = new Set();
  const service = vm.runInNewContext(ts.transpileModule(`new class { ${method.getText(source)} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText, {
    INBOUND_DEDUPE_TTL_SECONDS: 86400, console: { error() {} },
    MessageModel: { findByWamid: async () => saved ? { id: 'saved-message' } : null },
    redisConnection: { set: async key => {
      claims++;
      if (redisError) throw new Error('Redis unavailable');
      if (redisKeys.has(key)) return null;
      redisKeys.add(key); return 'OK';
    } },
  });
  return { service, claims: () => claims };
}

test('saved WAMIDs are ignored after Redis dedupe expiry without acquiring another claim', async () => {
  const rt = runtime({ saved: true });
  assert.equal(await rt.service.claimInboundMessage('old-upload'), false);
  assert.equal(rt.claims(), 0);
});

test('concurrent API nodes claim a new inbound message only once', async () => {
  const rt = runtime();
  const results = await Promise.all([rt.service.claimInboundMessage('new-upload'), rt.service.claimInboundMessage('new-upload')]);
  assert.equal(results.filter(Boolean).length, 1);
});
