# FPO Excel import jobs

Files with **1–10 rows** finish immediately. Files with **more than 10 rows** run
as `fpo_leads_import` jobs on the existing BullMQ `contact-import` queue. Both
paths appear in the existing import job list, with row counts, progress, failed
rows and the final result. No database migration is needed if `import_jobs`
already exists.

The file travels in the job as base64, so API nodes and workers can run on
different machines without sharing an upload folder. Only the first worksheet
is imported, matching the existing FPO importer.

## Running

Set `REDIS_URL` in `.env` on **every API node and worker**, using the same Redis
database. `rediss://` URLs enable TLS. `REDIS_HOST`, `REDIS_PORT`,
`REDIS_PASSWORD` and `REDIS_DB` remain available when no URL is configured.
The JavaScript and TypeScript Redis configurations both honor the URL.
Configure the Redis instance's eviction policy as `noeviction` for BullMQ job
durability. The supplied test endpoint reported `allkeys-lru` during validation.

For development, run these in separate terminals:

```sh
npm run dev
npm run worker
```

For production:

```sh
npm run build
npm start
# Separate worker process:
npm run start:worker
```

Deploy the updated API and worker together and restart all old API instances.
An old worker does not recognize the new FPO job type. New workers continue to
process existing ordinary contact imports.

## Completion and duplicate prevention

- Large WhatsApp imports send progress updates when processing crosses 20% and
  50%, with counts of farmers and other roles successfully stored. For 100 farmer
  rows these confirm 20 farmers and 50 farmers. Uneven file sizes report the
  actual percentage at the first row past each threshold (for example 27% and
  54% for 11 rows).
- The final completion summary is the 100% update, sent after the job is marked
  completed. Files with 1–10 rows receive only this final update. Percentages
  refer to rows processed; any failed rows are reported separately and never
  included in the number added.
- A WhatsApp upload produces one completion summary after the rows finish, or
  one final failure message after worker retries are exhausted. Partial imports
  report the failed count and remain at the upload question.
- A successful import finishes the original upload step without executing the
  next chatbot node or sending additional menus. Completion does not advance a
  newer session or an unrelated current node.
- Saved WhatsApp message IDs block late webhook redeliveries even after Redis's
  24-hour deduplication key expires. Each upload also has a stable database and
  queue job ID. A deliberate new upload with a new message ID creates a new job.
- Finished rows are checkpointed in PostgreSQL. Worker retries skip those rows;
  completed imports never run again on a retry. A crash between an individual
  row's external registration and its checkpoint can replay that last row.
- Notification claims are atomic and persistent in PostgreSQL. They are made
  before sending to prevent duplicate or late notifications after an ambiguous
  network error. A crash in that interval can leave a completed job without a
  delivered summary; notification errors are recorded on the job, and are not
  automatically resent.
- Excel templates do not contain an FPO phone-number column. For WhatsApp
  uploads the parent FPO is looked up using Meta's `messages[].from` (the sender
  who uploaded the file). Meta's receiving business `phone_number_id` identifies
  the bot/company, not the parent FPO. Older sheets containing FPO-number
  columns are accepted, but those cells cannot override the uploader mapping.

## API imports and job status

`POST /v1/auth/fpo-leads/import` accepts multipart `file`, `phone_number_id`
and `fpo_phone_number`. This separate HTTP upload has no Meta sender context, so
its FPO phone is still provided as request metadata, never as an Excel column.
WhatsApp uploads fill this automatically from the sender. Small files return HTTP 201 and results; larger files return
HTTP 202 with `job_id`, `queued: true` and `total_rows`. API imports do not send
WhatsApp messages.

Use the existing authenticated endpoints:

```text
GET /v1/contacts/import/jobs?job_type=fpo_leads_import
GET /v1/contacts/import/<job_id>/status
```

## Verification

```sh
npm run test:fpo-import
npm run test:redis-import
```

The Redis test uses the configured `REDIS_URL` and an isolated random BullMQ
prefix. It sends an 11-row Excel file through a real Redis queue, simulates a
worker interruption, checks that rows resume and each progress update and final
summary is produced once, then removes its own queue. Database writes and WhatsApp sends are
stubbed; production queues, contacts and messages are untouched.

If the Redis connection times out, check that the endpoint and port are reachable
from the API/worker network, then rerun the live test. It reports a failure until
Redis can actually be reached.
