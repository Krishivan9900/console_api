import type { Knex } from "knex";


export async function up(knex: Knex): Promise<void> {
    return knex.schema.createTable('contact_assignments',(table)=>{
        table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
        table.uuid('company_id').nullable().references('id').inTable('companies').onDelete('CASCADE');
        table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
        table.uuid('contact_id').notNullable().references('id').inTable('contacts').onDelete('CASCADE')
        table.boolean('show_details').defaultTo(false)
    })
}

export async function down(knex: Knex): Promise<void> {
      await knex.schema.dropTableIfExists('contact_assignments');
}

