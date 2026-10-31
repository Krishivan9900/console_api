import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import HTTP400Error from '@surefy/exceptions/HTTP400Error';
import { bucket } from '@surefy/config/firebase.config';
import fs from 'fs';
import path from 'path';
import { ProductVariant } from '../interfaces/catalog.interface';
import { productGroups } from '../interfaces/catalog.interface';
import XLSXParserService from './xlsxParser.service';
import type { BookType } from 'xlsx';
import { PRODUCT_SEARCH_MAX_ITEMS } from './productSearch.logic';

const MEDIA_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'application/pdf': 'pdf',
  'text/csv': 'csv',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
};

// Meta rejects product_list messages with more than 30 items / 10 sections (#131009)
export const PRODUCT_LIST_MAX_ITEMS = PRODUCT_SEARCH_MAX_ITEMS;
const PRODUCT_LIST_MAX_SECTIONS = 10;

/**
 * Trim a product_list payload to what Meta accepts: remove duplicate/empty items,
 * keep at most PRODUCT_LIST_MAX_ITEMS products and drop sections left empty.
 * Any other payload is returned untouched.
 */
export function limitProductListItems(payload: any): any {
  const interactive = payload?.interactive;
  if (interactive?.type !== 'product_list' || !Array.isArray(interactive.action?.sections)) {
    return payload;
  }

  const seen = new Set<string>();
  const sections: any[] = [];
  let total = 0;
  let kept = 0;

  for (const section of interactive.action.sections) {
    const items: any[] = [];
    for (const item of section?.product_items || []) {
      const id = item?.product_retailer_id;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      total++;
      if (kept < PRODUCT_LIST_MAX_ITEMS && sections.length < PRODUCT_LIST_MAX_SECTIONS) {
        items.push(item);
        kept++;
      }
    }
    if (items.length > 0) sections.push({ ...section, product_items: items });
  }

  if (kept < total) {
    console.warn(`⚠️ product_list trimmed: sending ${kept} of ${total} products`);
  }

  return {
    ...payload,
    interactive: {
      ...interactive,
      action: { ...interactive.action, sections },
    },
  };
}

const SPREADSHEET_BOOK_TYPES: Record<string, BookType> = {
  'text/csv': 'csv',
  'application/vnd.ms-excel': 'biff8',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
};


class MetaService {
  private client: AxiosInstance;
  private apiVersion: string;
  private accessToken: string;

