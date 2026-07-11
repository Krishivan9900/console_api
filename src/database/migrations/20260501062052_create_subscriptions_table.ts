import type { Knex } from "knex";


export async function up(knex: Knex): Promise<void> {
    await knex.schema.createTable('subscriptions',(table)=>{
        table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
        table.uuid('company_id').notNullable().references('id').inTable('companies').onDelete('CASCADE');
        table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
        table.string('plan_name').notNullable();
        table.string('price').notNullable();
        table.enum('billing_cycle',["Monthly","Yearly","Free"]).defaultTo('Free');
        table.string('description',255);
        table.boolean('active').defaultTo('false');
        table.jsonb('features')
    })
}


export async function down(knex: Knex): Promise<void> {
    await knex.schema.dropTableIfExists('subscriptions');
}

