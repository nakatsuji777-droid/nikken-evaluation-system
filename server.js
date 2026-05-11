const express = require('express');
const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');
const archiver = require('archiver');
const { stringify: csvStringify } = require('csv-stringify/sync');
const { parse: csvParse } = require('csv-parse/sync');
const db = require('./db');

const app = express();

process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', new Date().toISOString(), err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', new Date().toISOString(), reason);
});
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ============ Helpers ============
function calculateRank(scores) {
  const valid = scores.filter(s => s !== null && s !== undefined && s !== '');
  if (valid.length < 7) return { total: null, average: null, rank: '未入力' };

  const total = valid.reduce((a, b) => a + Number(b), 0);
  const average = total / valid.length;

  let rank;
  const nums = valid.map(Number);
  if (nums.includes(1)) rank = 'D';
  else if (nums.includes(2)) rank = average >= 2.6 ? 'C' : 'D';
  else if (average === 5) rank = 'S';
  else if (average >= 4.2) rank = 'A';
  else if (average >= 3.4) rank = 'B';
  else if (average >= 2.6) rank = 'C';
  else rank = 'D';

  return { total, average: Math.round(average * 100) / 100, rank };
}

async function enrichEvaluation(e) {
  const company = await db.companies.find(e.companyId);
  const construction = await db.constructions.find(e.constructionId);
  return {
    ...e,
    companyName: company?.name || '',
    companyEmail: company?.email || '',
    constructionName: construction?.name || '',
    constructionLocation: construction?.location || '',
  };
}

async function enrichAll(items) {
  return Promise.all(items.map(enrichEvaluation));
}

// ============ Master CRUD ============
const masterMap = {
  'companies': 'companies',
  'constructions': 'constructions',
  'construction-types': 'constructionTypes',
  'users': 'users',
  'approvers': 'approvers',
  'comment-templates': 'commentTemplates',
};

