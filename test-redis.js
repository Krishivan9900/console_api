// Uses the configured Redis URL with an isolated BullMQ prefix. No real contacts,
// production jobs, databases or WhatsApp messages are touched.
require('dotenv').config();
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const Redis = require('ioredis');
const { Queue, Worker, QueueEvents } = require('bullmq');
const { runtime } = require('./tests/helpers/fpo-import-runtime');

async function main() {
  if (!process.env.REDIS_URL) throw new Error('Set REDIS_URL in .env before running this test');
  const connection = new Redis(process.env.REDIS_URL, {
    lazyConnect: true, maxRetriesPerRequest: null, connectTimeout: 5000,
    retryStrategy: () => null,
  });
  connection.on('error', () => {});
  let connectionError;
  connection.on('error', error => { connectionError = error; });
  const prefix = `fpo-import-test-${randomUUID()}`;
  let queue, worker, events;
  try {
    try {
      await connection.connect();
    } catch (error) {
      throw new Error(`Configured Redis endpoint is unreachable (${connectionError?.code || error.message})`);
    }
    assert.equal(await connection.ping(), 'PONG');
    console.log('Configured Redis URL: connection and PING passed.');
    queue = new Queue('contact-import', { connection, prefix });
    events = new QueueEvents('contact-import', { connection, prefix });
    await events.waitUntilReady();
    const rt = runtime({ queue });
    let interrupted = false;
    worker = new Worker('contact-import', async job => {
      assert.equal(job.data.kind, 'fpo_leads');
      return rt.service.processFpoLeadImport(job.data, async percentage => {
        await job.updateProgress(percentage);
        if (!interrupted && percentage >= 18) {
          interrupted = true;
          throw new Error('Simulated interruption after two checkpointed rows');
        }
      });
    }, { connection, prefix, concurrency: 2 });
    worker.on('error', () => {});
    // Faster retry for this isolated test; production uses the queue defaults.
    const originalAdd = queue.add.bind(queue);
    queue.add = (name, data, options) => originalAdd(name, data, {
      ...options, attempts: 2, backoff: { type: 'fixed', delay: 100 },
    });
    const submitted = await rt.submit(11);
    assert.equal(submitted.queued, true);
    const duplicate = await rt.submit(11);
    assert.equal(duplicate.job_id, submitted.job_id);
    const job = await queue.getJob(submitted.job_id);
    const result = await job.waitUntilFinished(events, 20000);
    assert.equal(result.imported_count, 11);
    assert.equal(rt.calls.rows.length, 11);
    assert.equal(rt.calls.imported.length, 2);
    assert.equal(rt.calls.sent.length, 3);
    assert.match(rt.calls.sent[0].text, /27% processed.*\n3 Farmer added/);
    assert.match(rt.calls.sent[1].text, /54% processed.*\n6 Farmer added/);
    assert.match(rt.calls.sent[2].text, /complete: 100%.*\n11 Farmer added/);
    assert.equal(rt.records.get(submitted.job_id).status, 'completed');
    assert.equal(await queue.getCompletedCount(), 1);
    await rt.service.processFpoLeadImport(job.data);
    assert.equal(rt.calls.sent.length, 3);
    console.log('11-row Excel import: queued, retried, resumed, and completed once.');
    console.log('Progress: two milestone updates and one final completion, with stored farmer counts.');
    console.log('Duplicate delivery: no extra imports, progress updates, summaries, or chatbot messages.');
  } finally {
    if (worker) await worker.close(true);
    if (events) await events.close();
    if (queue) {
      await queue.obliterate({ force: true });
      await queue.close();
    }
    connection.disconnect();
  }
}

main().catch(error => {
  console.error('Redis import test failed:', error.message);
  process.exitCode = 1;
});
