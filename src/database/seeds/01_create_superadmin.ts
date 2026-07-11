import { Knex } from 'knex';
import bcrypt from 'bcrypt';

/**
 * Seed file to create the initial superadmin user
 * Email: accounts@surefy.co
 * Password: Surefy@2024
 */
export async function seed(knex: Knex): Promise<void> {
  // Check if superadmin already exists
  const existingUser = await knex('users')
    .where({ email: 'accounts@csr.co' })
    .first();

  if (existingUser) {
    console.log('Superadmin user already exists. Skipping seed.');
    return;
  }         

  // Hash the password
  const hashedPassword = await bcrypt.hash('CSR@2026', 10);

  const company:any = await knex('companies').insert({
    id: knex.raw('gen_random_uuid()'),
    name: 'CSR',
    email: 'accounts@csr.co',
    phone: '1234567890',
    // address: '123 Soft7 Street, Tech City',
    created_at: knex.fn.now(),
    updated_at: knex.fn.now(),
  })

  // Insert superadmin user
  await knex('users').insert({
    id: knex.raw('gen_random_uuid()'),
    company_id:company.id,
    name: 'CSR Admin',
    email: 'accounts@csr.co',
    password: hashedPassword,
    role: 'superadmin',
    status: 'active',
    created_at: knex.fn.now(),
    updated_at: knex.fn.now(),
  });

  console.log('✅ Superadmin user created successfully!');
  console.log('Email: accounts@csr.co');
  console.log('Password: CSR@2026');
}

