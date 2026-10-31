import * as XLSX from 'xlsx';
import { v4 as uuidv4, v5 as uuidv5 } from 'uuid';
import AuthService from './auth.service';
import MessageService from './message.service';
import PhoneNumberModel from '../models/phoneNumber.model';
import ChatSessionModel from '../models/chatSession.model';
import ImportJobModel from '../models/importJob.model';
import { contactImportQueue, FpoLeadImportJobData } from '../../queues/contactImport.queue';
import { resumeAfterFpoLeadImport } from './chatbot/fpoImport.flow';

export const FPO_IMPORT_QUEUE_THRESHOLD = 10;

/** All FPO imports appear in the existing Excel import job list. */
export async function submitFpoLeadImport({ file, phoneNumberId, uploadingFpoPhone, messageId, document }: {
  file: Buffer;
  phoneNumberId: string;
  uploadingFpoPhone: string;
  messageId?: string;
  document?: FpoLeadImportJobData['document'];
}) {
  const jobId = messageId ? uuidv5(`${phoneNumberId}:${messageId}`, uuidv5.URL) : uuidv4();
  const existing = await ImportJobModel.findById(jobId);
  if (existing) return { queued: existing.status === 'queued' || existing.status === 'processing', job_id: jobId, duplicate: true };

  const workbook = XLSX.read(file, { type: 'buffer', cellText: true, cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = sheet ? XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false }) : [];
  if (!rows.length) throw new Error('The Excel file does not contain any lead rows');
  const phoneNumber = await PhoneNumberModel.findByPhoneNumberId(phoneNumberId);
  if (!phoneNumber) throw new Error('Invalid phone_number_id');
  if (!uploadingFpoPhone) throw new Error('Uploading FPO phone number is required');

  const session = document ? await ChatSessionModel.findActiveByPhoneNumberId(uploadingFpoPhone, phoneNumberId) : null;
  const data: FpoLeadImportJobData = {
    kind: 'fpo_leads', jobId, phoneNumberId, uploadingFpoPhone,
    fileBase64: file.toString('base64'), document,
    expectedSession: session ? { id: session.id, current_node_id: session.current_node_id } : undefined,
  };
  const { created, job } = await ImportJobModel.createFpoImport({
    id: jobId, user_id: phoneNumber.user_id, company_id: phoneNumber.company_id,
    job_type: 'fpo_leads_import', status: 'queued', total_rows: rows.length,
    file_name: document?.filename || 'fpo-leads.xlsx',
    import_options: { phone_number_id: phoneNumberId, uploading_fpo_phone: uploadingFpoPhone },
  });
  if (!created) return { queued: job.status === 'queued' || job.status === 'processing', job_id: jobId, duplicate: true };

  if (rows.length > FPO_IMPORT_QUEUE_THRESHOLD) {
    try {
      await contactImportQueue.add('fpo-leads-import', data, { jobId });
    } catch (error: any) {
      await ImportJobModel.markAsFailed(jobId, error);
      throw error;
    }
    return { queued: true, job_id: jobId, total_rows: rows.length };
  }

  try {
    const result = await processFpoLeadImport(data);
    return { queued: false, job_id: jobId, ...result };
  } catch (error: any) {
    await ImportJobModel.markAsFailed(jobId, error);
    throw error;
  }
}

/** Checkpoint each finished row, so a worker retry resumes instead of reimporting it. */
export async function processFpoLeadImport(data: FpoLeadImportJobData, onProgress?: (progress: number) => Promise<void>) {
  const record = await ImportJobModel.findById(data.jobId);
  if (!record) throw new Error('FPO import job not found');
  const progressNotified = new Set<number>([20, 50].filter(milestone =>
    record.import_options?.[`progress_${milestone}_claimed`] === true));
  let result = record.result;
  if (record.status !== 'completed') {
    await ImportJobModel.updateStatus(data.jobId, 'processing');
    result = await AuthService.importFpoLeads(
      Buffer.from(data.fileBase64, 'base64'), data.phoneNumberId, data.uploadingFpoPhone,
      {
        imported: result?.imported || [], failed: result?.failed || [],
        onProgress: async (checkpoint) => {
          const processed = checkpoint.imported_count + checkpoint.failed_count;
          const percentage = Math.round(processed / checkpoint.total_rows * 100);
          await ImportJobModel.update(data.jobId, {
            result: checkpoint, processed_rows: processed,
            successful_rows: checkpoint.imported_count, failed_rows: checkpoint.failed_count,
            progress_percentage: percentage,
          });
          if (onProgress) await onProgress(percentage);
          // Rows and their checkpoint are stored before announcing progress.
          await notifyFpoImportProgress(data, checkpoint, progressNotified);
        },
      }
    );
    await ImportJobModel.markAsCompleted(data.jobId, result);
  }

  if (data.document) {
    try {
      await notifyFpoImportComplete(data, result);
    } catch (error: any) {
      console.error('FPO import completed but notification failed:', error?.message || error);
      await ImportJobModel.update(data.jobId, { error_message: 'Import completed; notification failed.' });
    }
  }
  return result;
}

