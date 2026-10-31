import { BaseModel } from '@surefy/models/base.model';
import { rankProductMatches } from '../services/productSearch.logic';

class productVariantModel extends BaseModel {
    constructor() {
        super('product_variants');
    }

    async getGroupVariants(groupId: string) {
        const query = this.query()
            .where('product_group_id', groupId)
            .whereNull('deleted_at');

        const data = await query.orderBy('created_at', 'desc')
        return data
    }

    async findByRetailerId(retailer_id: string) {
        console.log('Retailer Id',retailer_id)
        const query = this.query()
            .where('retailer_id', retailer_id)
            .whereNull('deleted_at')
            .first()
        return query
    }

    async findByCategory(category: string, catalog_id: string) {
        const query = this.query()
            .where('catalog_id', catalog_id)
            .andWhere('category', category)
            .whereNull('deleted_at')
        return query
    }

    async findByProductId(product_id: string) {
        const query = this.query()
            .where('product_id', product_id)
            .whereNull('deleted_at')
            .first()
        return query
    }

    async findByVariantId(variant_id: string, catalog_id?: string) {
        const query = this.query()
            .where('variant_id', variant_id)
            .whereNull('deleted_at');
        if (catalog_id) query.where('catalog_id', catalog_id);
        return query.first();
    }


    async findByProductName(productName: string, catalog_id: string) {
        if (!productName?.trim() || !catalog_id) return [];
        const candidates = await this.query().where({ catalog_id }).whereNull('deleted_at')
            .select('retailer_id', 'name', 'description', 'brand', 'category', 'sub_category',
                'size', 'color', 'product_id', 'meta_status');
        return rankProductMatches(candidates, productName).map(({ product, matchType }) => ({
            ...product, search_match_type: matchType,
        }));
    }

}

export default new productVariantModel();
