import type { Knex } from "knex";


export async function up(knex: Knex): Promise<void> {
    return knex.schema.createTable('stored_sessiond_data',(table)=>{
        table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
        table.string('phone_number').notNullable()
        table.jsonb('data').notNullable()
        table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
        table.uuid('company_id').notNullable().references('id').inTable('companies').onDelete('CASCADE');
        table.string('status').notNullable().defaultTo('pending')
        table.timestamp('created_at').defaultTo(knex.fn.now());
        table.timestamp('updated_at').defaultTo(knex.fn.now());
        table.timestamp('deleted_at');
    })
}


export async function down(knex: Knex): Promise<void> {
    await knex.schema.dropTableIfExists('stored_sessiond_data');
}

