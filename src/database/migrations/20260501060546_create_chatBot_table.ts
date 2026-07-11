import type { Knex } from "knex";


export async function up(knex: Knex): Promise<void> {
      await knex.schema.createTable('chat_bot', (table) => {
        table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
        table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
        table.string('description', 255);
        table.boolean('published').defaultTo(false);
        table.string('status');
        table.string('phoneNumberId').notNullable().references('phone_number_id').inTable('phone_numbers').onDelete('CASCADE');
        table.timestamp('created_at').defaultTo(knex.fn.now());
        table.timestamp('updated_at').defaultTo(knex.fn.now());
        table.timestamp('deleted_at');
      })
}


export async function down(knex: Knex): Promise<void> {
    await knex.schema.dropTableIfExists('chatBot');
}