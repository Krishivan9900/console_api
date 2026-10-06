import { Request, Response } from 'express';
import { successResponse, tryCatchAsync } from '@surefy/utils/Controller';
import { HttpStatusCode } from '@surefy/utils/HttpStatusCode';
import HTTP400Error from '@surefy/exceptions/HTTP400Error';
import { JWTAuthRequest } from '@surefy/middleware/jwtAuth.middleware';
import { AuthRequest } from '@surefy/middleware/auth.middleware';
import { chatBotEdge, chatBot, chatBotNode } from '@surefy/console/interfaces/chatbot.interface';
import chatBotModel from '../models/chatbot.model';
import chatBotEdgeModel from '../models/chatBotEdge.model';
import chatBotNodeModel from '../models/chatBotNode.model';
import chatbotTriggerModel from '../models/chatbotTrigger.model';
import wabaModel from '../models/waba.model';
import { v4 as uuidv4 } from 'uuid';
import { values } from 'lodash';
import { getConditionBranch } from './chatbot/engine/condition.logic';

class chatBotService {
  async createChatBot(data: chatBot) {
    console.log('Creating chatbot with data:', data); // Debug log
    const result = await chatBotModel.create(data);
    return result;
  }

  async getChatBots(userId: string) {
    const chatBots = await chatBotModel.findByUserId(userId);
    return chatBots;
  }

  async deleteChatBot(chatBotId: string) {
    // ✅ 1. Check chatbot exists
    const bot = await chatBotModel.findById(chatBotId);
    if (!bot) {
      throw new HTTP400Error({ message: 'ChatBot not exists' });
    }
    // 🔥 2. DELETE FLOW
    await chatBotEdgeModel.deleteChatBotEdge(chatBotId);
    await chatBotNodeModel.deleteChatBotNode(chatBotId);
    // 🔥 3. DELETE CHATBOT
    const result = await chatBotModel.delete(chatBotId);
    return result;
  }

  async publishedChatBot(
    userId: string,
    chatBotId: string
  ) {
    const bot: any = await chatBotModel.findById(
      chatBotId
    );

    if (!bot) {
      throw new HTTP400Error({
        message: "ChatBot not exists",
      });
    }

    if (bot.user_id !== userId) {
      throw new HTTP400Error({ message: "ChatBot does not belong to this user" });
    }

    const triggers = await chatbotTriggerModel.findAll({ chatbot_id: chatBotId });
    if (!triggers.length) {
      throw new HTTP400Error({ message: "Save a flow with trigger keywords before publishing" });
    }

    for (const trigger of triggers) {
      const conflicts = await chatbotTriggerModel.findConflicts({
        phoneNumberId: trigger.phone_number_id,
        triggers: [trigger.trigger_word],
        excludeChatBotId: chatBotId,
      });
      if (conflicts.length) {
        throw new HTTP400Error({ message: "Some trigger keywords are already assigned to another published chatbot.", conflicts } as any);
      }
    }

    await chatBotModel.setPublishedState(chatBotId, true);

    return {
      success: true,
    };
  }

  async getChatBotById(chatBotId: string) {
    // ✅ 1. Check chatbot exists
    const bot = await chatBotModel.findById(chatBotId);
    if (!bot) {
      throw new HTTP400Error({ message: 'ChatBot not exists' });
    }

    const edges = await chatBotEdgeModel.findByChatBotId(chatBotId);
    const nodes = await chatBotNodeModel.findByChatBotId(chatBotId);
    return { ...bot, edges, nodes };
  }

  async getPublishedBotByUser(userId: string) {
    const bot = await chatBotModel.getPublishedBotByUser(userId);
    return bot;
  }

  async unpublishedChatBot(
    userId: string,
    chatBotId: string
  ) {
    const bot =
      await chatBotModel.findById(chatBotId);

    if (!bot) {
      throw new HTTP400Error({
        message: "ChatBot not exists",
      });
    }

    if (bot.user_id !== userId) {
      throw new HTTP400Error({ message: "ChatBot does not belong to this user" });
    }

    await chatBotModel.setPublishedState(chatBotId, false);

    return {
      success: true,
    };
  }

