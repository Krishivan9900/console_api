import chatSessionModel from '../../models/chatSession.model';
import { getRuntimeBot } from './runtimeBot';
import { executeNode } from './engine/executeNode';

/** Continue an upload question only after the spreadsheet webhook has imported its rows. */
export async function resumeAfterFpoLeadImport({ phoneNumberId, phone, document, result, expectedSession, executeNextNode = true }: {
  phoneNumberId: string;
  phone: string;
  document: { id: string; filename?: string; mime_type?: string };
  result: { success: boolean; imported_count: number; failed_count: number; role_counts?: Record<string, number> };
  expectedSession?: { id: string; current_node_id: string };
  executeNextNode?: boolean;
}) {
  if (result.success !== true || result.imported_count <= 0 || result.failed_count !== 0) return null;

  const session = await chatSessionModel.findActiveByPhoneNumberId(phone, phoneNumberId);
  if (!session) return null;
  if (expectedSession && (session.id !== expectedSession.id ||
      session.current_node_id !== expectedSession.current_node_id)) return null;
  const bot = await getRuntimeBot(phoneNumberId, session.chatbot_id);
  if (!bot) return null;
  const current = bot.nodes.find((node: any) => node.id === session.current_node_id);
  if (current?.data?.key !== '@whatsapp/ask-question' ||
      current.data.attributes?.variable !== 'excel_file' ||
      current.data.attributes?.resumeOnFpoImport !== true) return null;

  const targets = [...new Set(bot.edges.filter((edge: any) => edge.source === current.id)
    .map((edge: any) => edge.target))];
  const next = targets.length === 1 ? bot.nodes.find((node: any) => node.id === targets[0]) : null;
  if (!next) return null;

  const variables = {
    ...(session.variables || {}),
    excel_file: { id: document.id, filename: document.filename, mime_type: document.mime_type },
    fpo_import_result: {
      imported_count: result.imported_count,
      failed_count: result.failed_count,
      role_counts: result.role_counts || {},
    },
  };
  await chatSessionModel.update(session.id, {
    current_node_id: next.id,
    variables,
    last_message: document.filename || 'FPO lead spreadsheet',
  });
  // Imports can finish the upload step without automatically running more nodes.
  if (!executeNextNode) return null;
  return executeNode({
    bot,
    session: { ...session, current_node_id: next.id, variables },
    currentNode: next,
  });
}
