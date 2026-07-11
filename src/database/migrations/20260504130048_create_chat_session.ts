import type { Knex } from "knex";


export async function up(knex: Knex): Promise<void> {
    // return knex.schema.createTable('cgar')
}


export async function down(knex: Knex): Promise<void> {
}

// -- CREATE TABLE chat_sessions (
// --     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

// --     phone_number VARCHAR(20) NOT NULL,
// --     chatbot_id UUID NOT NULL,

// --     current_node_id UUID,
// --     current_flow VARCHAR(20) CHECK (current_flow IN ('menu', 'form')),

// --     last_message TEXT,

// --     created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
// --     updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
// -- );