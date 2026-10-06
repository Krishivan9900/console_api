import { BaseModel } from '@surefy/models/base.model';
import { chatBot } from '../interfaces/chatbot.interface';
import { normalizeTriggerText, selectTriggeredBot } from '../services/chatbot/trigger.logic';

class chatBotModel extends BaseModel {
    constructor() {
        super("chat_bot")
    }

    async createChatBot(data: chatBot) {
        return this.query().insert(data).returning('*');
    }

    async findById(id: string | number): Promise<any> {
        return this.query().where({ id }).first()
    }

    async findByUserId(userId: string | number): Promise<any> {
        return this.query().where({ user_id: userId })
    }

    async getPublishedBotByUser(userId: string) {
        return this.query().where({ user_id: userId, status: 'published', published: true }).first()
    }

    async getPublishedBotByTrigger(phoneNumberId: string, text: string) {
        const triggerWord = normalizeTriggerText(text);
        if (!triggerWord) return null;

        const candidates = await this.query()
            .select("chat_bot.*", "chatbot_triggers.trigger_word")
            .join("chatbot_triggers", "chatbot_triggers.chatbot_id", "chat_bot.id")
            .where("chatbot_triggers.phone_number_id", phoneNumberId)
            .where("chatbot_triggers.active", true)
            .where("chat_bot.published", true);

        return selectTriggeredBot(candidates, triggerWord);
    }

    async setPublishedState(chatBotId: string, published: boolean) {
        return this.db.transaction(async (trx) => {
            await trx("chat_bot").where({ id: chatBotId }).update({
                status: published ? "published" : "draft",
                published,
                updated_at: new Date(),
            });
            await trx("chatbot_triggers").where({ chatbot_id: chatBotId }).update({ active: published });
            if (!published) {
                await trx("chat_sessions").where({ chatbot_id: chatBotId, active: true }).update({
                    active: false,
                    current_node_id: null,
                    completed_at: new Date(),
                    updated_at: new Date(),
                });
            }
        });
    }

    async getPublishedBotByPhoneNumber(
        phoneNumberId: string,
        chatBotId?: string
    ) {
        const query = this.query()
            .select("chat_bot.*")
            .join(
                "chatbot_triggers",
                "chatbot_triggers.chatbot_id",
                "chat_bot.id"
            )
            .where(
                "chatbot_triggers.phone_number_id",
                phoneNumberId
            )
            .where("chat_bot.published", true)
            .where("chatbot_triggers.active", true);

        if (chatBotId) {
            query.where("chat_bot.id", chatBotId);
        }

        return query.first();
    }
}

export default new chatBotModel();
