import type { Knex } from "knex";


export async function up(knex: Knex): Promise<void> {
    return knex.schema.createTable('product_variants',(table)=>{
        table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
        table.uuid('product_group_id').notNullable().references('id').inTable('product_groups').onDelete('CASCADE');
        table.string('name').notNullable()
        table.string('description').notNullable()
        table.string('color').nullable()
        table.string('size').nullable()
        table.string('currency').notNullable()
        table.string('brand').notNullable()
        table.text('image_url').notNullable()
        table.text('url').notNullable()
        table.string('inventory').nullable()
        table.string('meta_status').nullable()
        table.integer('price').defaultTo(0)
        table.string('category').notNullable()
        table.string('sub_category').nullable()
        table.string('product_id').nullable()
        table.string('product_added_by').nullable()
        table.jsonb('gst').nullable()
        table.string('quantity').nullable()
        table.string('unit').nullable()
        table.string('variant_id').nullable()
        table.string('catalog_id').notNullable()
        table.timestamp('created_at').defaultTo(knex.fn.now());
        table.timestamp('updated_at').defaultTo(knex.fn.now());
        table.timestamp('deleted_at');
    })
}


export async function down(knex: Knex): Promise<void> {
    await knex.schema.dropTableIfExists('product_variants');
}