  constructor() {
    this.apiVersion = process.env.META_API_VERSION || 'v18.0';
    this.accessToken = process.env.META_ACCESS_TOKEN || '';

    this.client = axios.create({
      baseURL: `https://graph.facebook.com/${this.apiVersion}`,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.accessToken}`,
      },
    });
  }

  /**
   * Send a message via WhatsApp Business API
   */
  async sendMessage(phoneNumberId: string, payload: any): Promise<any> {
    payload = limitProductListItems(payload);
    try {
      const response = await this.client.post(`/${phoneNumberId}/messages`, payload);
      return response.data;
    } catch (error: any) {
      console.log(`Sending message via Meta API to phone number ID: ${phoneNumberId} with payload: ${JSON.stringify(payload)}`);
      console.error('Meta API Error - Send Message:', error.response?.data || error.message);
      throw new HTTP400Error({
        message: 'Failed to send message via Meta API',
        details: error.response?.data || error.message,
      });
    }
  }

  /**
   * Handle Media,file,document
   */
  async handleMedia(mediaId: string): Promise<any> {
    try {
      const mediaRes = await this.client.get(`/${mediaId}`);
      const mediaUrl = mediaRes.data.url;
      console.log("📥 Media URL:", mediaUrl);

      // Step 2: Download image
      const downloadRes = await axios.get(mediaUrl, {
        responseType: 'arraybuffer',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
        },
      });

      let buffer = Buffer.from(downloadRes.data);
      const mimeType: string = (mediaRes.data.mime_type || 'image/jpeg').split(';')[0].trim();
      const extension = MEDIA_EXTENSIONS[mimeType] || 'jpg';

      // Spreadsheets (e.g. FPO farmer import): drop repeated phone numbers before anyone reads the file
      const spreadsheetBookType = SPREADSHEET_BOOK_TYPES[mimeType];
      if (spreadsheetBookType) {
        try {
          const result = XLSXParserService.removeDuplicatePhoneRows(buffer, spreadsheetBookType);
          buffer = result.buffer;
          console.log(`🧹 Spreadsheet rows: ${result.total}, duplicate phone rows removed: ${result.removed}`);
        } catch (error: any) {
          console.error('Spreadsheet dedupe skipped:', error.message);
        }
      }

      // Step 3: Create filename
      const fileName = `${mediaId}_${Date.now()}.${extension}`;

      // Step 4: Upload to Firebase Storage
      const file = bucket.file(fileName);

      await file.save(buffer, {
        metadata: {
          contentType: mimeType,
        },
      });

      // Make file public
      await file.makePublic();

      const firebaseUrl = `https://storage.googleapis.com/${bucket.name}/${file.name}`;

      console.log("✅ Firebase URL:", firebaseUrl);

      // Optional: Save locally
      const uploadsDir = path.join(__dirname, '../uploads');
      fs.mkdirSync(uploadsDir, { recursive: true });

      const filePath = path.join(uploadsDir, fileName);
      fs.writeFileSync(filePath, buffer);

      console.log(`✅ Image saved locally: ${filePath}`);

      const imageRecord = {
        firebaseUrl,
        filename: fileName,
        path: filePath,
        mime_type: mimeType,
      };

      console.log("📦 Image record:", imageRecord);

      return imageRecord;
    } catch (error: any) {
      console.error('Meta API Error - Mark as Read:', error.response?.data || error.message);
      throw new HTTP400Error({
        message: 'Failed to mark message as read',
        details: error.response?.data || error.message,
      });
    }

  }

  /** Download an inbound Meta media document without converting or uploading it. */
  async downloadMediaBuffer(mediaId: string): Promise<{ buffer: Buffer; mimeType?: string; fileName?: string }> {
    try {
      const mediaResponse = await this.client.get(`/${mediaId}`);
      const downloadResponse = await axios.get(mediaResponse.data.url, {
        responseType: 'arraybuffer',
        headers: { Authorization: `Bearer ${this.accessToken}` },
      });

      return {
        buffer: Buffer.from(downloadResponse.data),
        mimeType: mediaResponse.data.mime_type,
        fileName: mediaResponse.data.file_name,
      };
    } catch (error: any) {
      throw new HTTP400Error({
        message: 'Failed to download Meta media document',
        details: error.response?.data || error.message,
      });
    }
  }
  /**
   * Mark message as read
   */
  async markAsRead(phoneNumberId: string, messageId: string): Promise<any> {
    try {
      const response = await this.client.post(`/${phoneNumberId}/messages`, {
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
      });
      return response.data;
    } catch (error: any) {
      console.error('Meta API Error - Mark as Read:', error.response?.data || error.message);
      throw new HTTP400Error({
        message: 'Failed to mark message as read',
        details: error.response?.data || error.message,
      });
    }
  }

  /**
   * Get all message templates for a WABA
   */
  async getTemplates(wabaId: string): Promise<any> {
    try {
      const response = await this.client.get(`/${wabaId}/message_templates`, {
        params: {
          limit: 100,
        },
      });
      return response.data;
    } catch (error: any) {
      console.error('Meta API Error - Get Templates:', error.response?.data || error.message);
      throw new HTTP400Error({
        message: 'Failed to fetch templates from Meta API',
        details: error.response?.data || error.message,
      });
    }
  }

