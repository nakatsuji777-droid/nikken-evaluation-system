// Database router: PostgreSQL (cloud) or JSON files (local)
if (process.env.DATABASE_URL) {
  module.exports = require('./db-pg');
} else {
  module.exports = require('./db-json');
}
