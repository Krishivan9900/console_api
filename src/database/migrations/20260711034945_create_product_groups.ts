import type { Knex } from "knex";


export async function up(knex: Knex): Promise<void> {
    return knex.schema.createTable('product_groups',(table)=>{
        table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
        table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
        table.uuid('company_id').notNullable().references('id').inTable('companies').onDelete('CASCADE');
        table.string('group_name').notNullable()
        table.integer('group_item_counts').defaultTo(0)
        table.jsonb('categories').notNullable()
        table.string('catalog_id').notNullable()
        table.timestamp('created_at').defaultTo(knex.fn.now());
        table.timestamp('updated_at').defaultTo(knex.fn.now());
        table.timestamp('deleted_at');
    })
}


export async function down(knex: Knex): Promise<void> {
          await knex.schema.dropTableIfExists('product_groups');
}

