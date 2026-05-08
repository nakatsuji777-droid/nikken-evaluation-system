// PostgreSQL-based database (cloud deployment)
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS store (
      collection VARCHAR(50) NOT NULL,
      id INTEGER NOT NULL,
      data JSONB NOT NULL DEFAULT '{}',
      deleted BOOLEAN NOT NULL DEFAULT FALSE,
      deleted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (collection, id)
    );
    CREATE TABLE IF NOT EXISTS sequences (
      collection VARCHAR(50) PRIMARY KEY,
      next_id INTEGER NOT NULL DEFAULT 1
    );
  `);
}

class PgCollection {
  constructor(name) {
    this.name = name;
  }

  _toItem(row) {
    return {
      id: row.id,
      ...(typeof row.data === 'string' ? JSON.parse(row.data) : row.data),
      deleted: row.deleted,
      deletedAt: row.deleted_at ? row.deleted_at.toISOString() : null,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }

  _extractData(item) {
    const { id, deleted, deletedAt, createdAt, updatedAt, ...data } = item;
    return data;
  }

  async all(includeDeleted = false) {
    const q = includeDeleted
      ? 'SELECT * FROM store WHERE collection = $1 ORDER BY id'
      : 'SELECT * FROM store WHERE collection = $1 AND NOT deleted ORDER BY id';
    const { rows } = await pool.query(q, [this.name]);
    return rows.map(r => this._toItem(r));
  }

  async find(id, includeDeleted = false) {
    const q = includeDeleted
      ? 'SELECT * FROM store WHERE collection = $1 AND id = $2'
      : 'SELECT * FROM store WHERE collection = $1 AND id = $2 AND NOT deleted';
    const { rows } = await pool.query(q, [this.name, Number(id)]);
    return rows.length > 0 ? this._toItem(rows[0]) : null;
  }

  async findBy(predicate) {
    const items = await this.all();
    return items.filter(predicate);
  }

  async _nextId() {
    await pool.query(
      'INSERT INTO sequences (collection, next_id) VALUES ($1, 1) ON CONFLICT (collection) DO NOTHING',
      [this.name]
    );
    const { rows } = await pool.query(
      'UPDATE sequences SET next_id = next_id + 1 WHERE collection = $1 RETURNING next_id - 1 AS current_id',
      [this.name]
    );
    return rows[0].current_id;
  }

  async insert(item) {
    const id = await this._nextId();
    const now = new Date();
    const data = this._extractData(item);
    await pool.query(
      'INSERT INTO store (collection, id, data, deleted, created_at, updated_at) VALUES ($1, $2, $3, FALSE, $4, $4)',
      [this.name, id, JSON.stringify(data), now]
    );
    return { id, ...data, deleted: false, createdAt: now.toISOString(), updatedAt: now.toISOString() };
  }

  async update(id, patch) {
    const existing = await this.find(Number(id), true);
    if (!existing) return null;
    const { id: _id, createdAt, ...rest } = existing;
    const merged = { ...rest, ...patch };
    const data = this._extractData(merged);
    const now = new Date();
    const deleted = merged.deleted || false;
    const deletedAt = merged.deletedAt || null;
    await pool.query(
      'UPDATE store SET data = $1, deleted = $2, deleted_at = $3, updated_at = $4 WHERE collection = $5 AND id = $6',
      [JSON.stringify(data), deleted, deletedAt ? new Date(deletedAt) : null, now, this.name, Number(id)]
    );
    return { id: Number(id), ...data, deleted, deletedAt, createdAt, updatedAt: now.toISOString() };
  }

  async delete(id) {
    const now = new Date().toISOString();
    return (await this.update(id, { deleted: true, deletedAt: now })) !== null;
  }

  async hardDelete(id) {
    const { rowCount } = await pool.query(
      'DELETE FROM store WHERE collection = $1 AND id = $2',
      [this.name, Number(id)]
    );
    return rowCount > 0;
  }

  async restore(id) {
    return (await this.update(id, { deleted: false, deletedAt: null })) !== null;
  }

  async bulkInsert(items) {
    const results = [];
    for (const item of items) {
      results.push(await this.insert(item));
    }
    return results;
  }

  async count() {
    const { rows } = await pool.query(
      'SELECT COUNT(*)::int AS c FROM store WHERE collection = $1 AND NOT deleted',
      [this.name]
    );
    return rows[0].c;
  }

  async countAll() {
    const { rows } = await pool.query(
      'SELECT COUNT(*)::int AS c FROM store WHERE collection = $1',
      [this.name]
    );
    return rows[0].c;
  }
}

const collections = {
  companies: new PgCollection('companies'),
  constructions: new PgCollection('constructions'),
  constructionTypes: new PgCollection('construction_types'),
  users: new PgCollection('users'),
  approvers: new PgCollection('approvers'),
  evaluations: new PgCollection('evaluations'),
  commentTemplates: new PgCollection('comment_templates'),
  activityLog: new PgCollection('activity_log'),
};

collections.log = async function (action, target, details) {
  try {
    await collections.activityLog.insert({
      action, target,
      details: typeof details === 'string' ? details : JSON.stringify(details || {}),
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    console.error('Log write failed:', e.message);
  }
};

collections.initSchema = initSchema;
collections.pool = pool;
collections.DATA_DIR = null;
collections.BACKUP_DIR = null;

module.exports = collections;
