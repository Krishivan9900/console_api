import { BaseModel } from '@surefy/models/base.model';

class productVariantModel extends BaseModel {
    constructor() {
        super('product_variants');
    }

    async getGroupVariants( groupId: string) {
        const query = this.query()
            .where('product_group_id', groupId)
            .whereNull('deleted_at');

        const data = await query.orderBy('created_at', 'desc')
        return data
    }

    async findByRetailerId(retailer_id:string){
        const query = this.query()
          .where('retailer_id',retailer_id)
          .whereNull('deleted_at')
          .first()
        return query
    }

    async findByCategory(category:string,catalog_id:string){
        const query = this.query()
           .where('catalog_id',catalog_id)
           .andWhere('category',category)
           .whereNull('deleted_at')
        return query
    }

    async findByProductId(product_id:string){
        const query = this.query()
           .where('product_id',product_id)
           .whereNull('deleted_at')
           .first()
        return query
    }


}

export default new productVariantModel();