function formatImportedRoles(result: any) {
  return Object.entries(result.role_counts || {}).map(([role, count]) =>
    `${count} ${role.replace(/_/g, ' ').replace(/\b\w/g, character => character.toUpperCase())} added.`
  ).join('\n');
}

async function notifyFpoImportProgress(data: FpoLeadImportJobData, checkpoint: any, notified: Set<number>) {
  const processed = checkpoint.imported_count + checkpoint.failed_count;
  // Small files get one final message. 100% is the completion summary, not an
  // extra progress message, and is sent only after the job is marked completed.
  if (!data.document || checkpoint.total_rows <= FPO_IMPORT_QUEUE_THRESHOLD || processed >= checkpoint.total_rows) return;
  const percentage = Math.floor(processed / checkpoint.total_rows * 100);
  for (const milestone of [20, 50] as const) {
    if (percentage < milestone || notified.has(milestone)) continue;
    notified.add(milestone);
    try {
      if (!await ImportJobModel.claimFpoNotification(data.jobId, `progress_${milestone}`)) continue;
      const sent = await MessageService.sendChatBotMessage(data.phoneNumberId, data.uploadingFpoPhone, {
        type: 'text', text: [
          `Contact import: ${percentage}% processed.`,
          formatImportedRoles(checkpoint) || 'No contacts stored yet.',
          `${checkpoint.imported_count} of ${checkpoint.total_rows} contacts stored.`,
          checkpoint.failed_count ? `${checkpoint.failed_count} row(s) could not be imported so far.` : '',
        ].filter(Boolean).join('\n'),
      });
      if (!sent) throw new Error('Progress message could not be confirmed');
    } catch (error: any) {
      // A notification failure must never stop storing farmers or replay rows.
      console.error(`FPO import ${data.jobId} progress notification failed:`, error?.message || error);
      try {
        await ImportJobModel.update(data.jobId, { error_message: 'Import progress message could not be confirmed.' });
      } catch (recordError: any) {
        console.error('Unable to record FPO progress notification error:', recordError?.message || recordError);
      }
    }
  }
}

async function notifyFpoImportComplete(data: FpoLeadImportJobData, result: any) {
  // Notifications are claimed before sending. An ambiguous network failure must
  // never replay a completed import or send another summary hours later.
  if (!await ImportJobModel.claimFpoNotification(data.jobId, 'summary')) return;
  {
    const roles = formatImportedRoles(result);
    const sent = await MessageService.sendChatBotMessage(data.phoneNumberId, data.uploadingFpoPhone, {
      type: 'text', text: [
        result.failed_count ? 'Contact import finished: 100% processed, with errors.' : 'Contact import complete: 100%.',
        roles || 'No leads were imported.',
        result.failed_count ? `${result.failed_count} row(s) could not be imported. Please correct the file and upload it again.` : '',
      ].filter(Boolean).join('\n'),
    });
    if (!sent) {
      await ImportJobModel.update(data.jobId, { error_message: 'Import completed; completion message could not be confirmed.' });
      return;
    }
  }

  if (!data.expectedSession || !await ImportJobModel.claimFpoNotification(data.jobId, 'continuation')) return;
  try {
    const response = await resumeAfterFpoLeadImport({
      phoneNumberId: data.phoneNumberId, phone: data.uploadingFpoPhone,
      document: data.document!, result, expectedSession: data.expectedSession, executeNextNode: false,
    });
    if (response) await MessageService.sendChatBotMessage(data.phoneNumberId, data.uploadingFpoPhone, response);
  } catch (error: any) {
    console.error('FPO leads imported but chatbot continuation failed:', error?.message || error);
  }
}

export async function failFpoLeadImport(data: FpoLeadImportJobData, error: Error) {
  const record = await ImportJobModel.findById(data.jobId);
  // Notification failures must never relabel or replay a completed import.
  if (record?.status === 'completed') return;
  await ImportJobModel.markAsFailed(data.jobId, error);
  if (data.document && await ImportJobModel.claimFpoNotification(data.jobId, 'failure')) {
    await MessageService.sendChatBotMessage(data.phoneNumberId, data.uploadingFpoPhone, {
      type: 'text', text: 'We could not finish this Excel import. Please check the import job results before uploading it again.',
    });
  }
}
