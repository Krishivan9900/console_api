import { BaseModel } from '@surefy/models/base.model';

class storedSessionModel extends BaseModel {
  constructor() {
    super('stored_session_data');
  }

  async findByPhoneNumber(phone_number: any) {
    return await this.query().where({ phone_number: phone_number }).first();
  }

  async getSessionsByCompanyId(company_id: string, filters: any) {
    const page = Number(filters.page) || 1;
    const limit = Number(filters.limit) || 10;
    const offset = (page - 1) * limit;

    const query = this.query()
      .where({ company_id })
      .whereNull('deleted_at');

    if (filters.status) {
      query.where('status', filters.status);
    }

    if (filters.phone_number) {
      query.where('phone_number', filters.phone_number);
    }

    if (filters.search) {
      query.where((builder) => {
        builder
          .whereILike('phone_number', `%${filters.search}%`)
          .orWhereRaw(`data->>'name' ILIKE ?`, [`%${filters.search}%`])
          .orWhereRaw(`data->>'address' ILIKE ?`, [`%${filters.search}%`])
          .orWhereRaw(`data->>'complaint' ILIKE ?`, [`%${filters.search}%`]);
      });
    }

    const countQuery = query.clone();

    const [{ count }] = await countQuery.count('* as count');

    const data = await query
      .orderBy('created_at', 'desc')
      .limit(limit)
      .offset(offset);

    return {
      data,
      pagination: {
        page,
        limit,
        total: Number(count),
        totalPages: Math.ceil(Number(count) / limit),
      },
    };
  }

}

export default new storedSessionModel();
