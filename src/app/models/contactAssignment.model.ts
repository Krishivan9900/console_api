import { BaseModel } from '@surefy/models/base.model';
import { Knex } from 'knex';

class ContactModel extends BaseModel {
  constructor() {
    super('contact_assignments');
  }

  async findByAssignedId(assigned_to:string){
    return this.query().where('assigned_to',assigned_to).first()
  }

  async findByContactId(contactId:string){
    return this.query().where('contact_id',contactId).returning("*")
  }

  async findContactAssigned(assigned_to:string,contactId:string){
    return this.query().where('contact_id',contactId).andWhere('assigned_to',assigned_to).first()
  }

}

export default new ContactModel()