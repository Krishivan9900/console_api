import { BaseModel } from '@surefy/models/base.model';

class ContactTagModel extends BaseModel {
  constructor() {
    super('contact_tags');
  }

  async findByCompany(companyId: string) {
    return this.query()
      .where({ company_id: companyId })
      .whereNull('deleted_at')
      .orderBy('name', 'asc');
  }

  async findByName(userId: string, name: string) {
    return this.query()
      .where({ user_id: userId, name })
      .whereNull('deleted_at')
      .first();
  }

  async incrementContactCount(tagId: string, amount: number = 1) {
    return this.query()
      .where({ id: tagId })
      .increment('contact_count', amount);
  }

  async decrementContactCount(tagId: string, amount: number = 1) {
    return this.query()
      .where({ id: tagId })
      .decrement('contact_count', amount);
  }

  async updateContactCount(tagId: string) {
    const count = await this.db
      .from('contact_tag_relations')
      .where({ tag_id: tagId })
      .count('* as count')
      .first();

    return this.update(tagId, { contact_count: count?.count || 0 });
  }

  async findByIds(tagIds: string[]) {
    return this.query().whereIn('id', tagIds);
  }
  
  async findByUser(userId: string) {
    return this.query()
      .where({ user_id: userId })
      .whereNull('deleted_at')
      .orderBy('name', 'asc');
  }

  async bulkAddTags(
  userId: string,
  contactId: string,
  tagIds: string[]
) {
  const relations = tagIds.map((tagId) => ({
    user_id: userId,
    contact_id: contactId,
    tag_id: tagId,
  }));

  return this.query()
    .insert(relations)
    .onConflict(["contact_id", "tag_id"])
    .ignore();
}
}

export default new ContactTagModel();
