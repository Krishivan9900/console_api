import HTTP404Error from '@surefy/exceptions/HTTP404Error';
import HTTP400Error from '@surefy/exceptions/HTTP400Error';
import HTTP401Error from '@surefy/exceptions/HTTP401Error';
import { CreateGroupVariantsRequest, ProductVariant } from '../interfaces/catalog.interface';
import { productGroups } from '../interfaces/catalog.interface';
import productGroupModel from '../models/productGroup.model';
import productVariantModel from '../models/productVariant.model';
import { bucket, uploadImage } from '@surefy/config/firebase.config';
import { createHash } from 'crypto';
import metaService from './meta.service';
import catalogRepository from '../repository/catalog.repository';
import axios from 'axios';

class catalogService {
    private catalogImageUploads?: Map<string, Promise<string>>;
    /**
     *POST /v1/  
     */
    private async getAllOrgVariants() {
        const url = 'https://l07yapr0ub.execute-api.ap-south-1.amazonaws.com/prod/farmer-function/api/integrations/whatsapp/product-variants';

        try {
            const { data } = await axios.get(
                url,
                // {}, // Empty request body: this endpoint returns all organization variants.
                {
                    timeout: 30000,
                    headers: {
                        'X-Internal-Api-Key': 'krishiwhatsappskjf4543k',
                        // 'Content-Type': 'application/json',
                    },
                },
            );

            if (!data?.success || !Array.isArray(data?.data)) {
                throw new Error(data?.message || 'Invalid product variants response');
            }

            console.log(`Fetched ${data.data.length} organization variants`);
            return data.data;
        } catch (error: any) {
            const message = error.response?.data?.message || error.message;
            throw new Error(`Failed to fetch organization variants: ${message}`);
        }
    }