  /**
   * Create a new message template
   */
  async createTemplate(wabaId: string, templateData: any): Promise<any> {
    try {
      const response = await this.client.post(`/${wabaId}/message_templates`, templateData);
      return response.data;
    } catch (error: any) {
      console.error('Meta API Error - Create Template:', error.response?.data || error.message);
      throw new HTTP400Error({
        message: 'Failed to create template via Meta API',
        details: error.response?.data || error.message,
      });
    }
  }

  /**
   * Delete a message template
   */
  async deleteTemplate(wabaId: string, templateName: string): Promise<any> {
    try {
      const response = await this.client.delete(`/${wabaId}/message_templates`, {
        params: {
          name: templateName,
        },
      });
      return response.data;
    } catch (error: any) {
      console.error('Meta API Error - Delete Template:', error.response?.data || error.message);
      throw new HTTP400Error({
        message: 'Failed to delete template via Meta API',
        details: error.response?.data || error.message,
      });
    }
  }

  /**
   * Get WABA phone numbers
   */
  async getPhoneNumbers(wabaId: string): Promise<any> {
    try {

      const response =
        await this.client.get(`/${wabaId}/phone_numbers`);

      console.log("✅ Phone Numbers:", response.data);

      return response.data;

    } catch (error: any) {

      const metaError = error?.response?.data?.error;

      console.error(
        '❌ Meta API Error - Get Phone Numbers:',
        metaError || error
      );

      if (metaError) {

        throw new HTTP400Error({
          message: metaError.message,
          details: {
            type: metaError.type,
            code: metaError.code,
            error_data: metaError.error_data,
            fbtrace_id: metaError.fbtrace_id
          }
        });
      }

      throw new HTTP400Error({
        message: error.message || 'Unknown Meta API error'
      });
    }
  }

  /**
   * Veriified Phone Numbers
   */
  async verifiedPhoneNumbers(phoneNumberId:string):Promise<any>{
    try{
      const response = await this.client.post(`/${phoneNumberId}/register`,{
          "messaging_product": "whatsapp",
          "pin": "123456"
      });
      console.log("Response Verified Data data",response.data)
      return response.data
    }catch(error:any){
      console.error('Meta API Error - Get Phone Numbers:', error.response?.data || error.message);
      throw new HTTP400Error({
        message:'Failed to fetch phone numbers from Meta API',
        details: error.response?.data || error.message
      });
    }
  }

  /**
   * Get phone number details
   */
  async getPhoneNumberDetails(phoneNumberId: string): Promise<any> {
    try {
      const response = await this.client.get(`/${phoneNumberId}`, {
        params: {
          fields: 'id,verified_name,display_phone_number,quality_rating,code_verification_status',
        },
      });
      console.log("Response",response.data)
      return response.data;
    } catch (error: any) {
      console.error('Meta API Error - Get Phone Number Details:', error.response?.data || error.message);
      throw new HTTP400Error({
        message: 'Failed to fetch phone number details from Meta API',
        details: error.response?.data || error.message,
      });
    }
  }

  /**
   * Upload media to Meta
   */
  async uploadMedia(
    phoneNumberId: string,
    file: Pick<Express.Multer.File, 'originalname' | 'mimetype'> & Partial<Express.Multer.File>,
    type: string
  ): Promise<any> {
    try {
      const FormData = require('form-data');
      const fs = require('fs');
      const formData = new FormData();
      formData.append('messaging_product', 'whatsapp');
      
      // WhatsApp API expects the file as a stream or buffer
      const content = file.buffer || (file.path ? fs.createReadStream(file.path) : null);
      if (!content) throw new Error('Media upload requires a file buffer or path');
      formData.append('file', content, {
        filename: file.originalname,
        contentType: file.mimetype,
      });


      const headers = formData.getHeaders();
      headers['Authorization'] = `Bearer ${this.accessToken}`;

      const response = await this.client.post(`/${phoneNumberId}/media`, formData, {
        headers,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      });
      return response.data;
    } catch (error: any) {
      console.error('Meta API Error - Upload Media:', error.response?.data || error.message);
      throw new HTTP400Error({
        message: 'Failed to upload media to Meta API',
        details: error.response?.data || error.message,
      });
    }
  }

