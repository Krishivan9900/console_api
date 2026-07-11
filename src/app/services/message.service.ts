import MessageModel from '@surefy/console/models/message.model';
import PhoneNumberModel from '@surefy/console/models/phoneNumber.model';
import CompanyModel from '@surefy/console/models/company.model';
import { SendMessageDto, SendBulkMessageDto, MarkAsReadDto, MessageStatusUpdate, BulkSendMessageDto } from '@surefy/console/interfaces/message.interface';
import MetaService from '@surefy/console/services/meta.service';
import CreditService from '@surefy/console/services/credit.service';
import WebhookService from '@surefy/console/services/webhook.service';
import HTTP404Error from '@surefy/exceptions/HTTP404Error';
import HTTP400Error from '@surefy/exceptions/HTTP400Error';
import webhookService from '@surefy/console/services/webhook.service';
import { bulkMessageSendQueue } from '../../queues/bulkMessageSend.queue';
import { v4 as uuidv4, validate as uuidValidate } from "uuid";
import messageModel from '@surefy/console/models/message.model';
import userModel from '../models/user.model';
import { uploadImage } from '@surefy/config/firebase.config';
import { downloadImage } from '@surefy/console/utils';
import productVariantModel from '../models/productVariant.model';
import axios from 'axios';
import chatSessionModel from '../models/chatSession.model';

class MessageService {
  /**
   * Calculate message cost (simplified pricing)
   */
  private calculateMessageCost(type: string, category?: string): number {
    // Simplified pricing - adjust based on actual Meta pricing
    if (type === 'template') {
      if (category === 'MARKETING') return 0.99;
      if (category === 'UTILITY') return 0.14;
      if (category === 'AUTHENTICATION') return 0.14;
    }
    return 0.145; // Default for text messages
  }


  async getUserStats(userId: any) {
    const userStats = await userModel.getUserStats(userId)
    return userStats
  }

  /**
   * Send message
   */
  async sendMessage(data: SendMessageDto) {
    const phoneNumber = await PhoneNumberModel.findByPhoneNumberId(data.phone_number_id);
    if (!phoneNumber) {
      throw new HTTP404Error({ message: 'Phone number not found' });
    }

    // Verify company has sufficient credits
    // const company = await CompanyModel.findById(data.company_id);
    // if (!company) {
    //   throw new HTTP404Error({ message: 'Company not found' });
    // }

    // const messageCost = this.calculateMessageCost(data.type);
    // if (company.credit_balance < messageCost) {
    //   throw new HTTP400Error({ message: 'Insufficient credits' });
    // }

    // Build Meta API payload
    const metaPayload: any = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: data.to,
      type: data.type,
    };

    if (data.type === 'text' && data.text) {
      metaPayload.text = data.text;
    } else if (data.type === 'template' && data.template) {
      // Format template for Meta API - language must be an object with 'code' property
      metaPayload.template = {
        ...data.template,
        language: typeof data.template.language === 'string'
          ? { code: data.template.language }
          : data.template.language
      };
    } else if (data.type === 'image' && data.image) {
      metaPayload.image = data.image;
    } else if (data.type === 'video' && data.video) {
      metaPayload.video = data.video;
    } else if (data.type === 'document' && data.document) {
      metaPayload.document = data.document;
    } else if (data.type === 'audio' && data.audio) {
      metaPayload.audio = data.audio;
    } else if (data.type === 'interactive' && data.interactive) {
      metaPayload.interactive = data.interactive;
    } else if (data.type === 'location' && data.location) {
      metaPayload.location = data.location;
    } else if (data.type === 'contacts' && data.contacts) {
      metaPayload.contacts = data.contacts;
    } else if (data.type === 'sticker' && data.sticker) {
      metaPayload.sticker = data.sticker;
    } else if (data.type === 'reaction' && data.reaction) {
      metaPayload.reaction = data.reaction;
    }

    if (data.context) {
      metaPayload.context = data.context;
    }