    /**
     * Sync /v1/
     */
    private async catalogImageUrl(image: any): Promise<string> {
        const value = String(image || '').trim();
        if (/^https?:\/\//i.test(value)) return new URL(value).href;
        if (value.startsWith('blob:')) throw new Error('Product image is a browser-only blob URL. Upload the product image in the product admin and save its public HTTPS URL before syncing.');
        const match = value.match(/^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=\s]+)$/);
        if (!match) throw new Error('Product image must be an HTTP(S) URL or a supported base64 image');
        const content = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
        if (!content.length || content.length > 10 * 1024 * 1024) throw new Error('Product image is empty or exceeds 10 MB');
        const extension = match[1].split('/')[1];
        const hash = createHash('sha256').update(content).digest('hex');
        const objectName = `products/catalog/${hash}.${extension}`;
        this.catalogImageUploads ??= new Map();
        const existingUpload = this.catalogImageUploads.get(objectName);
        if (existingUpload) return existingUpload;
        const upload = (async () => {
            const file = bucket.file(objectName);
            await file.save(content, { metadata: { contentType: match[1] } });
            await file.makePublic();
            return `https://storage.googleapis.com/${bucket.name}/${objectName}`;
        })();
        this.catalogImageUploads.set(objectName, upload);
        try { return await upload; }
        finally { this.catalogImageUploads.delete(objectName); }
    }

    private async syncVariant(variant: any, catalogId: string, groups: any[]) {
        try {
            const variantName = String(variant.variantsName ?? variant.variantName ?? variant.productName ?? "Unnamed variant");
            const productName = String(variant.productName ?? "");
            const categoryName = String(variant.categoryName ?? "");
            const subCategoryName = String(variant.subCategoryName ?? "");
            const sourceVariantId = String(variant.variant_id ?? variant._id ?? "");

            if (!sourceVariantId) {
                throw new Error("Variant id is missing");
            }

            console.log(
                `[SYNC] Processing Variant: ${sourceVariantId}`
            );

            // Find matching product group/category
            const existingCatalog = groups.find(group => group.catalog_id === catalogId &&
                Array.isArray(group.categories) && group.categories.some((category: string) =>
                    category.toLowerCase() === categoryName.toLowerCase()));

            if (!existingCatalog) {
                throw new Error(
                    `Category '${categoryName}' does not exist`
                );
            }

            console.log(
                `[SYNC] Found Catalog: ${existingCatalog.id}`
            );

            // variant_id identifies one variant. product_id can have many variants.
            const existingVariant = await productVariantModel.findByVariantId(sourceVariantId, catalogId);
            const isNewVariant = !existingVariant;

            const retailer_id = `${variantName}-${sourceVariantId}`
                .replace(/[^a-zA-Z0-9]+/g, "_")
                .replace(/^_+|_+$/g, "");

            const imageUrl = await this.catalogImageUrl(variant.productImage);
            const price = Number(variant.salePrice);
            if (!Number.isFinite(price) || price <= 0) throw new Error('Product sale price must be greater than zero');
            const productUrl = variant.url || process.env.CATALOG_PRODUCT_URL || 'https://fpo-krishivan.web.app/';
            const rawGst = variant.gst ?? variant.gstRate;
            const gst = typeof rawGst === 'string'
                ? (rawGst.trim() ? Number(rawGst.replace(/%/g, '').trim()) : null)
                : rawGst ?? null;
            if (typeof gst === 'number' && !Number.isFinite(gst)) throw new Error('Product GST rate must be numeric');

            const dbpayloadVariant = {
                // Older product-based syncs assigned the same retailer ID to sibling variants.
                // Only reuse an ID when it belongs to this source variant.
                retailer_id: existingVariant?.retailer_id?.endsWith(`_${sourceVariantId}`)
                    ? existingVariant.retailer_id : (retailer_id.length > 100
                    ? `${retailer_id.slice(0, 100 - sourceVariantId.length - 1)}_${sourceVariantId}` : retailer_id),
                product_group_id: existingCatalog.id,
                catalog_id: existingCatalog.catalog_id,

                product_id: variant.product_id || null,
                variant_id: sourceVariantId,

                name: variantName.toLowerCase(),
                description: `Product ${productName}`,

                brand: String(variant.brandName ?? ""),
                color: variant.color || null,
                size: variant.sizeColor || null,

                price,
                quantity: String(variant.quantity ?? "0"),
                unit: String(variant.unit ?? ""),

                currency: "INR",
                availability: "in stock",
                condition: "new",

                image_url: imageUrl,
                url: productUrl,

                gst,
                sub_category: subCategoryName.toLowerCase() || null,
                category: categoryName.toLowerCase(),

                product_added_by: variant.user_id,
                meta_status: "pending",
            };

            const metaPayloadVariant = {
                name: variantName,
                description: `Product ${productName}`,
                color: variant.color || null,
                price: Math.round(price * 100),
                size: variant.sizeColor || null,
                availability: "in stock",
                condition: "new",
                brand: String(variant.brandName ?? ""),
                image_url: imageUrl,
                url: productUrl,
                currency: "INR"
            };

            // Store locally before contacting Meta. This makes local sync durable.
            const savedVariant = isNewVariant
                ? await productVariantModel.create(dbpayloadVariant)
                : await productVariantModel.update(existingVariant.id, dbpayloadVariant);

            return {
                savedVariant,
                source: variant,
                request: {
                    // A previous failed attempt may exist locally without any corresponding Meta item.
                    method: 'UPDATE' as const,
                    item_type: 'PRODUCT_ITEM' as const,
                    retailer_id: dbpayloadVariant.retailer_id,
                    data: metaPayloadVariant,
                },
            };
        } catch (error: any) {
            console.error(
                `[SYNC ERROR] Variant ${variant?.variant_id}`,
                error.message
            );

            console.error(error);

            throw error;
        }
    }



    /**
    * POST /v1/catalog/groups
    * Create new group
    */
    async createGroup(data: productGroups) {
        const productGroup = await productGroupModel.create(data)
        return productGroup
    }

    /**
     * Create Group Variant
     */
    async createGroupVariants(
        groupId: string,
        catalog_id: string,
        variants: any[],
        images: Express.Multer.File[]
    ) {
        try {
            const createdVariants = await Promise.all(
                variants.map(async (variant: any) => {
                    if (!variant.data.image_url) {
                        const imageFile = images[variant.data.image_index];

                        if (!imageFile) {
                            throw new Error("Image File Missing");
                        }

                        const uploadImageUrl = await uploadImage(imageFile)
                        variant.data.image_url = uploadImageUrl;
                    }

                    delete variant.data.image_index;

                    const response = await metaService.createProductVariantBatch(catalog_id, variant)

                    if (!response?.handles) {
                        throw new Error(
                            response?.error?.message ||
                            "Meta Variant Upload Failed"
                        );
                    }

                    const savedVariant = await catalogRepository.createVariant({
                        ...variant.data,
                        retailer_id: variant.retailer_id,
                        product_group_id: groupId,
                        meta_status: response.sync_status || "pending"
                    });

                    return {
                        savedVariant,
                        metaHandle: response.handles[0]
                    }
                })
            );

            return createdVariants
        } catch (error: any) {
            console.error('[Campaign Scheduler] Error checking scheduled campaigns:', error.message);
        }
    }

    /**
     * Sync Meta Catalog Variant
     */

    async syncMetaCatalogVariant(catalogId: string) {
        try {
            const catalogVariants = await metaService.syncCatalogVariant(catalogId);

            const results = await Promise.all(
                catalogVariants.map(async (variant: any) => {
                    try {
                        const existingProduct =
                            await productVariantModel.findByRetailerId(
                                variant.retailer_id
                            );

                        const productCategory =
                            await productGroupModel.findGroupByCategory(
                                variant.category,
                                catalogId
                            );

                        if (!productCategory) {
                            return {
                                retailer_id: variant.retailer_id,
                                operation: "skipped",
                                reason: "Category not found",
                            };
                        }

                        if (!existingProduct) {
                            const created =
                                await productVariantModel.create({
                                    product_group_id: productCategory.id,
                                    retailer_id: variant.retailer_id,
                                    name: variant.name,
                                    description: variant.description,
                                    color: variant.color,
                                    size: variant.size,
                                    price: variant.price,
                                    url: variant.url,
                                    condition: variant.condition,
                                    availability: variant.availability,
                                    currency: variant.currency,
                                    brand: variant.brand,
                                    image_url: variant.image_url,
                                    category: variant.category,
                                    catalog_id: catalogId
                                });

                            return {
                                retailer_id: variant.retailer_id,
                                operation: "created",
                                data: created,
                            };
                        }

                        const updated =
                            await productVariantModel.update(
                                existingProduct.id,
                                {
                                    product_group_id: productCategory.id,
                                    name: variant.name,
                                    description: variant.description,
                                    color: variant.color,
                                    size: variant.size,
                                    price: variant.price,
                                    url: variant.url,
                                    condition: variant.condition,
                                    availability: variant.availability,
                                    currency: variant.currency,
                                    brand: variant.brand,
                                    image_url: variant.image_url,
                                    category: variant.category,
                                    catalog_id: catalogId
                                }
                            );

                        return {
                            retailer_id: variant.retailer_id,
                            operation: "updated",
                            data: updated,
                        };
                    } catch (error: any) {
                        return {
                            retailer_id: variant.retailer_id,
                            operation: "failed",
                            error: error.message,
                        };
                    }
                })
            );

            return {
                total: catalogVariants.length,
                created: results.filter(r => r.operation === "created").length,
                updated: results.filter(r => r.operation === "updated").length,
                skipped: results.filter(r => r.operation === "skipped").length,
                failed: results.filter(r => r.operation === "failed").length,
                results,
            };
        } catch (error: any) {
            console.error(
                "[Campaign Scheduler] Error checking scheduled campaigns:",
                error.message
            );
            throw error;
        }
    }

    /**
     * Get Product Variant data
     */
    // async getProductVariants(category: string, catalog_id: string) {
    //     console.log("Category", category, catalog_id)
    //     const existingCategory = await productGroupModel.findGroupByCategory(category, catalog_id)
    //     const existingProductVariant = await productVariantModel.findByCategory(category, catalog_id,)
    //     if (!existingCategory || !existingProductVariant || existingProductVariant.length === 0) {
    //         return { success: false, message: "Product Variant with those category not exists" }
    //     }
    //     const retailerIds = existingProductVariant.map(
    //         (product) => product.retailer_id
    //     );

    //     return {
    //         success: true,
    //         data: retailerIds,
    //     };
    // }


