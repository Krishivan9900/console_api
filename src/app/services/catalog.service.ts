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
    private async getAllOrgVariants(accessToken: string) {
        console.log('Acess Token', accessToken)
        const response = await axios.post(
            'https://l07yapr0ub.execute-api.ap-south-1.amazonaws.com/prod/farmer-function/all-org-variants',
            {},
            {
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${accessToken}`,
                }
            },
        )
        // console.log("Response",response.data)
        return response.data.data
    }

    /**
     * Sync /v1/
     */
    private async syncVariant(variant: any) {
        try {
            console.log(
                `[SYNC] Processing Variant: ${variant.variant_id}`
            );

            // Find matching product group/category
            const existingCatalog =
                await productGroupModel.findGroupByCategory(
                    variant.categoryName,
                    "795853123055079"
                );

            if (!existingCatalog) {
                throw new Error(
                    `Category '${variant.categoryName}' does not exist`
                );
            }

            console.log(
                `[SYNC] Found Catalog: ${existingCatalog.id}`
            );

            // Check if variant already exists
            const existingVariant =
                await productVariantModel.findByProductId(
                    variant.product_id
                );

            const retailer_id = variant.variantName
                .replace(/[^a-zA-Z0-9]+/g, "_")
                .replace(/^_+|_+$/g, "");

            const dbpayloadVariant = {
                retailer_id: existingVariant?.retailer_id ? existingVariant.retailer_id : retailer_id ,
                product_group_id: existingCatalog.id,
                catalog_id: existingCatalog.catalog_id,

                product_id: variant.product_id,
                variant_id: variant.variant_id,

                name: variant.variantName,
                description: `Product ${variant.productName}`,

                brand: variant.brandName,
                color: variant.color || null,
                size: variant.sizeColor || null,

                price: parseFloat(String(variant.salePrice)),
                quantity: Number(variant.quantity || "0"),
                unit: variant.unit,

                currency: "INR",
                availability: "in stock",
                condition: "new",

                image_url: variant.productImage,
                url: variant.url || "https://example.com",

                gst: variant.gst,
                sub_category: variant.subCategoryName.toLowerCase(),
                category: variant.categoryName.toLowerCase(),

                product_added_by: variant.user_id,
                meta_status: "synced",
            };
    //   "name": "Running Shoes red size 44",
    //   "description": "Comfortable running shoes",
    //   "color": "Red",
    //   "size": "42",
    //   "price": "499900",
    //   "currency": "INR",
    //   "availability": "in stock",
    //   "condition": "new",
    //   "brand": "Krishione",
    //   "image_index": 0,
    //   "url": "https://example.com/products/shoe-red-42"

            const metaPayloadVariant = {
                name: variant.variantName,
                description: `Product ${variant.productName}`,
                color:variant.sizeColor,
                price: Math.round(parseFloat(String(variant.salePrice)) * 100),
                size:variant.sizeColor,
                availability: "in stock",
                condition: "new",
                brand: variant.brandName,
                image_url: variant.productImage,
                url: variant.url || "https://example.com/products/shoe-red-42",
                currency: "INR"
            };

            console.log(
                "[SYNC] Payload:",
                JSON.stringify(metaPayloadVariant, null, 2)
            );

            if (!existingVariant) {
                console.log(
                    `[SYNC] Creating new variant ${variant.variant_id}`
                );

                // Meta Sync

                const response =
                    await metaService.createProductVariantBatch(
                        existingCatalog.catalog_id,
                        {
                            method: "CREATE",
                            item_type: "PRODUCT_ITEM",
                            retailer_id,
                            data: metaPayloadVariant,
                        }
                    );

                if (!response?.handles) {
                    throw new Error(
                        response?.error?.message ||
                        "Meta Variant Upload Failed"
                    );
                }


                const savedVariant =
                    await productVariantModel.create(
                        dbpayloadVariant
                    );

                console.log(
                    "[SYNC] Variant Created:",
                    savedVariant
                );

                return savedVariant;
            }

            console.log(
                `[SYNC] Variant ${variant.variant_id} already exists. Updating...`
            );

            const response = await metaService.createProductVariantBatch(
                        existingCatalog.catalog_id,
                        {
                            method: "UPDATE",
                            item_type: "PRODUCT_ITEM",
                            retailer_id,
                            data: metaPayloadVariant,
                        }
                    );

            if (!response?.handles) {
                throw new Error(
                    response?.error?.message ||
                    "Meta Variant Upload Failed"
                );
            }

            // Update existing variant
            const updatedVariant = await productVariantModel.update(existingVariant.id,dbpayloadVariant)
                
            console.log(
                "[SYNC] Variant Updated:",
                updatedVariant
            );

            return updatedVariant;
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
    async getProductVariants(category: string, catalog_id: string) {
        console.log("Category", category, catalog_id)
        const existingCategory = await productGroupModel.findGroupByCategory(category, catalog_id)
        const existingProductVariant = await productVariantModel.findByCategory(category, catalog_id,)
        if (!existingCategory || !existingProductVariant || existingProductVariant.length === 0) {
            return { success: false, message: "Product Variant with those category not exists" }
        }
        const retailerIds = existingProductVariant.map(
            (product) => product.retailer_id
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
        accessToken: string
    ) {
        try {
            const orgData = await this.getAllOrgVariants(accessToken);

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