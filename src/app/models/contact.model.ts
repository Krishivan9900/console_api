import { BaseModel } from '@surefy/models/base.model';
import { Knex } from 'knex';

class ContactModel extends BaseModel {
  constructor() {
    super('contacts');
  }

  async findByPhone(userId: string, phoneNumber: string) {
    return this.query()
      .where({ user_id: userId, phone_number: phoneNumber })
      .whereNull('deleted_at')
      .first();
  }


  async findByCompany(companyId: string, filters: any = {}) {
    let query = this.query()
      .where({ company_id: companyId })
      .whereNull('deleted_at');

    if (filters.is_valid !== undefined) {
      query = query.where({ is_valid: filters.is_valid });
    }

    if (filters.search) {
      query = query.where((builder) => {
        builder
          .where('name', 'ilike', `%${filters.search}%`)
          .orWhere('phone_number', 'like', `%${filters.search}%`)
          .orWhere('email', 'ilike', `%${filters.search}%`);
      });
    }

    return query.orderBy('created_at', 'desc');
  }

  async findByTags(companyId: string, tagIds: string[]) {
    return this.query()
      .where({ company_id: companyId })
      .whereNull('deleted_at')
      .whereIn('id', (builder) => {
        builder
          .select('contact_id')
          .from('contact_tag_relations')
          .whereIn('tag_id', tagIds);
      });
  }

  async findByLists(companyId: string, listIds: string[]) {
    return this.query()
      .where({ company_id: companyId })
      .whereNull('deleted_at')
      .whereIn('id', (builder) => {
        builder
          .select('contact_id')
          .from('contact_list_relations')
          .whereIn('list_id', listIds);
      });
  }

  async markAsInvalid(contactId: string, reason: string) {
    return this.update(contactId, {
      is_valid: false,
      invalid_reason: reason,
      last_invalid_at: new Date(),
    });
  }

  async incrementMessageCount(contactId: string) {
    return this.query()
      .where({ id: contactId })
      .increment('message_count', 1)
      .update({ last_contacted_at: new Date() });
  }

  async incrementFailedCount(contactId: string) {
    return this.query()
      .where({ id: contactId })
      .increment('failed_count', 1);
  }

  async bulkCreate(contacts: any[]) {
    return this.query().insert(contacts).returning('*');
  }

  async bulkUpsert(userId: string, contacts: any[]) {
    const promises = contacts.map(async (contact) => {
      const existing = await this.findByPhone(userId, contact.phone_number);
      if (existing) {
        return this.update(existing.id, {
          ...contact,
          attributes: { ...existing.attributes, ...contact.attributes },
        });
      }
      return this.create({ ...contact, user_id: userId });
    });
    return Promise.all(promises);
  }

  findWithFilters(userId: string, filters: any) {
    let query = this.query()
      .distinct('contacts.*')
      .select(
        'contacts.*',
        'contact_assignments.show_details',
        'contact_assignments.can_chat'
      )
      .leftJoin('contact_assignments', function () {
        this.on('contact_assignments.contact_id', '=', 'contacts.id')
          .andOnVal('contact_assignments.assigned_to', userId);
      })
      .where(function () {
        this.where('contacts.user_id', userId)
          .orWhere('contact_assignments.assigned_to', userId);
      })
      .whereNull('contacts.deleted_at');

    if (filters.is_valid !== undefined) {
      query = query.where('contacts.is_valid', filters.is_valid);
    }

    if (filters.search) {
      query = query.where((builder: Knex.QueryBuilder) => {
        builder
          .whereILike('contacts.name', `%${filters.search}%`)
          .orWhereILike('contacts.email', `%${filters.search}%`)
          .orWhere('contacts.phone_number', 'like', `%${filters.search}%`);
      });
    }

    if (filters.attributes) {
      for (const [key, value] of Object.entries(filters.attributes)) {
        if (
          typeof value === 'string' ||
          typeof value === 'number' ||
          typeof value === 'boolean'
        ) {
          query = query.whereRaw(
            `contacts.attributes->>? = ?`,
            [key, String(value)]
          );
        }
      }
    }

    return query;
  }

  async getAssignedUser(userId: string) {
    let query = this.query()
    return query.where({ user_id: userId }).orWhere({ assigned_to: userId }).returning("*")
  }

}

export default new ContactModel();