import type { Knex } from "knex";


export async function up(knex: Knex): Promise<void> {
    await knex.schema.createTable('chat_bot_node',(table)=>{
        table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
        table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
        table.uuid('chatBotId').notNullable().references('id').inTable('chatBot').onDelete('CASCADE');
        table.string('type').notNullable();
        table.jsonb('data');
        table.string('position');
        table.timestamp('created_at').defaultTo(knex.fn.now());
        table.timestamp('updated_at').defaultTo(knex.fn.now());
        table.timestamp('deleted_at');
    })
}


export async function down(knex: Knex): Promise<void> {
    await knex.schema.dropTableIfExists('chatBot_Node');
}
