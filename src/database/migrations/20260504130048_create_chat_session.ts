import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
    return knex.schema.createTable('chat_sessions',(table)=>{
       table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
       table.string('phone_number').notNullable();
       table.uuid('chatbot_id').notNullable().references('chat_bot').inTable('chat_bot').onDelete('CASCADE');
       table.uuid('chat_bot_node').notNullable().references('chat_bot_node').inTable('chat_bot_node').onDelete('CASCADE');
       table.string('last_message').nullable();
       table.timestamp('created_at').defaultTo(knex.fn.now());
       table.timestamp('updated_at').defaultTo(knex.fn.now());
       table.timestamp('deleted_at');
    })
}


export async function down(knex: Knex): Promise<void> {
  return knex.schema.dropTableIfExists('chat_sessions');
}

