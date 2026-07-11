import { BaseModel } from '@surefy/models/base.model';

class productGroupModel extends BaseModel {
  constructor() {
    super('product_groups');
  }

  async getCatalogGroups(company_id:string,user_id:string){
    const query = this.query()
      .where({ company_id })
      .whereNull('deleted_at');

    const data = await query.orderBy('created_at', 'desc')

    return data
  }

  async getGroupVariants(company_id:string,user_id:string,groupId:string){
    const query = this.query()
      .where({company_id})
      .andWhere('product_group_id',groupId)
      .whereNull('deleted_at');

    const data = await query.orderBy('created_at','desc')
    return data
  }

  async findGroupByCategory(category:string,catalog_id?:string){
    return this.query()
    .whereRaw('categories @> ?::jsonb', [JSON.stringify([category])])
    .orWhere('catalog_id',catalog_id)
    .first()
  }
  
}

export default new productGroupModel();
