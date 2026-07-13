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
    connectionString: "postgresql://console_db_1qtd_user:n1Fix8SAwNPVLD2nJ2outmaOfU8KDauS@dpg-d98rieu7r5hc73aae2ug-a.oregon-postgres.render.com/console_db_1qtd",
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