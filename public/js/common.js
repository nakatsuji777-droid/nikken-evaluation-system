// ===== API helpers =====
const API = '/api';

async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(API + path, opts);
  if (!res.ok) {
    const text = await res.text().catch(() => 'Unknown error');
    throw new Error(text || res.statusText);
  }
  const ct = res.headers.get('Content-Type') || '';
  return ct.includes('json') ? res.json() : res.text();
}

// ===== Toast =====
function toast(message, type = '') {
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.textContent = message;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 300);
  }, 2500);
}

// ===== Render helpers =====
function rankBadge(rank) {
  if (!rank || rank === '未入力') return '<span class="rank-badge rank-未入力">―</span>';
  return `<span class="rank-badge rank-${rank}">${rank}</span>`;
}
function statusBadge(status) {
  const s = status || '下書き';
  return `<span class="status-badge status-${s}">${s}</span>`;
}
function fmtDate(s) {
  if (!s) return '';
  return s.slice(0, 10).replace(/-/g, '/');
}
function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[m]));
}
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// ===== Confirm modal =====
function confirmDialog(message, opts = {}) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
      <div class="card-header"><span>${escapeHtml(opts.title || '確認')}</span></div>
      <div class="card-body">
        <div class="${opts.dangerous ? 'alert error' : 'alert info'}" style="margin-bottom:16px">${escapeHtml(message)}</div>
        <div class="btn-group" style="justify-content:flex-end">
          <button class="btn secondary" id="cancel">${escapeHtml(opts.cancelLabel || 'キャンセル')}</button>
          <button class="btn ${opts.dangerous ? 'danger' : ''}" id="ok">${escapeHtml(opts.okLabel || 'OK')}</button>
        </div>
      </div>
    `;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    const close = (val) => { overlay.remove(); resolve(val); };
    modal.querySelector('#cancel').onclick = () => close(false);
    modal.querySelector('#ok').onclick = () => close(true);
    overlay.onclick = (e) => { if (e.target === overlay) close(false); };
  });
}

// ===== Active nav =====
document.addEventListener('DOMContentLoaded', () => {
  const path = window.location.pathname;
  document.querySelectorAll('.nav a').forEach(a => {
    const href = a.getAttribute('href');
    if (href === path || (path === '/' && href === '/') || (path.endsWith('/index.html') && href === '/')) {
      a.classList.add('active');
    }
  });
});

// ===== Dark mode =====
function applyDarkMode() {
  const dark = localStorage.getItem('darkMode') === '1';
  document.body.classList.toggle('dark', dark);
}
function toggleDarkMode() {
  const dark = document.body.classList.toggle('dark');
  localStorage.setItem('darkMode', dark ? '1' : '0');
}
applyDarkMode();

// ===== Render header (DRY) =====
function renderHeader() {
  const header = document.querySelector('header.header');
  if (!header) return;
  const actions = header.querySelector('.header-actions');
  if (actions) return; // already rendered
  const dt = document.createElement('div');
  dt.className = 'header-actions';
  dt.innerHTML = `
    <button class="icon-btn" onclick="toggleDarkMode()" title="ダークモード切替">🌓</button>
    <a class="icon-btn" href="/help.html" title="ヘルプ" style="display:flex;align-items:center;justify-content:center;text-decoration:none">?</a>
  `;
  header.appendChild(dt);
}
document.addEventListener('DOMContentLoaded', renderHeader);

// ===== Local storage helpers (オートセーブ) =====
const Local = {
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {} },
  get(key, def = null) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : def; } catch { return def; } },
  remove(key) { localStorage.removeItem(key); }
};

// ===== Debounce =====
function debounce(fn, ms = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), ms);
  };
}
