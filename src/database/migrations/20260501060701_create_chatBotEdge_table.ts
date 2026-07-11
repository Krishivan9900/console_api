import type { Knex } from "knex";


export async function up(knex: Knex): Promise<void> {
    await knex.schema.createTable('chatBot_Edge', (table) => {
        table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
        table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
        table.uuid('chatBotId').notNullable().references('id').inTable('chatBot').onDelete('CASCADE');
        table.boolean('published').defaultTo(false);
        table.string('target',255);
        table.string('label',255)
        table.jsonb('data');
        table.timestamp('created_at').defaultTo(knex.fn.now());
        table.timestamp('updated_at').defaultTo(knex.fn.now());
        table.timestamp('deleted_at');
    })
}


export async function down(knex: Knex): Promise<void> {
    await knex.schema.dropTableIfExists('chatBot_Edge');
}



// export interface chatBotEdge{
//     id:string
//     user_id:string;
//     chatBotId:string;
//     target:string;
//     label:string;
//     data:JSON;
//     createdAt:string
// }