    // const messageId = data?.messageUUID && uuidValidate(data.messageUUID) ? data.messageUUID : uuidv4();

    // Create message record
    const message = await MessageModel.create({
      id: data.messageUUID,
      user_id: data.user_id,
      company_id: data.company_id,
      campaign_id: data.campaign_id,
      phone_number_id: phoneNumber.id,
      profile_name: data.profile_name || "",
      direction: 'outbound',
      type: data.type,
      from_phone: phoneNumber.display_phone_number,
      to_phone: data.to,
      status: 'queued',
      content: metaPayload,
      // cost: messageCost,
      queued_at: new Date(),
    });


    try {
      // Send via Meta API
      const metaResponse = await MetaService.sendMessage(phoneNumber.phone_number_id, metaPayload);

      // Update message with WAMID
      await MessageModel.update(message.id, {
        wamid: metaResponse.messages[0].id,
        status: 'sent',
        sent_at: new Date(),
      });

      // Deduct credits
      // await CreditService.deductCredit({
      //   company_id: data.company_id,
      //   amount: messageCost,
      //   reference_type: 'message',
      //   reference_id: message.id,
      //   description: `Message sent to ${data.to}`,
      // });

      // Trigger webhook
      // await WebhookService.triggerWebhook(data.company_id, 'message.sent', {
      //   message_id: message.id,
      //   wamid: metaResponse.messages[0].id,
      //   to: data.to,
      //   timestamp: new Date().toISOString(),
      // });

      return { ...message, wamid: metaResponse.messages[0].id };
    } catch (error: any) {
      // Update message as failed
      await MessageModel.update(message.id, {
        status: 'failed',
        failed_at: new Date(),
        error_message: error.message,
        error_code: error.code,
      });

      throw error;
    }
  }

  async bulkSendMessage(data: BulkSendMessageDto) {
    const phoneNumber = await PhoneNumberModel.findByPhoneNumberId(data.phone_number_id);
    if (!phoneNumber) {
      throw new HTTP404Error({ message: 'Phone number not found' });
    }

    // Verify company has sufficient credits
    const user = await userModel.findById(data.user_id);
    if (!user) {
      throw new HTTP404Error({ message: 'User not found' });
    }

    // const messageCost = this.calculateMessageCost(data.type);
    // if (company.credit_balance < messageCost) {
    //   throw new HTTP400Error({ message: 'Insufficient credits' });
    // }

    // Build Meta API payload
    const metaPayload: any = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: data.to,
      type: data.type,
    };

    if (data.type === 'text' && data.text) {
      metaPayload.text = data.text;
    } else if (data.type === 'template' && data.template) {
      // Format template for Meta API - language must be an object with 'code' property
      metaPayload.template = {
        ...data.template,
        language: typeof data.template.language === 'string'
          ? { code: data.template.language }
          : data.template.language
      };
    } else if (data.type === 'image' && data.image) {
      metaPayload.image = data.image;
    } else if (data.type === 'video' && data.video) {
      metaPayload.video = data.video;
    } else if (data.type === 'document' && data.document) {
      metaPayload.document = data.document;
    } else if (data.type === 'audio' && data.audio) {
      metaPayload.audio = data.audio;
    } else if (data.type === 'interactive' && data.interactive) {
      metaPayload.interactive = data.interactive;
    } else if (data.type === 'location' && data.location) {
      metaPayload.location = data.location;
    } else if (data.type === 'contacts' && data.contacts) {
      metaPayload.contacts = data.contacts;
    } else if (data.type === 'sticker' && data.sticker) {
      metaPayload.sticker = data.sticker;
    } else if (data.type === 'reaction' && data.reaction) {
      metaPayload.reaction = data.reaction;
    }

    if (data.context) {
      metaPayload.context = data.context;
    }

    // const messageId = data?.messageUUID && uuidValidate(data.messageUUID) ? data.messageUUID : uuidv4();

    // Create message record
    const message = await MessageModel.create({
      id: data.messageUUID,
      user_id: data.user_id,
      // campaign_id: data.campaign_id,
      phone_number_id: phoneNumber.id,
      direction: 'outbound',
      type: data.type,
      from_phone: phoneNumber.display_phone_number,
      to_phone: data.to,
      status: 'queued',
      content: metaPayload,
      // cost: messageCost,
      queued_at: new Date(),
    });



    try {
      // Send via Meta API
      const metaResponse = await MetaService.sendMessage(phoneNumber.phone_number_id, metaPayload);

      // Update message with WAMID
      await MessageModel.update(message.id, {
        wamid: metaResponse.messages[0].id,
        status: 'sent',
        sent_at: new Date(),
      });

      // Deduct credits
      // await CreditService.deductCredit({
      //   company_id: data.company_id,
      //   amount: messageCost,
      //   reference_type: 'message',
      //   reference_id: message.id,
      //   description: `Message sent to ${data.to}`,
      // });

      // Trigger webhook
      // await WebhookService.triggerWebhook(data.company_id, 'message.sent', {
      //   message_id: message.id,
      //   wamid: metaResponse.messages[0].id,
      //   to: data.to,
      //   timestamp: new Date().toISOString(),
      // });

      return { ...message, wamid: metaResponse.messages[0].id };
    } catch (error: any) {
      // Update message as failed
      await MessageModel.update(message.id, {
        status: 'failed',
        failed_at: new Date(),
        error_message: error.message,
        error_code: error.code,
      });

      throw error;
    }
  }

  /**
   * Mark message as read
   */
  async markAsRead(data: MarkAsReadDto) {
    const phoneNumber = await PhoneNumberModel.findByPhoneNumberId(data.phone_number_id);
    if (!phoneNumber) {
      throw new HTTP404Error({ message: 'Phone number not found' });
    }

    await MetaService.markAsRead(phoneNumber.phone_number_id, data.message_id);

    // Update local message if exists
    const message = await MessageModel.findByWamid(data.message_id);
    if (message) {
      await MessageModel.updateStatus(data.message_id, 'read');
    }

    return { success: true };
  }

  /**
   * Handle message status update from webhook
   */
  async handleStatusUpdate(statusUpdate: MessageStatusUpdate) {
    const message = await MessageModel.findByWamid(statusUpdate.wamid);
    if (!message) {
      console.warn(`Message not found for WAMID: ${statusUpdate.wamid}`);
      return;
    }

    await MessageModel.updateStatus(statusUpdate.wamid, statusUpdate.status, {
      error_message: statusUpdate.error?.message,
      error_code: statusUpdate.error?.code,
    });

    // Trigger webhook
    await WebhookService.triggerWebhook(message.company_id, `message.${statusUpdate.status}`, {
      message_id: message.id,
      wamid: statusUpdate.wamid,
      status: statusUpdate.status,
      timestamp: new Date(statusUpdate.timestamp * 1000).toISOString(),
      error: statusUpdate.error,
    });
  }


  /**
   * Save incoming message
   */
  async saveIncomingMessage(data: any) {
    console.log("Saving incoming message", data);

    const phoneNumber = await PhoneNumberModel.findByPhoneNumberId(
      data.phone_number_id
    );

    if (!phoneNumber) {
      console.warn(`Phone number not found: ${data.phone_number_id}`);
      return;
    }

    let content = data.content;

    const type = content?.type;

    if (["image", "video", "audio", "document"].includes(type)) {
      let mediaId: string | undefined;

      switch (type) {
        case "image":
          mediaId = content.image?.id;
          break;

        case "video":
          mediaId = content.video?.id;
          break;

        case "audio":
          mediaId = content.audio?.id;
          break;

        case "document":
          mediaId = content.document?.id;
          break;
      }

      if (mediaId) {
        const mediaUrl = await downloadImage(mediaId);

        content = {
          type: type,
          media_url: mediaUrl.firebaseUrl,
        };
      }
    }

    const message = await MessageModel.create({
      user_id: phoneNumber.user_id,
      company_id: phoneNumber.company_id,
      profile_name: data.profile_name,
      phone_number_id: phoneNumber.id,
      wamid: data.message_id,
      direction: "inbound",
      type: data.type,
      from_phone: data.from,
      to_phone: phoneNumber.display_phone_number,
      status: "received",
      content,
      context: data.context,
      delivered_at: new Date(),
    });

    console.log("Incoming Message stored", message)

    return message;
  }

  /**
   * Get messages for company
   */
  async getMessages(companyId: string, userId: string, filters: any = {}) {
    return MessageModel.findByUserId(companyId, userId, filters);
  }


  /**
 * Handle Send ChatBot message
 */
  async sendChatBotMessage(phoneNumberId: string, to: string, response: any) {
    console.log('Response', JSON.stringify(response))

    const { type } = response

    const phoneNumber = await PhoneNumberModel.findByPhoneNumberId(phoneNumberId);
    if (!phoneNumber) {
      console.warn(`Phone number not found: ${phoneNumberId}`);
      return;
    }

    try {
      let metaPayload: any = {
        messaging_product: "whatsapp",
        to: to,
      };

      metaPayload.type = response.type
      metaPayload.interactive = response.interactive

      // // ✅ TEXT MESSAGE
      if (response.type === "text") {
        metaPayload.type = "text";
        metaPayload.text = {
          body: response.text,
        };
      }

      console.log("Meta Payload Message Service", JSON.stringify(metaPayload))
      const metaResponse = await MetaService.sendMessage(phoneNumberId, metaPayload);

      console.log("✅ Message Sent:", metaResponse);


      const message = await MessageModel.create({
        user_id: phoneNumber.user_id,
        company_id: phoneNumber.company_id,
        profile_name: "",
        phone_number_id: phoneNumber.id,
        wamid: metaResponse.messages[0].id,
        direction: 'outbound',
        type: metaPayload.type,
        from_phone: phoneNumber.display_phone_number,
        to_phone: to,
        status: 'sent',
        content: metaPayload,
        context: "",
        delivered_at: new Date(),
      });

      console.log('chatbot mesage', message)


      return metaResponse.data;
    } catch (error: any) {
      console.error("❌ Send Message Error:", error?.response?.data || error.message);
      return null;
    }
  }


  async bulkSendMessages(userId: string, messages: BulkSendMessageDto[]) {
    // Validate messages array length
    if (!messages || messages.length === 0) {
      throw new HTTP400Error({ message: 'Messages array cannot be empty' });
    }

    if (messages.length > 1000) {
      throw new HTTP400Error({ message: 'Maximum 1000 messages allowed per request' });
    }

    // Verify company exists
    const user = await userModel.findById(userId);
    if (!user) {
      throw new HTTP404Error({ message: 'User not found' });
    }

    // Validate all messages have required fields
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (!msg.phone_number_id || !msg.to || !msg.type) {
        throw new HTTP400Error({
          message: `Message at index ${i}: Phone number ID, recipient, and message type are required`,
        });
      }
    }

    const normalizedMessages = messages.map((msg) => ({
      ...msg,
      messageUUID: msg.messageUUID && uuidValidate(msg.messageUUID) ? msg.messageUUID : uuidv4(),
    }));

    // Add job to queue
    const job = await bulkMessageSendQueue.add('bulk-send', {
      userId,
      messages: normalizedMessages,
    });

    return {
      job_id: job.id,
      total_messages: normalizedMessages.length,
      // estimated_cost: totalEstimatedCost,
      status: 'queued',
      message: 'Bulk message send job has been queued for processing',
      messages: normalizedMessages.map((msg) => ({
        message_id: msg.messageUUID,
        to: msg.to,
        status: 'queued',
      })),
    };
  }

  /**
   * Get message statistics
   */
  async getMessageStats(companyId: string, fromDate?: Date, toDate?: Date) {
    return MessageModel.getMessageStats(companyId, fromDate, toDate);
  }

  async getMessagesConversation(userId: string, phone_number_id: any) {
    return MessageModel.getMessagesConversation(userId, phone_number_id)
  }

  async getLeadConversations(leadNumber: any, phone_number_id: any, userId: string,time_frame:any) {
    return MessageModel.getLeadConversations(leadNumber, phone_number_id, userId,time_frame)
  }



  //   static async processIncomingOrderMessage(msg: any) {
  //     if (!msg || msg.type !== 'order' || !msg.order) {
  //         throw new Error('Invalid order message');
  //     }

  //     const from = msg.from;
  //     const phoneNumberId = msg.phoneNumberId || msg.phone_number_id;
  //     const catalogId = msg.order.catalog_id;
  //     const orderId = msg.id;

  //     // 1. Build a map of productId to quantity from webhook payload
  //     const quantityMap: Record<string, number> = {};
  //     msg.order.product_items.forEach((item: any) => {
  //         quantityMap[item.product_retailer_id] = item.quantity;
  //     });

  //     // 2. Fetch product details from DB
  //     const productDetails = await productsModel.find({
  //         retailer_id: { $in: msg.order.product_items.map((item: any) => item.product_retailer_id) }
  //     });

  //     // 3. Merge DB details with quantity from webhook
  //     const orderDetails = (productDetails || []).map((product: any) => ({
  //         productId: product.productId,
  //         productName: product.name,
  //         salePrice: product.price,
  //         purchasePrice: product.purchasePrice,
  //         quantity: quantityMap[product.retailer_id],
  //         catalogType: product.catalogType,
  //         image: product.image_url,
  //         unit: product.unit,
  //         discount: product.discount
  //     })); 

  //     console.log("Processing Order Details:", orderDetails);

  //     // 4. Optionally, extract selectedProducts if you want just the IDs
  //     const selectedProducts = orderDetails.map((item) => item.productId);

  //     await whatsAppService.productOrderProcessor({
  //         from,
  //         selectedProducts,
  //         catalogId,
  //         orderId,
  //         phoneNumberId,
  //         orderDetails
  //     });
  // }


  async processIncomingOrderMessage(msg: any) {
    console.log("Message", msg)
    console.log("Product Items", JSON.stringify(msg.order.product_items))
    if (!msg || msg.type !== 'order' || !msg.order) {
      throw new Error('Invalid order message');
    }

    const from = msg.from;
    const phoneNumberId = msg.phoneNumberId || msg.phone_number_id;
    const catalogId = msg.order.catalog_id;
    const orderId = msg.id;

    // 1. Build a map of productId to quantity from webhook payload
    const quantityMap: Record<string, number> = {};
    msg.order.product_items.forEach((item: any) => {
      quantityMap[item.product_retailer_id] = item.quantity
    })

    // 2. Fetch product details from DB
    const productDetails = await Promise.all(
      msg.order.product_items.map((item: any) =>
        productVariantModel.findByRetailerId(item.product_retailer_id)
      )
    );
    console.log("Product details", productDetails)

    // 3. Merge DB details with quantity from webhook
    const orderDetails = productDetails
      .filter(product => product)
      .map((product: any) => ({
        productId: product.id,
        productName: product.name,
        salePrice: product.price,
        quantity: quantityMap[product.retailer_id],
        catalogType: product.category_type,
        image: product.image_url,
        unit: product.unit,
        discount: product.discount
      }));

    console.log("Processing Order Details:", orderDetails);

    const selectedProducts = orderDetails.map((item: any) => item.productId);

    await this.productOrderProcessor({
      from,
      selectedProducts,
      catalogId,
      orderId,
      phoneNumberId,
      orderDetails
    });

  }


  async productOrderProcessor(data: any) {
    const { from, selectedProducts, catalogId, orderId, phoneNumberId, orderDetails } = data
    console.log("Processing Order",data)
    const leadfpoId = await userModel.findByPhone(from)
    const fpoNumber = await userModel.findById(leadfpoId.parent_user_id)

    const { parent_user_id, role_id } = leadfpoId
    const { phone } = fpoNumber

    data.userId = parent_user_id,  
    data.roleId = role_id
    data.phoneNumber = phone
    console.log("Product Register Order:", data);

    const registerleadOrder = await this.leadOrderConfirmation(data)

    if (registerleadOrder?.data?.orderId && registerleadOrder?.data?.success === true) {
      console.log("Order registered successfully with ID:", registerleadOrder.data.orderId);
      // await OrderRepository.createOrder({
      //     orderId,
      //     from,
      //     catalogId,
      //     selectedProducts,
      //     phoneNumberId,
      // });

      // Calculate total and format order summary
      let total = 0;
      let summary = "🛒 *Order Summary*\n";
      if (orderDetails && Array.isArray(orderDetails)) {
        orderDetails.forEach((item, idx) => {
          // Use item.item_price from webhook, fallback to item.Price from DB
          const price = Number(String(item.salePrice).replace(/[^\d.]/g, "")) || 0;
          const quantity = Number(item.quantity) || 1;
          total += price * quantity;
          summary += `${idx + 1}. ${item.productName} x${quantity} - ₹${price}\n`;
        });
      } else if (selectedProducts && selectedProducts.length) {
        selectedProducts.forEach((id: string, idx: number) => {
          summary += `${idx + 1}. ${id}\n`;
        });
      }
      summary += `\n*Total:* ₹${total}`;

      // Generate payment link (replace with your payment logic)
      const paymentLink = `https://your-payment-gateway.com/pay?orderId=${orderId}`;

      // Find FPO ID for the user (from lead or session)
      let fpoId = "";
      try {
        fpoId = data.userId || "";
      } catch (e) {
        fpoId = "";
      }

      // Send confirmation and payment link
      await this.sendMessage({
        user_id: data.userId,
        company_id: leadfpoId.company_id,
        phone_number_id: '760184003848443',
        to: from,
        type: "text",
        text: {
          body: `${summary}\n\n You have Order register successfully, Your Order-Id: ${String(registerleadOrder.data.orderId)}`
        }
      });
    }
  }

  async leadOrderConfirmation(data: any) {
    const { roleId, phoneNumber,from, userId, catalogType, orderDetails } = data;
    let total = 0
    console.log("Order Details", data)

    if (orderDetails && Array.isArray(orderDetails)) {
      orderDetails.forEach((item, idx) => {
        const price = Number(String(item.salePrice).replace(/[^\d.]/g, "")) || 0;
        const quantity = Number(item.quantity) || 1;
        total += price * quantity;
      })
    }

    console.log("Order Details for Confirmation:", JSON.stringify(orderDetails))
    const payload = {
      productId: `Product-${Date.now()}`,
      firm: phoneNumber,
      user_id: roleId,
      type: "input",
      status: "IN_PROCESS",
      subtotal: total,
      total_price: total,
      total_discount: 0,
      delivery_fees: 0,
      total_fees: 0,
      billing_type: "CASH",
      createdById: userId,
      mode_of_booking: "DELIVERY",
      cart: orderDetails.map((item: any) => ({
        product_name: item.productName,
        qty: item.quantity,
        unit: item.unit || 0,
        sizeColor: null,
        product_id: item.productId,
        image: item.image,
        category: [item.category],
        subcategory: [item.subCategory],
        price: item.salePrice,
        discount: item.discount,
        total_no: null
      })),
      is_deleted: false
    }

    console.log("Order Confirmation Payload:", JSON.stringify(payload), JSON.stringify(payload.cart))
    const response = await axios.post("https://l07yapr0ub.execute-api.ap-south-1.amazonaws.com/prod/farmer-function/order", payload)
    console.log("Order Confirmation Response:", response.data)

    const existingSessions = await chatSessionModel.findByPhoneNumber(from)
    console.log("Session",existingSessions)
    if(existingSessions){
      await chatSessionModel.update(existingSessions.id,{active:false})
    }
    return response
  }
}

export default new MessageService();

