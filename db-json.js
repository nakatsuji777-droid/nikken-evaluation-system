// JSON-based database with backup, indexing, and soft delete support
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const BACKUP_DIR = path.join(__dirname, 'backups');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

class Collection {
  constructor(name) {
    this.name = name;
    this.file = path.join(DATA_DIR, `${name}.json`);
    if (!fs.existsSync(this.file)) {
      fs.writeFileSync(this.file, JSON.stringify({ nextId: 1, items: [] }, null, 2));
    }
  }

  read() {
    return JSON.parse(fs.readFileSync(this.file, 'utf8'));
  }

  write(data) {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, this.file);
  }

  all(includeDeleted = false) {
    const items = this.read().items;
    return includeDeleted ? items : items.filter(x => !x.deleted);
  }

  find(id, includeDeleted = false) {
    const item = this.read().items.find(x => x.id === Number(id));
    if (!item) return null;
    if (item.deleted && !includeDeleted) return null;
    return item;
  }

  findBy(predicate) {
    return this.all().filter(predicate);
  }

  insert(item) {
    const data = this.read();
    const now = new Date().toISOString();
    const newItem = { id: data.nextId, ...item, deleted: false, createdAt: now, updatedAt: now };
    data.items.push(newItem);
    data.nextId++;
    this.write(data);
    return newItem;
  }

  update(id, patch) {
    const data = this.read();
    const idx = data.items.findIndex(x => x.id === Number(id));
    if (idx === -1) return null;
    data.items[idx] = { ...data.items[idx], ...patch, id: Number(id), updatedAt: new Date().toISOString() };
    this.write(data);
    return data.items[idx];
  }

  hardDelete(id) {
    const data = this.read();
    const before = data.items.length;
    data.items = data.items.filter(x => x.id !== Number(id));
    this.write(data);
    return before !== data.items.length;
  }

  delete(id) {
    return this.update(id, { deleted: true, deletedAt: new Date().toISOString() }) !== null;
  }

  restore(id) {
    return this.update(id, { deleted: false, deletedAt: null }) !== null;
  }

  bulkInsert(items) {
    const data = this.read();
    const now = new Date().toISOString();
    const inserted = items.map(item => {
      const newItem = { id: data.nextId, ...item, deleted: false, createdAt: now, updatedAt: now };
      data.items.push(newItem);
      data.nextId++;
      return newItem;
    });
    this.write(data);
    return inserted;
  }

  count() {
    return this.all().length;
  }

  countAll() {
    return this.read().items.length;
  }
}

const collections = {
  companies: new Collection('companies'),
  constructions: new Collection('constructions'),
  constructionTypes: new Collection('construction_types'),
  users: new Collection('users'),
  approvers: new Collection('approvers'),
  evaluations: new Collection('evaluations'),
  commentTemplates: new Collection('comment_templates'),
  activityLog: new Collection('activity_log'),
};

collections.log = function (action, target, details) {
  collections.activityLog.insert({
    action, target,
    details: typeof details === 'string' ? details : JSON.stringify(details || {}),
    timestamp: new Date().toISOString(),
  });
};

collections.DATA_DIR = DATA_DIR;
collections.BACKUP_DIR = BACKUP_DIR;

module.exports = collections;