  /**
   * Get media URL
   */
  async getMediaUrl(mediaId: string): Promise<any> {
    try {
      const response = await this.client.get(`/${mediaId}`);
      return response.data;
    } catch (error: any) {
      console.error('Meta API Error - Get Media URL:', error.response?.data || error.message);
      throw new HTTP400Error({
        message: 'Failed to get media URL from Meta API',
        details: error.response?.data || error.message,
      });
    }
  }

  /**
   * Subscribe WABA Id
   */
  async subscribeToWebhooks(wabaId:any){
    try{
      const response = await this.client.get(`/${wabaId}/subscribed_apps`,{
      params : {
        subscribed_fields:'messages,message_deliveries,message_reads'
      }
      })
      return response.data;
    }catch(error:any){
      console.error('Meta API Error - Failed to subscribe to webhooks', error.response?.data || error.message);
      throw new HTTP400Error({
        message: 'Failed to fetch phone number details from Meta API',
        details: error.response?.data || error.message,
      });
    }
  }

  /**
   * Create Variant in catalog 
   */
  async createProductVariantBatch(catalog_id: string, variant: ProductVariant): Promise<any> {
    const result = await this.createProductVariantsBatch(catalog_id, [variant]);
    const item = result.items[0];
    if (item.status === 'failed') {
      throw new HTTP400Error({ message: item.error, details: item.details });
    }
    return { handles: result.handles, sync_status: item.status };
  }

  private catalogError(error: any): HTTP400Error {
    const meta = error.response?.data?.error || error;
    return new HTTP400Error({
      message: `Meta catalog request failed: ${meta.message || 'Unknown error'}`,
      details: {
        code: meta.code,
        type: meta.type,
        error_subcode: meta.error_subcode,
        fbtrace_id: meta.fbtrace_id,
        error_user_msg: meta.error_user_msg,
      },
    });
  }

  async getCatalogDetails(catalogId: string): Promise<any> {
    try {
      const response = await this.client.get(`/${catalogId}`, { params: { fields: 'id,name' } });
      return response.data;
    } catch (error: any) {
      throw this.catalogError(error);
    }
  }

  /** Submit products together and confirm ingestion instead of treating a handle as success. */
  async createProductVariantsBatch(catalogId: string, variants: ProductVariant[]): Promise<any> {
    try {
      const response = await this.client.post(`/${catalogId}/batch`, {
        allow_upsert: true,
        requests: variants,
      });
      const body = response.data;
      if (body.error) throw { response: { data: body } };
      const items = variants.map(variant => {
        const validation = body.validation_status?.find((row: any) => row.retailer_id === variant.retailer_id);
        const errors = validation?.errors || [];
        return {
          retailer_id: variant.retailer_id,
          status: errors.length ? 'failed' : 'pending',
          ...(errors.length ? { error: errors.map((error: any) => error.message).join('; '), details: errors } : {}),
        } as any;
      });
      const handles = Array.isArray(body.handles) ? body.handles.filter((handle: any) => typeof handle === 'string' && handle) : [];
      if (!handles.length) {
        for (const item of items.filter(item => item.status === 'pending')) {
          item.status = 'failed';
          item.error = 'Meta returned no batch handle; no product ingestion was confirmed';
        }
        return { handles, items };
      }

      let finished = true;
      for (const handle of handles) {
        let status: any;
        for (let attempt = 0; attempt < 15; attempt++) {
          const result = await this.client.get(`/${catalogId}/check_batch_request_status`, {
            params: { handle, load_ids_of_invalid_requests: true },
          });
          status = result.data?.data?.[0];
          if (!status || !['started', 'in progress', 'pending'].includes(String(status.status).toLowerCase())) break;
          if (attempt < 14) await new Promise(resolve => setTimeout(resolve, 1000));
        }
        if (!status || String(status.status).toLowerCase() !== 'finished') finished = false;
        const errors = status?.errors || [];
        const invalidIds = new Set((status?.ids_of_invalid_requests || []).map(String));
        if (Number(status?.errors_total_count) > 0 || errors.length || invalidIds.size) {
          const knownIds = new Set(items.map(item => item.retailer_id));
          const hasUnattributedErrors = [...invalidIds].some(id => !knownIds.has(id as string)) ||
            errors.some((error: any) => !error.id || !knownIds.has(String(error.id))) ||
            (!invalidIds.size && !errors.length);
          for (const item of items.filter(item => item.status === 'pending')) {
            const matchingErrors = errors.filter((error: any) => String(error.id) === item.retailer_id);
            // Without item IDs, do not claim that the rest of the batch succeeded.
            if (invalidIds.has(item.retailer_id) || matchingErrors.length ||
                hasUnattributedErrors) {
              item.status = 'failed';
              item.error = (matchingErrors.length ? matchingErrors : errors)
                .map((error: any) => error.message || String(error)).join('; ') || 'Meta rejected the product during ingestion';
              item.details = status;
            }
          }
        }
        if (status && ['failed', 'error'].includes(String(status.status).toLowerCase())) {
          for (const item of items.filter(item => item.status === 'pending')) {
            item.status = 'failed';
            item.error = 'Meta batch processing failed';
            item.details = status;
          }
        }
      }
      if (finished) items.filter(item => item.status === 'pending').forEach(item => { item.status = 'synced'; });
      return { handles, items };
    } catch (error: any) {
      throw this.catalogError(error);
    }
  }