async getProductVariants(name: string, catalog_id: string) {
    console.log("Product Name:", name, "Catalog ID:", catalog_id);

    const existingProductVariants =
        await productVariantModel.findByProductName(name, catalog_id);

    console.log("Existing Products",existingProductVariants)

    if (!existingProductVariants || existingProductVariants.length === 0) {
        return {
            success: false,
            message: "No matching product variants found",
        };
    }

    const retailerIds = existingProductVariants.map(
        (product: any) => product.retailer_id
    );

    return {
        success: true,
        data: retailerIds,
    };
}

    /**
     * Get Catalog Groups
     */
    async getAllCatalogGroups(company_id: string, user_id: string) {
        return await productGroupModel.getCatalogGroups(company_id, user_id)
    }

    /**
     * Get Group Variants
     */
    async getAllGroupVariants(company_id: string, user_id: string, groupId: string) {
        return await productVariantModel.getGroupVariants(groupId)
    }

    /**
     * Update Group Variant
     */
    async updateGroupVariant(variantId: string) {
        // return await 
    }

    /**
     * Sync Organization variants
     */
    async syncOrganizationCatalog(
        user_id: string,
        company_id: string,
        catalogId = process.env.META_CATALOG_ID || '795853123055079',
    ) {
        try {
            const groups = (await productGroupModel.getCatalogGroups(company_id, user_id))
                .filter((group: any) => group.catalog_id === catalogId);
            if (!groups.length) throw new HTTP400Error({ message: 'No product groups found for this organization and catalog' });
            // Fail once with the actual OAuth/permissions error instead of repeating it for every variant.
            await metaService.getCatalogDetails(catalogId);
            const orgData = await this.getAllOrgVariants();

            console.log(
                `Found ${orgData?.length || 0} variants to sync`
            );

            const results = {
                total: orgData.length,
                success: 0,
                failed: 0,
                pending: 0,
                errors: [] as any[],
                batches: [] as any[],
            };

            const prepared: any[] = [];
            const recordFailure = (variant: any, error: any) => {
                results.failed++;
                results.errors.push({
                    variant_id: variant.variant_id || variant._id,
                    product_id: variant.product_id,
                    error: error.message,
                    ...(error.details ? { details: error.details } : {}),
                });
            };

            // Bound database/image work so a large catalog does not make the request wait
            // for hundreds of sequential round trips, or exhaust the connection pool.
            for (let offset = 0; offset < orgData.length; offset += 8) {
                await Promise.all(orgData.slice(offset, offset + 8).map(async (variant: any) => {
                    try {
                        prepared.push(await this.syncVariant(variant, catalogId, groups));
                    } catch (error: any) {
                        recordFailure(variant, error);
                    }
                }));
            }

            // Submit bounded batches, then apply each item's confirmed ingestion result.
            for (let offset = 0; offset < prepared.length; offset += 100) {
                const batch = prepared.slice(offset, offset + 100);
                let response: any;
                try {
                    response = await metaService.createProductVariantsBatch(catalogId, batch.map(item => item.request));
                } catch (error: any) {
                    for (const item of batch) {
                        try { await productVariantModel.update(item.savedVariant.id, { meta_status: 'failed' }); }
                        catch (storageError: any) { console.error('Failed to persist Meta failure status:', storageError.message); }
                        recordFailure(item.source, error);
                    }
                    continue;
                }
                results.batches.push({ handles: response.handles, retailer_ids: batch.map(item => item.request.retailer_id) });
                for (let index = 0; index < batch.length; index += 8) {
                    await Promise.all(batch.slice(index, index + 8).map(async item => {
                        try {
                            const outcome = response.items.find((result: any) => result.retailer_id === item.request.retailer_id);
                            const status = outcome?.status || 'failed';
                            await productVariantModel.update(item.savedVariant.id, { meta_status: status });
                            if (status === 'synced') results.success++;
                            else if (status === 'pending') results.pending++;
                            else recordFailure(item.source, {
                                message: outcome?.error || 'Meta did not return a result for this product', details: outcome?.details,
                            });
                        } catch (storageError: any) {
                            recordFailure(item.source, { message: `Could not save Meta sync result: ${storageError.message}` });
                        }
                    }));
                }
            }

            console.log("Catalog Sync Completed", results);

            return {
                message: results.failed ? 'Organization catalog sync has failures'
                    : results.pending ? 'Organization catalog sync is still processing in Meta'
                    : 'Organization catalog sync completed',
                ...results,
            };
        } catch (error: any) {
            console.error(
                "[Organization Catalog Sync Error]",
                error.message
            );

            throw error;
        }
    }

}

export default new catalogService();