Object.entries(masterMap).forEach(([url, name]) => {
  // CSV export
  app.get(`/api/${url}/export-csv`, async (req, res) => {
    try {
      const items = await db[name].all();
      const baseFields = items.length > 0
        ? Object.keys(items[0]).filter(k => !['createdAt', 'updatedAt', 'deleted', 'deletedAt'].includes(k))
        : ['id', 'name'];
      const csv = csvStringify(items.map(i => baseFields.map(h => i[h] ?? '')), { header: true, columns: baseFields });
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${url}_${new Date().toISOString().slice(0, 10)}.csv"`);
      res.send('﻿' + csv);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // CSV import
  app.post(`/api/${url}/import-csv`, async (req, res) => {
    try {
      const csvText = req.body.csv;
      const records = csvParse(csvText, { columns: true, skip_empty_lines: true, trim: true, bom: true });
      let inserted = 0, updated = 0;
      const existing = await db[name].all();
      for (const rec of records) {
        delete rec.id; delete rec.createdAt; delete rec.updatedAt; delete rec.deleted; delete rec.deletedAt;
        const match = existing.find(x => x.name === rec.name);
        if (match) { await db[name].update(match.id, rec); updated++; }
        else { await db[name].insert(rec); inserted++; }
      }
      await db.log('import-csv', name, { inserted, updated });
      res.json({ ok: true, inserted, updated });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
});

Object.entries(masterMap).forEach(([url, name]) => {
  app.get(`/api/${url}`, async (req, res) => {
    try { res.json(await db[name].all()); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post(`/api/${url}`, async (req, res) => {
    try {
      const item = await db[name].insert(req.body);
      await db.log('insert', name, { id: item.id, name: item.name });
      res.json(item);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get(`/api/${url}/:id`, async (req, res) => {
    try {
      const item = await db[name].find(req.params.id);
      if (!item) return res.status(404).json({ error: 'Not found' });
      res.json(item);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.put(`/api/${url}/:id`, async (req, res) => {
    try {
      const result = await db[name].update(req.params.id, req.body);
      if (!result) return res.status(404).json({ error: 'Not found' });
      await db.log('update', name, { id: result.id });
      res.json(result);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.delete(`/api/${url}/:id`, async (req, res) => {
    try {
      const ok = await db[name].delete(req.params.id);
      if (!ok) return res.status(404).json({ error: 'Not found' });
      await db.log('delete', name, { id: req.params.id });
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
});

// ============ Evaluations ============
app.get('/api/evaluations', async (req, res) => {
  try {
    const { companyId, constructionId, year, rank, status, search, dateFrom, dateTo, sortBy, sortDir } = req.query;
    let items = await db.evaluations.all();
    if (companyId) items = items.filter(e => String(e.companyId) === String(companyId));
    if (constructionId) items = items.filter(e => String(e.constructionId) === String(constructionId));
    if (year) items = items.filter(e => e.evaluationDate?.startsWith(year));
    if (rank) items = items.filter(e => e.rank === rank);
    if (status) items = items.filter(e => (e.status || '下書き') === status);
    if (dateFrom) items = items.filter(e => e.evaluationDate >= dateFrom);
    if (dateTo) items = items.filter(e => e.evaluationDate <= dateTo);

    items = await enrichAll(items);

    if (search) {
      const s = search.toLowerCase();
      items = items.filter(e =>
        (e.companyName || '').toLowerCase().includes(s) ||
        (e.constructionName || '').toLowerCase().includes(s) ||
        (e.constructionType || '').toLowerCase().includes(s) ||
        (e.evaluator || '').toLowerCase().includes(s) ||
        (e.commentBudget || '').toLowerCase().includes(s) ||
        (e.commentQuality || '').toLowerCase().includes(s) ||
        (e.commentSchedule || '').toLowerCase().includes(s) ||
        (e.commentSafety || '').toLowerCase().includes(s) ||
        (e.commentCommunication || '').toLowerCase().includes(s) ||
        (e.commentDocument || '').toLowerCase().includes(s) ||
        (e.commentProposal || '').toLowerCase().includes(s) ||
        (e.overallGood || '').toLowerCase().includes(s) ||
        (e.overallImprove || '').toLowerCase().includes(s) ||
        (e.overallExpectation || '').toLowerCase().includes(s)
      );
    }

    const sb = sortBy || 'evaluationDate';
    const dir = sortDir === 'asc' ? 1 : -1;
    items.sort((a, b) => {
      const av = a[sb] ?? ''; const bv = b[sb] ?? '';
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });

    res.json(items);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/evaluations/check-duplicate/:companyId/:constructionId', async (req, res) => {
  try {
    const list = (await db.evaluations.all()).filter(e =>
      String(e.companyId) === String(req.params.companyId) &&
      String(e.constructionId) === String(req.params.constructionId)
    );
    res.json({ exists: list.length > 0, items: await enrichAll(list) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/evaluations/summary-excel', async (req, res) => {
  try {
    const { year } = req.query;
    let items = await db.evaluations.all();
    if (year) items = items.filter(e => e.evaluationDate?.startsWith(year));
    items = await enrichAll(items);
    items.sort((a, b) => (b.evaluationDate || '').localeCompare(a.evaluationDate || ''));

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(year ? `評価集計_${year}年度` : '評価集計');
    ws.columns = [
      { header: '評価日', key: 'evaluationDate', width: 12 },
      { header: '協力会社', key: 'companyName', width: 18 },
      { header: '工事名', key: 'constructionName', width: 32 },
      { header: '工種', key: 'constructionType', width: 12 },
      { header: '予算', key: 'scoreBudget', width: 6 },
      { header: '品質', key: 'scoreQuality', width: 6 },
      { header: '工程', key: 'scoreSchedule', width: 6 },
      { header: '安全', key: 'scoreSafety', width: 6 },
      { header: 'コミ', key: 'scoreCommunication', width: 6 },
      { header: '書類', key: 'scoreDocument', width: 6 },
      { header: '提案', key: 'scoreProposal', width: 6 },
      { header: '合計', key: 'total', width: 8 },
      { header: '平均', key: 'average', width: 8 },
      { header: '評価', key: 'rank', width: 6 },
      { header: '評価者', key: 'evaluator', width: 14 },
      { header: '状態', key: 'status', width: 10 },
    ];
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
    ws.getRow(1).alignment = { horizontal: 'center', vertical: 'middle' };
    items.forEach(e => ws.addRow(e));

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    const fname = `評価集計表_${year || 'all'}_${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fname)}`);
    await wb.xlsx.write(res);
    res.end();
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/evaluations/export-csv', async (req, res) => {
  try {
    const items = await enrichAll(await db.evaluations.all());
    const cols = ['id', 'evaluationDate', 'companyName', 'constructionName', 'constructionType',
      'scoreBudget', 'scoreQuality', 'scoreSchedule', 'scoreSafety', 'scoreCommunication', 'scoreDocument', 'scoreProposal',
      'total', 'average', 'rank', 'evaluator', 'approver', 'status'];
    const csv = csvStringify(items, { header: true, columns: cols });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="evaluations_${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send('﻿' + csv);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/evaluations/bulk-excel', async (req, res) => {
  try {
    const ids = (req.body.ids || []).map(Number);
    if (ids.length === 0) return res.status(400).json({ error: 'No ids' });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="evaluations_${new Date().toISOString().slice(0, 10)}.zip"`);

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.pipe(res);

    for (const id of ids) {
      const e = await db.evaluations.find(id);
      if (!e) continue;
      const { wb, filename } = await buildExcel(e);
      const buffer = await wb.xlsx.writeBuffer();
      archive.append(buffer, { name: filename });
    }
    archive.finalize();
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/evaluations/:id', async (req, res) => {
  try {
    const item = await db.evaluations.find(req.params.id);
    if (!item) return res.status(404).json({ error: 'Not found' });
    res.json(await enrichEvaluation(item));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/evaluations', async (req, res) => {
  try {
    const data = req.body;
    const scores = [data.scoreBudget, data.scoreQuality, data.scoreSchedule, data.scoreSafety, data.scoreCommunication, data.scoreDocument, data.scoreProposal];
    const { total, average, rank } = calculateRank(scores);
    if (!data.status) data.status = '下書き';
    const result = await db.evaluations.insert({ ...data, total, average, rank });
    await db.log('create-evaluation', 'evaluations', { id: result.id, companyId: data.companyId });
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/evaluations/:id', async (req, res) => {
  try {
    const data = req.body;
    const scores = [data.scoreBudget, data.scoreQuality, data.scoreSchedule, data.scoreSafety, data.scoreCommunication, data.scoreDocument, data.scoreProposal];
    const { total, average, rank } = calculateRank(scores);
    const result = await db.evaluations.update(req.params.id, { ...data, total, average, rank });
    if (!result) return res.status(404).json({ error: 'Not found' });
    await db.log('update-evaluation', 'evaluations', { id: result.id });
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/evaluations/:id', async (req, res) => {
  try {
    const ok = await db.evaluations.delete(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Not found' });
    await db.log('delete-evaluation', 'evaluations', { id: req.params.id });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============ Excel build ============
async function buildExcel(evaluation) {
  const company = await db.companies.find(evaluation.companyId);
  const construction = await db.constructions.find(evaluation.constructionId);
  const dt = evaluation.evaluationDate ? new Date(evaluation.evaluationDate) : new Date();

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('評価シート');

  ws.pageSetup = {
    paperSize: 9, orientation: 'portrait',
    fitToPage: true, fitToWidth: 1, fitToHeight: 1,
    margins: { left: 0.55, right: 0.55, top: 0.45, bottom: 0.35, header: 0.15, footer: 0.15 },
    horizontalCentered: true, showGridLines: false, showRowColHeaders: false,
  };
  ws.properties.defaultRowHeight = 18;

  ws.columns = [
    { width: 6 },    // A: No / ラベル左
    { width: 22 },   // B: 項目名 / ラベル右
    { width: 36 },   // C: 視点 / 値
    { width: 8 },    // D: 評価点
    { width: 36 },   // E: コメント
  ];

  const bd = { style: 'thin', color: { argb: 'FF666666' } };
  const border = { top: bd, left: bd, bottom: bd, right: bd };
  const headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B4F72' } };
  const subHeaderFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E75B6' } };
  const headerFont = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11, name: 'Meiryo UI' };
  const baseFont = { size: 10, name: 'Meiryo UI' };
  const boldFont = { ...baseFont, bold: true };
  const titleFont = { bold: true, size: 18, name: 'Meiryo UI', color: { argb: 'FF1B4F72' } };
  const lightFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDF4FC' } };
  const wrapAlign = { vertical: 'middle', wrapText: true };

  function setRow(r, vals, opts = {}) {
    const row = ws.getRow(r);
    vals.forEach((v, i) => {
      const cell = row.getCell(i + 1);
      cell.value = v;
      cell.font = opts.font || baseFont;
      cell.alignment = opts.align || { vertical: 'middle' };
      if (opts.border) cell.border = border;
      if (opts.fill) cell.fill = opts.fill;
    });
    if (opts.height) row.height = opts.height;
    return row;
  }

  function mergeFull(r) { ws.mergeCells(`A${r}:E${r}`); }
  function mergeAB(r) { ws.mergeCells(`A${r}:B${r}`); }
  function mergeCE(r) { ws.mergeCells(`C${r}:E${r}`); }

  // Row 1: Spacer
  mergeFull(1);
  setRow(1, [''], { height: 8 });

  // Row 2: Title
  mergeFull(2);
  setRow(2, ['ニッケン建設株式会社　協力会社評価シート'], { font: titleFont, height: 36, align: { horizontal: 'center', vertical: 'middle' } });

  // Row 3: Underline bar
  mergeFull(3);
  setRow(3, [''], { height: 4, fill: headerFill });

  // Row 4: Date
  mergeFull(4);
  setRow(4, [`評価日：${dt.getFullYear()}年${dt.getMonth() + 1}月${dt.getDate()}日`], { font: { ...baseFont, size: 10 }, height: 20, align: { horizontal: 'right', vertical: 'middle' } });

  // Row 5: Section header
  mergeFull(5);
  setRow(5, ['  基本情報'], { font: headerFont, fill: headerFill, height: 22, border: true });

  // Rows 6-11: Basic info
  const infoRows = [
    ['協力会社名', company?.name || ''],
    ['工事名', construction?.name || ''],
    ['工事種別', evaluation.constructionType || ''],
    ['工期', evaluation.period || ''],
    ['評価者（現場責任者）', evaluation.evaluator || ''],
    ['承認者（工事部長）', evaluation.approver || ''],
  ];
  infoRows.forEach((row, i) => {
    const r = 6 + i;
    setRow(r, [row[0], '', row[1]], { border: true, height: 20, fill: i % 2 === 0 ? lightFill : undefined });
    ws.getCell(`A${r}`).font = { ...boldFont, size: 9 };
    ws.getCell(`C${r}`).font = { ...baseFont, size: 11 };
    mergeAB(r); mergeCE(r);
  });

  // Row 12: Spacer
  setRow(12, [''], { height: 6 });

  // Row 13: Section header
  mergeFull(13);
  setRow(13, ['  評価項目（5段階：1＝要改善 ～ 5＝期待を上回る）'], { font: headerFont, fill: headerFill, height: 22, border: true });

  // Row 14: Column headers
  const colHeaderFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD6E4F0' } };
  setRow(14, ['No', '評価項目', '評価の視点', '点数', 'コメント'], { font: { ...boldFont, size: 9 }, border: true, height: 18, fill: colHeaderFill, align: { horizontal: 'center', vertical: 'middle' } });

  // Rows 15-21: Score items
  const items = [
    [1, '予算・コスト対応', '厳しい予算にも柔軟に対応いただけたか', 'scoreBudget', 'commentBudget'],
    [2, '品質', '仕上がりは丁寧で品質基準を満たしていたか', 'scoreQuality', 'commentQuality'],
    [3, '工程・納期', '予定工程を守り作業を進めていただけたか', 'scoreSchedule', 'commentSchedule'],
    [4, '安全管理', '安全意識は高く保護具着用等徹底されていたか', 'scoreSafety', 'commentSafety'],
    [5, 'コミュニケーション', '他業者・当社担当者との意思疎通は円滑だったか', 'scoreCommunication', 'commentCommunication'],
    [6, '書類・報告対応', '必要書類が期日までに提出されたか', 'scoreDocument', 'commentDocument'],
    [7, '改善提案・技術力', '有益な提案や高い技術力の発揮があったか', 'scoreProposal', 'commentProposal'],
  ];
  items.forEach((item, i) => {
    const r = 15 + i;
    const score = evaluation[item[3]] ? Number(evaluation[item[3]]) : '';
    const comment = evaluation[item[4]] || '';
    setRow(r, [item[0], item[1], item[2], score, comment], { border: true, height: 30, fill: i % 2 === 0 ? lightFill : undefined, align: wrapAlign });
    ws.getCell(`A${r}`).alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getCell(`A${r}`).font = { ...baseFont, size: 9, color: { argb: 'FF666666' } };
    ws.getCell(`B${r}`).font = { ...boldFont, size: 10 };
    ws.getCell(`C${r}`).font = { ...baseFont, size: 9, color: { argb: 'FF555555' } };
    ws.getCell(`D${r}`).alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getCell(`D${r}`).font = { bold: true, size: 16, name: 'Meiryo UI', color: { argb: 'FF1B4F72' } };
    ws.getCell(`E${r}`).font = { ...baseFont, size: 9 };
  });

  // Row 22: Spacer
  setRow(22, [''], { height: 6 });

  // Row 23: Section header
  mergeFull(23);
  setRow(23, ['  総合評価'], { font: headerFont, fill: headerFill, height: 22, border: true });

  // Row 24: Summary scores
  const total = evaluation.total || '';
  const avg = evaluation.average || '';
  const rank = evaluation.rank || '';
  const rankColor = rank === 'S' ? 'FFFF6600' : rank === 'A' ? 'FF008000' : rank === 'D' ? 'FFCC0000' : 'FF1B4F72';
  setRow(24, ['', '', '', '', ''], { border: true, height: 32 });
  ws.getCell('A24').value = '合計点'; ws.getCell('A24').font = { ...boldFont, size: 9 };
  ws.getCell('B24').value = `${total} / 35`; ws.getCell('B24').font = { ...boldFont, size: 13 }; ws.getCell('B24').alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getCell('C24').value = '平均点'; ws.getCell('C24').font = { ...boldFont, size: 9 };
  ws.getCell('D24').value = avg; ws.getCell('D24').font = { bold: true, size: 14, name: 'Meiryo UI', color: { argb: rankColor } }; ws.getCell('D24').alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getCell('E24').value = `総合評価：${rank}`; ws.getCell('E24').font = { bold: true, size: 18, name: 'Meiryo UI', color: { argb: rankColor } }; ws.getCell('E24').alignment = { horizontal: 'center', vertical: 'middle' };

  // Row 25: Criteria note
  mergeFull(25);
  setRow(25, ['  判定基準 ― S:平均5.0(全満点)  A:4.2以上  B:3.4以上  C:2.6以上  D:2.6未満　※1がある場合→D  2がある場合→C以下'], { font: { ...baseFont, size: 8, italic: true, color: { argb: 'FF888888' } }, height: 16 });

  // Row 26: Spacer
  setRow(26, [''], { height: 6 });

  // Row 27: Section header
  mergeFull(27);
  setRow(27, ['  総評（現場責任者コメント）'], { font: headerFont, fill: subHeaderFill, height: 22, border: true });

  // Rows 28-30: Comments
  const commentRows = [
    ['良かった点', evaluation.overallGood || ''],
    ['改善をお願いしたい点', evaluation.overallImprove || ''],
    ['次回への期待・要望', evaluation.overallExpectation || ''],
  ];
  commentRows.forEach((row, i) => {
    const r = 28 + i;
    setRow(r, [row[0], '', row[1]], { border: true, height: 30, align: wrapAlign });
    ws.getCell(`A${r}`).font = { ...boldFont, size: 9 };
    ws.getCell(`C${r}`).font = { ...baseFont, size: 9 };
    mergeAB(r); mergeCE(r);
  });

  // Row 31: Spacer
  setRow(31, [''], { height: 10 });

  // Row 32: Footer
  mergeFull(32);
  setRow(32, ['ニッケン建設株式会社'], { font: { ...baseFont, size: 9, color: { argb: 'FF999999' } }, height: 16, align: { horizontal: 'center', vertical: 'middle' } });

  ws.pageSetup.printArea = 'A1:E32';

  return { wb, filename: `評価シート_${(company?.name || 'unknown')}_${dt.toISOString().slice(0, 10)}.xlsx` };
}

app.get('/api/evaluations/:id/excel', async (req, res) => {
  try {
    const e = await db.evaluations.find(req.params.id);
    if (!e) return res.status(404).json({ error: 'Not found' });
    const { wb, filename } = await buildExcel(e);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    await wb.xlsx.write(res);
    res.end();
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============ Radar Chart SVG ============
function buildRadarSvg(e) {
  const labels = ['予算','品質','工程','安全','コミュ','書類','提案'];
  const keys = ['scoreBudget','scoreQuality','scoreSchedule','scoreSafety','scoreCommunication','scoreDocument','scoreProposal'];
  const scores = keys.map(k => Number(e[k]) || 0);
  const n = 7;
  const cx = 100, cy = 95, maxR = 70;
  const angleOff = -Math.PI / 2;

  function pt(i, r) {
    const a = angleOff + (2 * Math.PI * i) / n;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  }

  // grid lines (1-5)
  let grid = '';
  for (let lv = 1; lv <= 5; lv++) {
    const r = (lv / 5) * maxR;
    const pts = Array.from({length: n}, (_, i) => pt(i, r).join(',')).join(' ');
    grid += `<polygon points="${pts}" fill="none" stroke="#ccc" stroke-width="${lv===5?1.2:0.5}"/>`;
  }

  // axis lines + labels
  let axes = '';
  labels.forEach((lb, i) => {
    const [x2, y2] = pt(i, maxR);
    axes += `<line x1="${cx}" y1="${cy}" x2="${x2}" y2="${y2}" stroke="#ddd" stroke-width="0.5"/>`;
    const [lx, ly] = pt(i, maxR + 14);
    axes += `<text x="${lx}" y="${ly}" text-anchor="middle" dominant-baseline="middle" font-size="8" fill="#333">${lb}</text>`;
  });

  // data polygon
  const dataPts = scores.map((s, i) => pt(i, (s / 5) * maxR).join(',')).join(' ');
  const dataShape = `<polygon points="${dataPts}" fill="rgba(30,80,140,0.25)" stroke="#1B4F72" stroke-width="1.8"/>`;

  // data dots
  let dots = '';
  scores.forEach((s, i) => {
    const [dx, dy] = pt(i, (s / 5) * maxR);
    dots += `<circle cx="${dx}" cy="${dy}" r="3" fill="#1B4F72"/>`;
  });

  return `<svg width="200" height="195" viewBox="0 0 200 195" xmlns="http://www.w3.org/2000/svg">${grid}${axes}${dataShape}${dots}</svg>`;
}

// ============ Print HTML ============
app.get('/api/evaluations/:id/print', async (req, res) => {
  try {
    const e = await db.evaluations.find(req.params.id);
    if (!e) return res.status(404).json({ error: 'Not found' });
    const company = await db.companies.find(e.companyId);
    const construction = await db.constructions.find(e.constructionId);
    const dt = e.evaluationDate ? new Date(e.evaluationDate) : new Date();
    const dateStr = `${dt.getFullYear()}年${dt.getMonth()+1}月${dt.getDate()}日`;
    const rankColor = e.rank==='S'?'#FF6600':e.rank==='A'?'#008000':e.rank==='D'?'#CC0000':'#1B4F72';
    const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
    const items = [
      [1,'予算・コスト対応','厳しい予算にも柔軟に対応いただけたか','scoreBudget','commentBudget'],
      [2,'品質','仕上がりは丁寧で品質基準を満たしていたか','scoreQuality','commentQuality'],
      [3,'工程・納期','予定工程を守り作業を進めていただけたか','scoreSchedule','commentSchedule'],
      [4,'安全管理','安全意識は高く保護具着用等徹底されていたか','scoreSafety','commentSafety'],
      [5,'コミュニケーション','他業者・当社担当者との意思疎通は円滑だったか','scoreCommunication','commentCommunication'],
      [6,'書類・報告対応','必要書類が期日までに提出されたか','scoreDocument','commentDocument'],
      [7,'改善提案・技術力','有益な提案や高い技術力の発揮があったか','scoreProposal','commentProposal'],
    ];
    const scoreRows = items.map((it,i) => `<tr style="background:${i%2===0?'#EDF4FC':'#fff'}">
      <td style="text-align:center;color:#888;width:30px">${it[0]}</td>
      <td style="font-weight:bold;width:140px">${esc(it[1])}</td>
      <td style="color:#555;font-size:9px">${esc(it[2])}</td>
      <td style="text-align:center;font-size:18px;font-weight:bold;color:#1B4F72;width:50px">${e[it[3]]||''}</td>
      <td style="font-size:9px">${esc(e[it[4]])}</td>
    </tr>`).join('');

    const html = `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8">
<title>評価シート - ${esc(company?.name)}</title>
<style>
@page { size: A4 portrait; margin: 12mm 14mm; }
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Meiryo UI','Meiryo',sans-serif; font-size: 10px; color: #222; width: 100%; }
.title { text-align: center; font-size: 18px; font-weight: bold; color: #1B4F72; padding: 12px 0 4px; }
.bar { height: 3px; background: #1B4F72; margin-bottom: 4px; }
.date { text-align: right; font-size: 10px; padding: 2px 0 8px; }
.section { background: #1B4F72; color: #fff; font-weight: bold; font-size: 11px; padding: 4px 10px; margin-top: 8px; }
.section.sub { background: #2E75B6; }
table { width: 100%; border-collapse: collapse; }
td, th { border: 1px solid #999; padding: 4px 6px; vertical-align: middle; }
th { background: #D6E4F0; font-size: 9px; text-align: center; }
.info td:first-child { font-weight: bold; font-size: 9px; width: 140px; }
.info td:last-child { font-size: 11px; }
.info tr:nth-child(odd) { background: #EDF4FC; }
.rank-row td { padding: 6px; }
.criteria { font-size: 8px; color: #888; font-style: italic; padding: 3px 4px; }
.comment td:first-child { font-weight: bold; font-size: 9px; width: 140px; }
.comment td:last-child { font-size: 10px; }
.footer { text-align: center; color: #999; font-size: 9px; padding-top: 10px; }
.radar-section { display: flex; align-items: flex-start; gap: 12px; margin-top: 6px; }
.radar-section table { flex: 1; }
.radar-chart { flex-shrink: 0; }
@media screen { body { max-width: 210mm; margin: 0 auto; padding: 10px; background: #f5f5f5; }
  .page { background: #fff; padding: 16mm; box-shadow: 0 2px 8px rgba(0,0,0,.1); }
  .no-print { text-align: center; padding: 12px; }
  .no-print button { font-size: 14px; padding: 8px 32px; background: #1B4F72; color: #fff; border: none; border-radius: 4px; cursor: pointer; } }
@media print { .no-print { display: none; } }
</style></head><body>
<div class="no-print"><button onclick="window.print()">🖨️ 印刷する</button> <button onclick="window.close()" style="background:#666;margin-left:8px">閉じる</button></div>
<div class="page">
<div class="title">ニッケン建設株式会社　協力会社評価シート</div>
<div class="bar"></div>
<div class="date">評価日：${dateStr}</div>
<div class="section">基本情報</div>
<table class="info"><tr><td>協力会社名</td><td>${esc(company?.name)}</td></tr>
<tr><td>工事名</td><td>${esc(construction?.name)}</td></tr>
<tr><td>工事種別</td><td>${esc(e.constructionType)}</td></tr>
<tr><td>工期</td><td>${esc(e.period)}</td></tr>
<tr><td>評価者（現場責任者）</td><td>${esc(e.evaluator)}</td></tr>
<tr><td>承認者（工事部長）</td><td>${esc(e.approver)}</td></tr></table>
<div class="section">評価項目（5段階：1＝要改善 ～ 5＝期待を上回る）</div>
<table><thead><tr><th>No</th><th>評価項目</th><th>評価の視点</th><th>点数</th><th>コメント</th></tr></thead>
<tbody>${scoreRows}</tbody></table>
<div class="section">総合評価</div>
<div class="radar-section">
<table style="width:auto;flex:1"><tr class="rank-row">
<td style="font-weight:bold;font-size:9px;width:60px">合計点</td>
<td style="text-align:center;font-size:14px;font-weight:bold;width:80px">${e.total||''} / 35</td>
<td style="font-weight:bold;font-size:9px;width:60px">平均点</td>
<td style="text-align:center;font-size:14px;font-weight:bold;color:${rankColor};width:60px">${e.average||''}</td>
<td style="text-align:center;font-size:20px;font-weight:bold;color:${rankColor}">総合評価：${e.rank||''}</td>
</tr></table>
<div class="radar-chart">${buildRadarSvg(e)}</div>
</div>
<div class="criteria">判定基準 ― S:平均5.0(全満点)　A:4.2以上　B:3.4以上　C:2.6以上　D:2.6未満　※1がある場合→D　2がある場合→C以下</div>
<div class="section sub">総評（現場責任者コメント）</div>
<table class="comment"><tr><td>良かった点</td><td>${esc(e.overallGood)}</td></tr>
<tr><td>改善をお願いしたい点</td><td>${esc(e.overallImprove)}</td></tr>
<tr><td>次回への期待・要望</td><td>${esc(e.overallExpectation)}</td></tr></table>
<div class="footer">ニッケン建設株式会社</div>
</div></body></html>`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============ Stats ============
app.get('/api/stats/summary', async (req, res) => {
  try {
    const evaluations = await db.evaluations.all();
    const companies = await db.companies.all();
    const ranks = { S: 0, A: 0, B: 0, C: 0, D: 0 };
    evaluations.forEach(e => { if (ranks[e.rank] !== undefined) ranks[e.rank]++; });
    const validAvgs = evaluations.filter(e => e.average);
    const avgScore = validAvgs.length > 0
      ? Number((validAvgs.reduce((s, e) => s + (e.average || 0), 0) / validAvgs.length).toFixed(2))
      : 0;

    const statuses = { '下書き': 0, '提出済': 0, '承認済': 0, '送付済': 0 };
    evaluations.forEach(e => { const st = e.status || '下書き'; if (statuses[st] !== undefined) statuses[st]++; });

    res.json({ totalEvaluations: evaluations.length, totalCompanies: companies.length, ranks, averageScore: avgScore, statuses });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/stats/by-company', async (req, res) => {
  try {
    const evaluations = await db.evaluations.all();
    const companies = await db.companies.all();
    const result = companies.map(c => {
      const evals = evaluations.filter(e => e.companyId === c.id);
      const scores = evals.filter(e => e.average !== null);
      const avg = scores.length > 0 ? scores.reduce((s, e) => s + e.average, 0) / scores.length : null;
      return {
        companyId: c.id, companyName: c.name, count: evals.length,
        averageScore: avg ? Math.round(avg * 100) / 100 : null,
        latestDate: evals.length > 0 ? evals.map(e => e.evaluationDate).sort().reverse()[0] : null,
        ranks: evals.reduce((acc, e) => { acc[e.rank] = (acc[e.rank] || 0) + 1; return acc; }, {}),
      };
    }).filter(r => r.count > 0).sort((a, b) => (b.averageScore || 0) - (a.averageScore || 0));
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/stats/by-type', async (req, res) => {
  try {
    const evaluations = await db.evaluations.all();
    const map = {};
    evaluations.forEach(e => {
      const t = e.constructionType || '未分類';
      if (!map[t]) map[t] = { type: t, count: 0, sumAvg: 0, ranks: {} };
      map[t].count++;
      map[t].sumAvg += (e.average || 0);
      map[t].ranks[e.rank] = (map[t].ranks[e.rank] || 0) + 1;
    });
    const result = Object.values(map).map(x => ({
      ...x, averageScore: x.count > 0 ? Math.round((x.sumAvg / x.count) * 100) / 100 : 0,
    })).sort((a, b) => b.averageScore - a.averageScore);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/stats/monthly', async (req, res) => {
  try {
    const evaluations = await db.evaluations.all();
    const map = {};
    evaluations.forEach(e => {
      const month = e.evaluationDate?.slice(0, 7);
      if (!month) return;
      if (!map[month]) map[month] = { month, count: 0, sumAvg: 0 };
      map[month].count++;
      map[month].sumAvg += (e.average || 0);
    });
    const result = Object.values(map).map(x => ({
      month: x.month, count: x.count,
      averageScore: x.count > 0 ? Math.round((x.sumAvg / x.count) * 100) / 100 : 0,
    })).sort((a, b) => a.month.localeCompare(b.month));
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/stats/missing-evaluations', async (req, res) => {
  try {
    const constructions = (await db.constructions.all()).filter(c => c.status === '進行中' || c.status === '完了');
    const evaluations = await db.evaluations.all();
    const result = constructions.map(c => {
      const evalCount = evaluations.filter(e => e.constructionId === c.id).length;
      return { construction: c, evaluationCount: evalCount };
    }).filter(x => x.evaluationCount === 0);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/stats/company-history/:id', async (req, res) => {
  try {
    let evals = (await db.evaluations.all())
      .filter(e => String(e.companyId) === String(req.params.id));
    evals = await enrichAll(evals);
    evals.sort((a, b) => (a.evaluationDate || '').localeCompare(b.evaluationDate || ''));
    res.json(evals);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============ Backup ============
app.get('/api/backup/download', async (req, res) => {
  try {
    if (db.DATA_DIR) {
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="evaluation-system-backup_${new Date().toISOString().slice(0, 10)}.zip"`);
      const archive = archiver('zip', { zlib: { level: 9 } });
      archive.pipe(res);
      archive.directory(db.DATA_DIR, 'data');
      archive.finalize();
    } else {
      const allData = {};
      for (const [key, col] of Object.entries({ companies: db.companies, constructions: db.constructions, constructionTypes: db.constructionTypes, users: db.users, approvers: db.approvers, evaluations: db.evaluations, commentTemplates: db.commentTemplates })) {
        allData[key] = await col.all(true);
      }
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="evaluation-system-backup_${new Date().toISOString().slice(0, 10)}.json"`);
      res.json(allData);
    }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/backup/restore', express.raw({ type: 'application/zip', limit: '50mb' }), async (req, res) => {
  res.json({ ok: false, message: 'バックアップの復元は管理者にお問い合わせください。' });
});

// ============ Logs ============
app.get('/api/logs', async (req, res) => {
  try {
    const items = (await db.activityLog.all()).slice(-200).reverse();
    res.json(items);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============ Seed data (cloud) ============
async function seedIfEmpty() {
  if ((await db.companies.count()) === 0) {
    const companies = [
      "井東工業", "岩田", "OS", "岡部", "オグリ", "カンドー", "KP", "健商",
      "鋼建", "成和", "ソリタ", "大央", "建和", "塗夢装", "長嶺", "奈良谷",
      "野口", "馬場", "浜本工業", "日立", "不二", "藤喜", "丸清商店", "ミリー",
      "ユーホク", "YD"
    ].map(name => ({ name, representative: '', phone: '', email: '', address: '', mainType: '', notes: '' }));
    await db.companies.bulkInsert(companies);
    console.log(`  Seeded ${companies.length} companies`);
  }

  if ((await db.constructions.count()) === 0) {
    await db.constructions.bulkInsert([{
      name: '(仮称)川崎区日進町ビル新築工事', location: '神奈川県川崎市川崎区日進町',
      startDate: '2025-03-24', endDate: '2026-03-31', client: '', manager: '', status: '進行中', notes: ''
    }]);
    console.log('  Seeded construction master');
  }

  if ((await db.constructionTypes.count()) === 0) {
    const types = [
      ['外構', '土木'], ['鉄筋', '躯体'], ['型枠', '躯体'], ['コンクリート', '躯体'],
      ['鉄骨', '躯体'], ['土工', '土木'], ['解体', '土木'], ['防水', '仕上'],
      ['塗装', '仕上'], ['内装', '仕上'], ['建具', '仕上'], ['タイル', '仕上'],
      ['電気', '設備'], ['給排水衛生設備', '設備'], ['空調換気設備', '設備'],
      ['ガス設備', '設備'], ['エレベーター', '設備'], ['屋根', '仕上'],
      ['サッシ', '仕上'], ['左官', '仕上']
    ].map(([name, category]) => ({ name, category, notes: '' }));
    await db.constructionTypes.bulkInsert(types);
    console.log(`  Seeded ${types.length} construction types`);
  }

  if ((await db.users.count()) === 0) {
    await db.users.bulkInsert([{
      name: '中辻 良太', position: '', department: '', email: 'nakatsuji777@gmail.com',
      loginId: '', role: '管理者', notes: ''
    }]);
    console.log('  Seeded user master');
  }

  if ((await db.approvers.count()) === 0) {
    await db.approvers.bulkInsert([
      { name: '高橋 孝雄', position: '工事部長', notes: '' },
    ]);
    console.log('  Seeded approver master');
  }

  if ((await db.commentTemplates.count()) === 0) {
    const templates = [
      ['budget', '厳しい予算にも柔軟にご対応いただきました。'],
      ['budget', '追加工事の見積も適正価格でご提示いただきました。'],
      ['budget', 'コスト削減のご提案をいただき、大変助かりました。'],
      ['budget', '予算内で良質な工事をしていただきました。'],
      ['budget', '見積精度が高く、予算管理がしやすかったです。'],
      ['budget', '予算に対する意識が高く、無駄のない施工でした。'],
      ['budget', '特にありませんでした。'],
      ['quality', '仕上がりが丁寧で、当社の品質基準を十分に満たしていただきました。'],
      ['quality', '養生・後始末が適切で、現場が常に整理されていました。'],
      ['quality', '細部まで気を配った仕上がりでした。'],
      ['quality', '再施工なく、一度で高品質な仕上がりとなりました。'],
      ['quality', '当社の指示通りの品質を確保していただきました。'],
      ['quality', '丁寧な施工で、お客様にも喜んでいただけました。'],
      ['quality', '特にありませんでした。'],
      ['schedule', '予定された工程通りに作業を進めていただきました。'],
      ['schedule', '工期を短縮していただき、後の工程に余裕ができました。'],
      ['schedule', '天候不良時の対応が迅速で、遅延を最小限に抑えられました。'],
      ['schedule', '進捗報告がこまめで、工程管理がしやすかったです。'],
      ['schedule', '他業者との調整がスムーズで、全体工程に貢献いただきました。'],
      ['schedule', '段取りが良く、効率的に作業を進めていただきました。'],
      ['schedule', '特にありませんでした。'],
      ['safety', '安全意識が高く、保護具着用も徹底されていました。'],
      ['safety', 'KY活動・朝礼への参加が積極的でした。'],
      ['safety', '事故・ヒヤリハットゼロで完了いただきました。'],
      ['safety', '現場の整理整頓が行き届いており、安全な作業環境でした。'],
      ['safety', '危険予知活動が徹底されており安心できました。'],
      ['safety', '安全書類の管理も適切に行われていました。'],
      ['safety', '特にありませんでした。'],
      ['communication', '他業者との対応が良く、近隣にも配慮していただきました。'],
      ['communication', '報連相が徹底されており、現場運営がスムーズでした。'],
      ['communication', '当社担当者との意思疎通が円滑でした。'],
      ['communication', '近隣対応も丁寧で、トラブルなく進められました。'],
      ['communication', '協調性があり、他業者との連携も取れていました。'],
      ['communication', '現場マナーが良く、清潔感のある対応でした。'],
      ['communication', '特にありませんでした。'],
      ['document', '必要書類を期日通りに提出いただきました。'],
      ['document', '施工計画書の内容が詳細で分かりやすかったです。'],
      ['document', '安全書類の不備がなく、スムーズに承認できました。'],
      ['document', '日報・週報の提出が適切に行われていました。'],
      ['document', '完了報告書の写真添付など、丁寧に対応いただきました。'],
      ['document', '変更時の書類対応も迅速でした。'],
      ['document', '特にありませんでした。'],
      ['proposal', '工期短縮のご提案をいただき、実際に大幅短縮できました。'],
      ['proposal', 'コスト削減につながる代替工法をご提案いただきました。'],
      ['proposal', '高い技術力で、難しい施工も問題なく完了いただきました。'],
      ['proposal', '現場での創意工夫が見られ、品質向上につながりました。'],
      ['proposal', '経験豊富な職人による的確な対応でした。'],
      ['proposal', '他現場でも採用したい工夫がありました。'],
      ['proposal', '特にありませんでした。'],
      ['good', '予定工期を大幅に短縮していただき、後工程に余裕ができました。'],
      ['good', '仕上がりが丁寧で、お客様にもご好評いただきました。'],
      ['good', '安全管理が徹底されており、無事故で完了できました。'],
      ['good', 'コミュニケーションが円滑で、現場運営がスムーズでした。'],
      ['good', '予算内で高品質な工事を完成させていただきました。'],
      ['good', '他業者との連携が良く、全体工程に貢献いただきました。'],
      ['good', '近隣対応も丁寧で、トラブルなく完了できました。'],
      ['improve', '特にありませんでした。'],
      ['improve', '書類提出をもう少し早めていただけると助かります。'],
      ['improve', '進捗報告の頻度を上げていただけると安心です。'],
      ['improve', '現場の整理整頓をより徹底いただけると幸いです。'],
      ['improve', '打合せ時の参加者を増やしていただけると円滑に進められます。'],
      ['improve', '変更事項の連絡をより迅速にお願いしたいです。'],
      ['improve', '近隣への挨拶・配慮をより丁寧にお願いしたいです。'],
      ['expectation', '今後ともよろしくお願いいたします。'],
      ['expectation', '次回も継続してお取引させていただきたく存じます。'],
      ['expectation', '他現場でもご協力いただけますと幸いです。'],
      ['expectation', '今後ともご指導のほどよろしくお願いいたします。'],
      ['expectation', '引き続きよろしくお願いいたします。'],
      ['expectation', 'より大規模な案件もぜひお願いしたいと存じます。'],
      ['expectation', '御社の技術力に期待しております。今後もよろしくお願いいたします。'],
    ].map(([category, text], i) => ({ category, text, displayOrder: i }));
    await db.commentTemplates.bulkInsert(templates);
    console.log(`  Seeded ${templates.length} comment templates`);
  }
}

// ============ Start ============
async function start() {
  if (db.initSchema) {
    console.log('Initializing PostgreSQL schema...');
    await db.initSchema();
  }
  console.log('Seeding data if needed...');
  await seedIfEmpty();

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n╔════════════════════════════════════════════╗`);
    console.log(`║  協力会社評価システム 起動                  ║`);
    console.log(`║  http://localhost:${PORT}                       ║`);
    console.log(`╚════════════════════════════════════════════╝\n`);
  });
}

start().catch(err => {
  console.error('Startup failed:', err);
  process.exit(1);
});
