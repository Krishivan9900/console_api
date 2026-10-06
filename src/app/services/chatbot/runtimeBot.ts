import chatBotModel from '../../models/chatbot.model';
import chatBotNodeModel from '../../models/chatBotNode.model';
import chatBotEdgeModel from '../../models/chatBotEdge.model';

function parseData(value: any) {
  return typeof value === 'string' ? JSON.parse(value) : value || {};
}

export async function getRuntimeBot(phoneNumberId: string, chatbotId?: string, text?: string) {
  const bot = chatbotId
    ? await chatBotModel.getPublishedBotByPhoneNumber(phoneNumberId, chatbotId)
    : text ? await chatBotModel.getPublishedBotByTrigger(phoneNumberId, text) : null;
  if (!bot) return null;

  const [nodes, edges] = await Promise.all([
    chatBotNodeModel.findByChatBotId(bot.id),
    chatBotEdgeModel.findByChatBotId(bot.id),
  ]);
  return {
    ...bot,
    nodes: nodes.map((node: any) => ({ ...node, data: parseData(node.data) })),
    edges: edges.map((edge: any) => ({ ...edge, data: parseData(edge.data) })),
  };
}
