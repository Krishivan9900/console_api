const assert = require('node:assert/strict');
const { test } = require('node:test');
const { runtime } = require('./helpers/fpo-import-runtime');

test('spreadsheet webhook imports once and finishes the upload step with only a final summary', async () => {
  const rt = runtime();
  await rt.receive();
  await rt.receive();
  assert.equal(rt.calls.imported.length, 1);
  assert.equal(rt.calls.imported[0][1], rt.number);
  assert.equal(rt.calls.imported[0][2], rt.phone);
  assert.equal(rt.calls.normal.length, 0);
  assert.equal(rt.calls.sent.length, 1);
  assert.equal(rt.calls.sent[0].text, 'Contact import complete.\n3 Farmer');
  assert.equal(rt.session.current_node_id, 'services');
  assert.equal(rt.session.variables.excel_file.filename, 'fpo-leads.xlsx');
  assert.equal(rt.session.variables.email, 'fpo@example.test');
  assert.equal(rt.calls.updates.length, 1);
});

test('failed or partial spreadsheet imports stay at the upload prompt', async () => {
  for (const options of [
    { importError: true },
    { result: { success: false, imported_count: 2, failed_count: 1, role_counts: { farmer: 2 } } },
    { result: { success: false, imported_count: 0, failed_count: 3, role_counts: {} } },
  ]) {
    const rt = runtime(options);
    await rt.receive();
    assert.equal(rt.calls.sent.length, 1);
    assert.match(rt.calls.sent[0].text, /try again|upload it again/);
    assert.equal(rt.session.current_node_id, 'upload');
    assert.equal(rt.calls.updates.length, 0);
  }
});

test('an upload on one receiving number cannot advance a session on another number', async () => {
  const rt = runtime({ sessionNumber: 'old-number' });
  await rt.receive();
  assert.equal(rt.calls.lookups[0][1], rt.number);
  assert.equal(rt.session.current_node_id, 'upload');
  assert.equal(rt.calls.sent.length, 1);
});

test('ambiguous upload destinations never choose an arbitrary service', async () => {
  const rt = runtime();
  rt.bot.edges.push({ source: 'upload', target: 'other-menu' });
  await rt.receive();
  assert.equal(rt.calls.updates.length, 0);
});

test('subsequent chatbot nodes are not executed automatically after importing', async () => {
  const rt = runtime({ continuationError: true });
  await rt.receive();
  assert.equal(rt.calls.sent.length, 1);
  assert.match(rt.calls.sent[0].text, /Contact import complete/);
  assert.equal([...rt.records.values()][0].status, 'completed');
});
