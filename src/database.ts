// import knex from 'knex';
// import dotenv from 'dotenv';

// dotenv.config();

// const db = knex({
//   client: 'pg',
//   connection: {
//     host: 'postgres', // FORCE LOCAL
//     port: 5432,
//     user: 'postgres',
//     password: 'password',
//     database: 'console_db',
//   },
//   pool: {
//     min: 0,
//     max: 5,
//     acquireTimeoutMillis: 10000, // 🔥 important
//   },
// });

// export default db;


import knex from 'knex';
import dotenv from 'dotenv';

dotenv.config();

const db = knex({
  client: 'pg',

  connection: {
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false,
    },
  },

  pool: {
    min: 0,
    max: 5,
    acquireTimeoutMillis: 10000,
  },
});

export default db;