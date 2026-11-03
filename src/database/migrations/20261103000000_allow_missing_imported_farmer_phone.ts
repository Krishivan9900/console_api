import type { Knex } from 'knex';

// The original migration used the legacy spelling; deployed models use the first.
const sessionTables = ['stored_session_data', 'stored_sessiond_data'];

export async function up(knex: Knex): Promise<void> {
  for (const name of sessionTables) {
    if (await knex.schema.hasTable(name)) {
      await knex.schema.alterTable(name, table => {
        table.string('phone_number').nullable().alter();
      });
    }
  }
}

export async function down(knex: Knex): Promise<void> {
  for (const name of sessionTables) {
    if (await knex.schema.hasTable(name)) {
      await knex.schema.alterTable(name, table => {
        table.string('phone_number').notNullable().alter();
      });
    }
  }
}
