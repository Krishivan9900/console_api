import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // A separate migration also updates databases that already ran the FPO migration.
  await knex.raw(`
    ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
    ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN (
      'superadmin', 'admin', 'manager', 'user', 'company', 'USER',
      'fpo', 'vle', 'farmer', 'trader', 'agricultural_transport_service',
      'micro_entrepreneur', 'agricultural_machinery_service_provider',
      'agricultural_input_supplier', 'livestock_farmer'
    ));
  `);
}

export async function down(knex: Knex): Promise<void> {
  // Constraint validation refuses rollback while VLE users remain; no users are changed.
  await knex.raw(`
    ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
    ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN (
      'superadmin', 'admin', 'manager', 'user', 'company', 'USER',
      'fpo', 'farmer', 'trader', 'agricultural_transport_service',
      'micro_entrepreneur', 'agricultural_machinery_service_provider',
      'agricultural_input_supplier', 'livestock_farmer'
    ));
  `);
}
