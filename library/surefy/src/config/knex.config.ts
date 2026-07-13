import { Knex } from 'knex'
import path from 'node:path'
import dotenv from 'dotenv'

export const basePath = path.resolve(__dirname, '../../../../')

dotenv.config({
  path: path.join(basePath, '.env'),
})

console.log('DATABASE_URL:', process.env.DATABASE_URL)

const connection: Knex.StaticConnectionConfig = {
  connectionString: "postgresql://console_db_1qtd_user:n1Fix8SAwNPVLD2nJ2outmaOfU8KDauS@dpg-d98rieu7r5hc73aae2ug-a.oregon-postgres.render.com/console_db_1qtd",
  ssl: {
    rejectUnauthorized: false,
  },
}

const config: Record<string, Knex.Config> = {
  development: {
    client: 'pg',
    debug: false,
    connection,

    migrations: {
      directory: path.join(basePath, 'src/database/migrations'),
    },

    seeds: {
      directory: path.join(basePath, 'src/database/seeds'),
    },

    pool: {
      min: 2,
      max: 10,
    },
  },

  production: {
    client: 'pg',
    debug: false,
    connection,

    migrations: {
      directory: path.join(basePath, 'src/database/migrations'),
    },

    seeds: {
      directory: path.join(basePath, 'src/database/seeds'),
    },

    pool: {
      min: 2,
      max: 10,
    },
  },
}

export default config