  /**
   * Get WABA account details to verify it exists
   */
  async getWabaDetails(wabaId: string): Promise<any> {
    try {
      const response = await this.client.get(`/${wabaId}`, {
        params: {
          fields: 'id,name,currency,message_template_namespace,phone_numbers',
        },
      });
      return response.data;
    } catch (error: any) {

  console.error(
    "❌ Raw Meta Error:",
    error?.response?.data || error
  )

  // Preserve Meta API error
  if (error?.response?.data?.error) {

    const metaError = error.response.data.error

    throw new HTTP400Error({
      message: metaError.message,
      details: {
        type: metaError.type,
        code: metaError.code,
        subcode: metaError.error_subcode,
        fbtrace_id: metaError.fbtrace_id
      }
    })
  }

  // fallback
  throw error
    }
  }

  /**
   * Get every product in a catalog (follows Meta pagination)
   */
  async getAllCatalogProducts(catalogId: string): Promise<any[]> {
    const products: any[] = [];
    let response = await this.client.get(`/${catalogId}/products`, {
      params: {
        fields: 'id,name,description,retailer_id,brand,category,price,availability,review_status,image_url',
        limit: 100,
      },
    });

    for (let page = 0; page < 50; page++) {
      products.push(...(response.data?.data || []));
      const next = response.data?.paging?.next;
      if (!next) break;
      response = await axios.get(next);
    }

    return products;
  }

  /**
   * Sync Catalog Variant Product
   */
  async syncCatalogVariant(catalogId: string): Promise<any> {
    try {
      const response = await this.client.get(`/${catalogId}/products`, {
        params: {
          fields: 'id,name,price,description,image_url,url,category,retailer_id,brand',
        },
      });
      console.log("Response",response.data.data)
      return response.data.data
    } catch (error: any) {

      console.error(
        "❌ Raw Meta Error:",
        error?.response?.data || error
      )

      // Preserve Meta API error
      if (error?.response?.data?.error) {

        const metaError = error.response.data.error

        throw new HTTP400Error({
          message: metaError.message,
          details: {
            type: metaError.type,
            code: metaError.code,
            subcode: metaError.error_subcode,
            fbtrace_id: metaError.fbtrace_id
          }
        })
      }

      // fallback
      throw error
    }
  }
}

export default new MetaService();
