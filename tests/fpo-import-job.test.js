const assert = require('node:assert/strict');
const { test } = require('node:test');
const { runtime } = require('./helpers/fpo-import-runtime');

test('10 rows import immediately; 11 rows use the Excel queue with two progress updates and one completion', async () => {
  const small = runtime();
  assert.equal((await small.submit(10)).queued, false);
  assert.equal(small.calls.queued.length, 0);
  assert.equal(small.calls.rows.length, 10);

  const rt = runtime({ count: 11 });
  await rt.receive();
  assert.equal(rt.calls.imported.length, 0);
  assert.equal(rt.calls.sent.length, 0);
  assert.equal(rt.calls.normal.length, 0);
  assert.equal(rt.calls.queued.length, 1);
  const [, data, options] = rt.calls.queued[0];
  assert.equal(data.kind, 'fpo_leads');
  assert.equal(options.jobId, data.jobId);
  assert(data.fileBase64);
  assert.equal(data.filePath, undefined);
  await rt.service.processFpoLeadImport(data);
  assert.equal(rt.calls.rows.length, 11);
  assert.equal(rt.calls.sent.length, 3);
  assert.equal(rt.calls.sent[0].text, 'Contact import: 27% processed.\n3 Farmer added.\n3 of 11 contacts stored.');
  assert.equal(rt.calls.sent[1].text, 'Contact import: 54% processed.\n6 Farmer added.\n6 of 11 contacts stored.');
  assert.equal(rt.calls.sent[2].text, 'Contact import complete: 100%.\n11 Farmer added.');
  const record = rt.records.get(data.jobId);
  assert.equal(record.job_type, 'fpo_leads_import');
  assert.equal(record.status, 'completed');
  assert.equal(record.successful_rows, 11);
  assert.equal(record.processed_rows, 11);
  assert.equal(record.progress_percentage, 100);
});

test('concurrent deliveries and late redeliveries create only one import and one final summary', async () => {
  const rt = runtime();
  const [first, second] = await Promise.all([rt.submit(11), rt.submit(11)]);
  assert.equal(first.job_id, second.job_id);
  assert.equal(rt.calls.queued.length, 1);
  const data = rt.calls.queued[0][1];
  await rt.service.processFpoLeadImport(data);
  await rt.service.processFpoLeadImport(data);
  assert.equal((await rt.submit(11)).duplicate, true);
  assert.equal(rt.calls.rows.length, 11);
  assert.equal(rt.calls.queued.length, 1);
  assert.equal(rt.calls.sent.length, 3);
});

test('worker retry resumes checkpointed rows and retains correct counts', async () => {
  const rt = runtime();
  await rt.submit(11);
  const data = rt.calls.queued[0][1];
  await assert.rejects(rt.service.processFpoLeadImport(data, async percentage => {
    if (percentage >= 18) throw new Error('Worker interrupted');
  }), /Worker interrupted/);
  assert.equal(rt.calls.rows.length, 2);
  assert.equal(rt.calls.sent.length, 0);
  await rt.service.processFpoLeadImport(data);
  assert.equal(rt.calls.rows.length, 11);
  assert.equal(rt.records.get(data.jobId).result.imported_count, 11);
  assert.equal(rt.records.get(data.jobId).result.role_counts.farmer, 11);
  assert.equal(rt.calls.sent.length, 3);
});

test('delayed completion cannot advance a replaced session or another current node', async () => {
  for (const change of [{ id: 'new-session' }, { current_node_id: 'booking' }]) {
    const rt = runtime();
    await rt.submit(11);
    Object.assign(rt.session, change);
    await rt.service.processFpoLeadImport(rt.calls.queued[0][1]);
    assert.equal(rt.calls.sent.length, 3);
    assert.equal(rt.calls.updates.length, 0);
  }
});

test('unconfirmed completion sends never reimport, repeat a summary or send a later menu', async () => {
  for (const options of [{ sendFailure: true }, { sendThrows: true }]) {
    const rt = runtime(options);
    await rt.submit(11);
    const data = rt.calls.queued[0][1];
    await rt.service.processFpoLeadImport(data);
    await rt.service.processFpoLeadImport(data);
    assert.equal(rt.calls.imported.length, 1);
    assert.equal(rt.calls.rows.length, 11);
    assert.equal(rt.calls.sent.length, 3);
    assert.equal(rt.records.get(data.jobId).status, 'completed');
    assert.match(rt.records.get(data.jobId).error_message, /completed/);
  }
});

