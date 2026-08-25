import HTTP404Error from '@surefy/exceptions/HTTP404Error';
import HTTP400Error from '@surefy/exceptions/HTTP400Error';
import HTTP401Error from '@surefy/exceptions/HTTP401Error';
import { CreateGroupVariantsRequest, ProductVariant } from '../interfaces/catalog.interface';
import { productGroups } from '../interfaces/catalog.interface';
import productGroupModel from '../models/productGroup.model';
import productVariantModel from '../models/productVariant.model';
import { uploadImage } from '@surefy/config/firebase.config';
import metaService from './meta.service';
import catalogRepository from '../repository/catalog.repository';
import axios from 'axios';

class catalogService {
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
    private async syncVariant(variant: any) {
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
            const existingCatalog =
                await productGroupModel.findGroupByCategory(
                    categoryName,
                    "795853123055079"
                );

            if (!existingCatalog) {
                throw new Error(
                    `Category '${categoryName}' does not exist`
                );
            }

            console.log(
                `[SYNC] Found Catalog: ${existingCatalog.id}`
            );

            // variant_id identifies one variant. product_id can have many variants.
            const existingVariant = await productVariantModel.findByVariantId(sourceVariantId);
            const isNewVariant = !existingVariant;

            const retailer_id = `${variantName}-${sourceVariantId}`
                .replace(/[^a-zA-Z0-9]+/g, "_")
                .replace(/^_+|_+$/g, "");

            const dbpayloadVariant = {
                retailer_id: existingVariant?.retailer_id || retailer_id,
                product_group_id: existingCatalog.id,
                catalog_id: existingCatalog.catalog_id,

                product_id: variant.product_id || null,
                variant_id: sourceVariantId,

                name: variantName.toLowerCase(),
                description: `Product ${productName}`,

                brand: String(variant.brandName ?? ""),
                color: variant.color || null,
                size: variant.sizeColor || null,

                price: Number(variant.salePrice) || 0,
                quantity: String(variant.quantity ?? "0"),
                unit: String(variant.unit ?? ""),

                currency: "INR",
                availability: "in stock",
                condition: "new",

                image_url: String(variant.productImage ?? ""),
                url: variant.url || "https://example.com",

                gst: variant.gst,
                sub_category: subCategoryName.toLowerCase() || null,
                category: categoryName.toLowerCase(),

                product_added_by: variant.user_id,
                meta_status: "pending",
            };

            const metaPayloadVariant = {
                name: variantName,
                description: `Product ${productName}`,
                color: variant.color || null,
                price: Math.round((Number(variant.salePrice) || 0) * 100),
                size: variant.sizeColor || null,
                availability: "in stock",
                condition: "new",
                brand: String(variant.brandName ?? ""),
                image_url: String(variant.productImage ?? ""),
                url: variant.url || "https://example.com/products/shoe-red-42",
                currency: "INR"
            };

            // Store locally before contacting Meta. This makes local sync durable.
            const savedVariant = isNewVariant
                ? await productVariantModel.create(dbpayloadVariant)
                : await productVariantModel.update(existingVariant.id, dbpayloadVariant);

            try {
                const response = await metaService.createProductVariantBatch(
                    existingCatalog.catalog_id,
                    {
                        method: isNewVariant ? "CREATE" : "UPDATE",
                        item_type: "PRODUCT_ITEM",
                        retailer_id: dbpayloadVariant.retailer_id,
                        data: metaPayloadVariant,
                    },
                );

                if (!response?.handles) {
                    throw new Error(response?.error?.message || "Meta Variant Upload Failed");
                }

                return await productVariantModel.update(savedVariant.id, {
                    meta_status: "synced",
                });
            } catch (metaError: any) {
                await productVariantModel.update(savedVariant.id, {
                    meta_status: "failed",
                });

                throw new Error(`Variant stored locally but Meta sync failed: ${metaError.message}`);
            }
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
                        meta_status: "synced"
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
    ) {
        try {
            const orgData = await this.getAllOrgVariants();

            console.log(
                `Found ${orgData?.length || 0} variants to sync`
            );

            const results = {
                total: orgData.length,
                success: 0,
                failed: 0,
                errors: [] as any[],
            };

            for (const variant of orgData) {
                try {
                    console.log(
                        `Syncing Variant: ${variant.variant_id}`
                    );

                    await this.syncVariant(variant);

                    results.success++;
                } catch (error: any) {
                    results.failed++;

                    results.errors.push({
                        variant_id: variant.variant_id,
                        product_id: variant.product_id,
                        error: error.message,
                    });

                    console.error(
                        `Failed to sync variant ${variant.variant_id}:`,
                        error.message
                    );
                }
            }

            console.log("Catalog Sync Completed", results);

            return {
                message: "Organization catalog sync completed",
                ...results,
            };
        } catch (error: any) {
            console.error(
                "[Organization Catalog Sync Error]",
                error.message
            );

            throw new Error(
                `Catalog sync failed: ${error.message}`
            );
        }
    }

}

export default new catalogService();
