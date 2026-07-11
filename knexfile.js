// knexfile.js (root)

const config = require('./library/surefy/src/config/knex.config.js');

module.exports = config.default || config;