test('terminal failure sends one failure message, while API imports send no WhatsApp messages', async () => {
  const rt = runtime();
  await rt.submit(11);
  const data = rt.calls.queued[0][1];
  await rt.service.failFpoLeadImport(data, new Error('Import unavailable'));
  await rt.service.failFpoLeadImport(data, new Error('Import unavailable'));
  assert.equal(rt.calls.sent.length, 1);
  assert.equal(rt.records.get(data.jobId).status, 'failed');

  const api = runtime();
  const result = await api.submit(11, { document: undefined });
  await api.service.processFpoLeadImport(api.calls.queued[0][1]);
  assert.equal(api.records.get(result.job_id).status, 'completed');
  assert.equal(api.calls.sent.length, 0);
});

test('a 100-farmer WhatsApp upload confirms persisted counts at 20%, 50% and 100% using the uploader FPO', async () => {
  const rt = runtime({ count: 100 });
  await rt.receive();
  const data = rt.calls.queued[0][1];
  assert.equal(data.uploadingFpoPhone, rt.phone);
  assert.equal(data.phoneNumberId, rt.number);
  assert.notEqual(data.uploadingFpoPhone, data.phoneNumberId);
  await rt.service.processFpoLeadImport(data);
  assert.deepEqual(Array.from(rt.calls.sent, response => response.text), [
    'Contact import: 20% processed.\n20 Farmer added.\n20 of 100 contacts stored.',
    'Contact import: 50% processed.\n50 Farmer added.\n50 of 100 contacts stored.',
    'Contact import complete: 100%.\n100 Farmer added.',
  ]);
  assert.deepEqual(rt.calls.sentSnapshots, [
    { stored: 20, processed: 20, status: 'processing' },
    { stored: 50, processed: 50, status: 'processing' },
    { stored: 100, processed: 100, status: 'completed' },
  ]);
  assert(rt.calls.rows.every(row => row.data.parent_user_id === 'fpo' && row.data.fpo_phone_number === rt.phone));
  assert.equal(rt.calls.updates.length, 1);
});

test('restarting workers after both progress milestones does not repeat messages or checkpointed farmers', async () => {
  const rt = runtime();
  await rt.submit(100);
  const data = rt.calls.queued[0][1];
  for (const interruptAt of [25, 51]) {
    await assert.rejects(rt.service.processFpoLeadImport(data, async percentage => {
      if (percentage === interruptAt) throw new Error('Worker interrupted');
    }), /Worker interrupted/);
  }
  assert.equal(rt.calls.sent.length, 2);
  await rt.service.processFpoLeadImport(data);
  await rt.service.processFpoLeadImport(data);
  assert.equal(rt.calls.rows.length, 100);
  assert.equal(rt.calls.sent.length, 3);
  assert.match(rt.calls.sent[0].text, /20% processed.*\n20 Farmer added/);
  assert.match(rt.calls.sent[1].text, /50% processed.*\n50 Farmer added/);
  assert.match(rt.calls.sent[2].text, /complete: 100%.*\n100 Farmer added/);
});

test('partial imports report only successfully stored farmers at each milestone', async () => {
  const rt = runtime({ failRows: Array.from({ length: 10 }, (_, i) => `98765${String(i).padStart(5, '0')}`) });
  await rt.submit(100);
  await rt.service.processFpoLeadImport(rt.calls.queued[0][1]);
  assert.equal(rt.calls.sent.length, 3);
  assert.match(rt.calls.sent[0].text, /20% processed.*\n10 Farmer added.*\n10 of 100 contacts stored.*\n10 row/);
  assert.match(rt.calls.sent[1].text, /50% processed.*\n40 Farmer added/);
  assert.match(rt.calls.sent[2].text, /100% processed, with errors.*\n90 Farmer added.*\n10 row/);
  assert.equal(rt.calls.rows.length, 90);
  assert.equal(rt.session.current_node_id, 'upload');
});

test('failed progress messages do not stop storage or prevent the final completion message', async () => {
  const rt = runtime({ failProgressSends: true });
  await rt.submit(100);
  const data = rt.calls.queued[0][1];
  await rt.service.processFpoLeadImport(data);
  await rt.service.processFpoLeadImport(data);
  assert.equal(rt.calls.rows.length, 100);
  assert.equal(rt.calls.sent.length, 3);
  assert.match(rt.calls.sent[2].text, /complete: 100%.*\n100 Farmer added/);
  assert.equal(rt.records.get(data.jobId).status, 'completed');
});
