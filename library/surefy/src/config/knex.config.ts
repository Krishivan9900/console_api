import { Knex } from 'knex'
import path from 'node:path'
import dotenv from 'dotenv'

export const basePath = path.resolve(__dirname, '../../../../')

dotenv.config({
  path: path.join(basePath, '.env'),
})

console.log('DATABASE_URL:', process.env.DATABASE_URL)

const connection: Knex.StaticConnectionConfig = {
  connectionString: process.env.DATABASE_URL,
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