  async createFlow(userId: string, data: any) {
    const {
      chatBotId,
      name,
      nodes,
      edges,
      phoneNumberIds = [],
    } = data;

    console.log("Data", data)

    const bot = await chatBotModel.findById(chatBotId);

    if (!bot) {
      throw new HTTP400Error({
        message: "ChatBot flow not exists",
      });
    }
    // ---------------------------------
    // Get Trigger Node
    // ---------------------------------

    const triggerNode = nodes.find(
      (node: any) => node.type === "trigger"
    );

    if (!triggerNode) {
      throw new HTTP400Error({
        message: "Flow must contain a trigger node",
      });
    }

    // ---------------------------------
    // Extract Trigger Keywords
    // ---------------------------------

    const rawTriggers =
      triggerNode?.data?.attributes?.keywords || [];

    if (
      !Array.isArray(rawTriggers) ||
      rawTriggers.length === 0
    ) {
      throw new HTTP400Error({
        message: "At least one trigger keyword is required",
      });
    }

    // ---------------------------------
    // Normalize Trigger Keywords
    // ---------------------------------

    const triggerWords = [
      ...new Set(
        rawTriggers
          .filter(
            (keyword: any) =>
              typeof keyword === "string"
          )
          .map((keyword: string) =>
            keyword
              .trim()
              .toLowerCase()
              .replace(/\s+/g, " ")
          )
          .filter(Boolean)
      ),
    ];

    if (!triggerWords.length) {
      throw new HTTP400Error({ message: "At least one non-empty trigger keyword is required" });
    }

    // ---------------------------------
    // Validate Phone Numbers
    // ---------------------------------

    if (
      !Array.isArray(phoneNumberIds) ||
      phoneNumberIds.length === 0
    ) {
      throw new HTTP400Error({
        message: "At least one phone number is required",
      });
    }

    // Validate conditions before replacing the saved flow.
    for (const node of nodes) {
      if (node.data?.key !== '@condition/condition-action') continue;
      const title = node.data.title || node.id;
      const conditions = node.data.attributes?.conditions;
      if (Array.isArray(conditions)) {
        for (const condition of conditions) {
          const field = typeof condition?.field === 'string'
            ? condition.field.trim().replace(/^\{\{\s*|\s*\}\}$/g, '').trim()
            : '';
          const comparator = String(condition?.comparator || 'equals').replace(/[\s_-]/g, '').toLowerCase();
          if (['http_response.success', 'http_response_success'].includes(field) &&
              ['equals', 'equal', 'eq', '==', '===', 'notequals', 'notequal', 'neq', '!=', '!=='].includes(comparator) &&
              (condition.value == null || (typeof condition.value === 'string' && !condition.value.trim()))) {
            throw new HTTP400Error({
              message: `Condition "${title}" compares HTTP success with an empty value. Set the value to true or false.`,
            });
          }
        }
      }
      for (const branch of [true, false]) {
        const targets = new Set(edges
          .filter((edge: any) => edge.source === node.id && getConditionBranch(edge) === branch)
          .map((edge: any) => edge.target));
        if (targets.size > 1) {
          throw new HTTP400Error({
            message: `Condition "${title}" has multiple destinations for its ${branch} branch. Connect that branch to one destination.`,
          });
        }
      }
    }

    // ---------------------------------
    // Check Trigger Conflicts
    // ---------------------------------

    for (const phoneNumberId of phoneNumberIds) {
      const conflicts =
        await chatbotTriggerModel.findConflicts({
          phoneNumberId,
          triggers: triggerWords,
          excludeChatBotId: chatBotId,
        });

      if (conflicts.length > 0) {
        throw new HTTP400Error({
          message:
            "Some trigger keywords are already assigned to another chatbot.",
          conflicts,
        } as any);
      }
    }

    // ---------------------------------
    // Save Flow Logic
    // ---------------------------------

    const messageCount = nodes.filter(
      (node: any) => node.type === "message"
    ).length;

    await chatBotModel.update(chatBotId, {
      flow_type: messageCount >= 3 ? "form" : "menu",
    });

    // delete old nodes/edges
    await chatBotEdgeModel.deleteChatBotEdge(
      chatBotId
    );

    await chatBotNodeModel.deleteChatBotNode(
      chatBotId
    );

    // create nodes
    const nodeIdMap: Record<string, string> = {};

    const formattedNodes = nodes.map(
      (node: any) => {
        const newId = uuidv4();

        nodeIdMap[node.id] = newId;

        return {
          id: newId,
          user_id: userId,
          chatBotId,
          type: node.type,
          data: JSON.stringify(node.data),
          position: JSON.stringify(
            node.position || {
              x: 0,
              y: 0,
            }
          ),
          created_at: new Date(),
        };
      }
    );

    await chatBotNodeModel.createNodes(
      formattedNodes
    );

    // create edges
    const formattedEdges = edges.map((edge: any) => {
      const edgeData = {
        ...(typeof edge.data === 'string' ? JSON.parse(edge.data) : edge.data || {}),
      };
      // React Flow puts connection handles at the top level; persist them in JSON.
      if (edge.sourceHandle != null) edgeData.sourceHandle = edge.sourceHandle;
      if (edge.targetHandle != null) edgeData.targetHandle = edge.targetHandle;
      const sourceNode = nodes.find((node: any) => node.id === edge.source);
      if (sourceNode?.data?.key === '@condition/condition-action') {
        const branch = getConditionBranch({ ...edge, data: edgeData });
        if (branch !== undefined) edgeData.condition = branch;
        for (const branchName of ['true', 'false']) {
          if (edgeData.sourceHandle === `condition-${branchName}-${edge.source}`) {
            edgeData.sourceHandle = `condition-${branchName}-${nodeIdMap[edge.source]}`;
          }
        }
      }
      return {
        id: uuidv4(),
        user_id: userId,
        chatBotId,
        source: nodeIdMap[edge.source],
        target: nodeIdMap[edge.target],
        label: edge.label || null,
        data: JSON.stringify(edgeData),
        created_at: new Date(),
      };
    });

    await chatBotEdgeModel.createEdges(
      formattedEdges
    );

    // ---------------------------------
    // Save Triggers
    // ---------------------------------

    await chatbotTriggerModel.deleteByChatBot(
      chatBotId
    );

    const triggerRows = [...new Set(phoneNumberIds)].flatMap((phoneNumberId) =>
      triggerWords.map((triggerWord) => ({
          chatbot_id: chatBotId,
          phone_number_id: phoneNumberId,
          trigger_word: triggerWord,
          active: bot.published === true,
          created_at: new Date(),
      }))
    );
    await chatbotTriggerModel.createMany(triggerRows);

    return {
      chatBotId,
      triggerWords,
      phoneNumberIds,
    };
  }
}

export default new chatBotService();

