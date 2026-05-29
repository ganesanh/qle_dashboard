#!/usr/bin/env node
/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║           QLE / SEP Config & Validation Rules Formatter              ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 *
 * REQUIRES: Node.js (https://nodejs.org) — nothing else to install.
 *
 * RUN:
 *   node qle-formatter.js
 *
 * OPTIONS:
 *   --new 10        Pre-mark Group 10 as NEW (yellow bg, red text)
 *   --new 3,7,10    Pre-mark multiple events as NEW
 *   --list          List events found without writing output
 *   --help          Show help
 *
 * On first run the script auto-installs two small dependencies into
 * qle-formatter-deps/ next to this file. Takes ~15 seconds once only.
 */

import cp from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import rl from 'node:readline';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Colours ───────────────────────────────────────────────────────
const T = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
  grey: '\x1b[90m',
  dim: '\x1b[2m',
};

// ── Dependency installer ──────────────────────────────────────────
const DEPS_DIR = path.join(__dirname, 'qle-formatter-deps');
const EXCELJS = path.join(DEPS_DIR, 'node_modules', 'exceljs');
const SHEETJS = path.join(DEPS_DIR, 'node_modules', 'xlsx');

function ensureDeps() {
  if (fs.existsSync(EXCELJS) && fs.existsSync(SHEETJS)) return;

  console.log(`${T.bold}First run — installing dependencies...${T.reset}`);
  console.log(
    `${T.grey}This takes ~15 seconds and only happens once.${T.reset}\n`,
  );

  fs.mkdirSync(DEPS_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(DEPS_DIR, 'package.json'),
    JSON.stringify({
      name: 'qle-formatter-deps',
      version: '1.0.0',
      private: true,
    }),
  );

  try {
    cp.execSync('npm install exceljs xlsx --save --loglevel=error', {
      cwd: DEPS_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    console.log(`${T.green}✓ Dependencies installed.\n${T.reset}`);
  } catch (e) {
    console.error(`${T.red}✗ Could not install dependencies.${T.reset}`);
    console.error(
      `${T.grey}  Make sure you have internet access and try again.${T.reset}`,
    );
    process.exit(1);
  }
}

// ── Prompt helper ─────────────────────────────────────────────────
function ask(q) {
  const iface = rl.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((res) =>
    iface.question(q, (a) => {
      iface.close();
      res(a.trim());
    }),
  );
}
function cleanPath(raw) {
  return raw
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .trim();
}

// ── Argument parser ───────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  let newNums = [],
    listOnly = false,
    showHelp = false,
    inputPath = '',
    outputPath = '',
    batchDir = '';
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-h' || a === '--help') showHelp = true;
    else if (a === '-l' || a === '--list') listOnly = true;
    else if ((a === '-i' || a === '--input') && args[i + 1]) inputPath = args[++i];
    else if ((a === '-o' || a === '--output') && args[i + 1]) outputPath = args[++i];
    else if ((a === '-d' || a === '--batch-dir') && args[i + 1])
      batchDir = args[++i];
    else if ((a === '-n' || a === '--new') && args[i + 1])
      newNums = args[++i]
        .split(',')
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => !isNaN(n) && n > 0);
    else if (!a.startsWith('-')) {
      /* ignore */
    } else {
      console.error(`${T.red}Unknown option: ${a}${T.reset}\n`);
      process.exit(1);
    }
  }
  return { newNums, listOnly, showHelp, inputPath, outputPath, batchDir };
}

// ════════════════════════════════════════════════════════════════════
// COLOURS / CONSTANTS
// ════════════════════════════════════════════════════════════════════
const C = {
  EVENT: 'FF1F4E79',
  EVKEY: 'FF2E4057',
  EVLBL: 'FFD6E4F0',
  CAT: 'FF2E75B6',
  ENUM: 'FFE2EFDA',
  VAL: 'FFFFF2CC',
  VAL_RBG: 'FFD9E8D4',
  VAL_RFC: 'FF1E4620',
  REMOVED_BG: 'FFFFFF00',
  REMOVED_FC: 'FFC00000',
  INST: 'FFEAF2FB',
  ALT: 'FFEBF3FA',
  WHITE: 'FFFFFFFF',
  NEW_BG: 'FFFFEB9C',
  NEW_FC: 'FFC00000',
  NEW_KEY: 'FFFF8C00',
  NEW_ENUM: 'FFFFF3CD',
  NEW_INST: 'FFFFF9E6',
  SPACER: 'FFE7E6E6',
  HDR: 'FF2F5496',
  HDR_DOC: 'FF5B9BD5',
  WARN_FC: 'FF7F3F00',
};
const FONT = 'Arial',
  CA = 15,
  CB = 58,
  CC = 52,
  CD = 52,
  CE = 36,
  CF = 6;
const READ_XLSX_OPTS = {
  ignoreNodes: [
    'drawing',
    'picture',
    'tableParts',
    'conditionalFormatting',
    'dataValidations',
    'headerFooter',
    'sheetProtection',
    'extLst',
  ],
};

// ════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════
function autoH(text, colW, sz = 9, mn = 15) {
  if (!text) return mn;
  const cpl = Math.max(1, Math.floor(colW * 1.1));
  const lines = String(text)
    .split('\n')
    .reduce((a, s) => a + Math.max(1, Math.ceil(s.length / cpl)), 0);
  return Math.max(mn, Math.ceil(lines * sz * 1.4) + 4);
}
const maxH = (...v) => Math.max(...v);

function cs(cell, val, o = {}) {
  const {
    fc = 'FF000000',
    bg = C.WHITE,
    bold = false,
    strike = false,
    sz = 9,
    ha = 'left',
    va = 'middle',
    wrap = true,
    mono = false,
  } = o;
  cell.value = val;
  cell.font = {
    name: mono ? 'Courier New' : FONT,
    size: sz,
    bold,
    strike,
    color: { argb: fc },
  };
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
  cell.alignment = { horizontal: ha, vertical: va, wrapText: wrap };
  cell.border = {
    top: { style: 'thin', color: { argb: 'FFB8CCE4' } },
    bottom: { style: 'thin', color: { argb: 'FFB8CCE4' } },
    left: { style: 'thin', color: { argb: 'FFB8CCE4' } },
    right: { style: 'thin', color: { argb: 'FFB8CCE4' } },
  };
}
function docBdr(cell) {
  const s = { style: 'thin', color: { argb: 'FF8EA9C1' } };
  cell.border = { top: s, bottom: s, left: s, right: s };
}

// ════════════════════════════════════════════════════════════════════
// PARSING
// ════════════════════════════════════════════════════════════════════
function normalise(t) {
  return String(t).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}
function splitEnums(t) {
  return t
    ? normalise(t)
        .split(/[\n,]+/)
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
}
function splitLabels(t) {
  return t
    ? normalise(t)
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
}

function splitBulletLabels(t) {
  if (!t) return [];
  const normalized = normalise(String(t)).trim();
  if (!normalized.includes('•')) return [];
  return normalized
    .split(/(?=•)/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

function splitDocs(eRaw, enRaw, esRaw, sortN) {
  const enums = [
    ...normalise(String(eRaw ?? ''))
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean),
  ];
  const enBullets = splitBulletLabels(enRaw);
  const esBullets = splitBulletLabels(esRaw);
  const en =
    enBullets.length === enums.length
      ? enBullets
      : normalise(String(enRaw ?? ''))
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean);
  const es =
    esBullets.length === enums.length
      ? esBullets
      : normalise(String(esRaw ?? ''))
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean);
  return enums.map((e, i) => ({
    sort: enums.length > 1 ? i + 1 : Number(sortN ?? i + 1) || i + 1,
    enum: e,
    en: en[i] ?? en[en.length - 1] ?? '',
    es: es[i] ?? es[es.length - 1] ?? '',
  }));
}

function buildSplitNewFlags(count, rowHasHighlight) {
  if (!rowHasHighlight || count <= 0) {
    return {
      rowIsNew: false,
      itemFlags: Array.from({ length: count }, () => false),
    };
  }

  if (count === 1) {
    return {
      rowIsNew: true,
      itemFlags: [true],
    };
  }

  return {
    rowIsNew: false,
    itemFlags: Array.from({ length: count }, (_, index) => index === count - 1),
  };
}

function promoteAllFlags(flags) {
  if (!flags.rowIsNew && !flags.itemFlags.some(Boolean)) return flags;
  return {
    rowIsNew: flags.rowIsNew,
    itemFlags: flags.itemFlags.map(() => true),
  };
}

function normalizeDocumentSorts(events) {
  events.forEach((event) => {
    event.categories.forEach((category) => {
      category.documents.forEach((document, index) => {
        document.sort = index + 1;
      });
    });
  });
  return events;
}

function findSheetName(wb) {
  const names = wb.worksheets.map((ws) => ws.name);
  for (const n of [
    'Configuration & Validation Rules',
    'Configuration and Validation Ru',
    'QLE_Documents',
    'QLE Documents',
  ])
    if (names.includes(n)) return n;
  return (
    names.find(
      (n) =>
        n.toLowerCase().startsWith('configuration') ||
        n.toLowerCase().startsWith('qle'),
    ) ?? names[0]
  );
}

function getCellText(cell) {
  if (!cell || cell.value == null) return null;

  if (typeof cell.value === 'object') {
    if (Array.isArray(cell.value.richText)) {
      const text = cell.value.richText.map((part) => part.text ?? '').join('');
      return text.trim() ? text : null;
    }
    if (cell.value.text != null) return String(cell.value.text).trim() || null;
    if (cell.value.result != null)
      return String(cell.value.result).trim() || null;
    if (cell.value.hyperlink != null)
      return String(cell.value.text ?? cell.value.hyperlink).trim() || null;
  }

  const text = cell.text != null ? String(cell.text).trim() : '';
  return text || null;
}

function getConcreteArgb(color) {
  if (!color || typeof color !== 'object') return null;
  const raw = typeof color.argb === 'string' ? color.argb.trim() : '';
  if (!raw) return null;
  const hex = raw.replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
  if (hex.length === 8) return hex;
  if (hex.length === 6) return `FF${hex}`;
  return null;
}

function isRedArgb(argb) {
  if (!argb) return false;
  const rgb = argb.slice(-6);
  const r = parseInt(rgb.slice(0, 2), 16);
  const g = parseInt(rgb.slice(2, 4), 16);
  const b = parseInt(rgb.slice(4, 6), 16);
  return r >= 170 && g <= 130 && b <= 130;
}

function isYellowArgb(argb) {
  if (!argb) return false;
  const rgb = argb.slice(-6);
  const r = parseInt(rgb.slice(0, 2), 16);
  const g = parseInt(rgb.slice(2, 4), 16);
  const b = parseInt(rgb.slice(4, 6), 16);
  return r >= 235 && g >= 210 && b <= 120;
}

function cellHasStrike(cell) {
  if (!cell) return false;
  if (cell.font?.strike) return true;
  if (Array.isArray(cell.value?.richText)) {
    return cell.value.richText.some((part) => Boolean(part?.font?.strike));
  }
  return false;
}

function cellSignalsNew(cell) {
  if (!cell) return false;

  if (Array.isArray(cell.value?.richText)) {
    const hasRedRichText = cell.value.richText.some((part) =>
      isRedArgb(getConcreteArgb(part?.font?.color)),
    );
    if (hasRedRichText) return true;
  }

  const fontArgb = getConcreteArgb(cell.font?.color);
  return isRedArgb(fontArgb);
}

function cellSignalsRemoved(cell) {
  const fillArgb =
    getConcreteArgb(cell?.fill?.fgColor) ?? getConcreteArgb(cell?.fill?.bgColor);
  return cellHasStrike(cell) && isYellowArgb(fillArgb);
}

function buildCellLineNewFlags(cell) {
  const pushLine = (flags, text, isNew) => {
    if (text.trim()) flags.push(isNew);
  };

  if (Array.isArray(cell?.value?.richText)) {
    const flags = [];
    let currentText = '';
    let currentIsNew = false;

    for (const part of cell.value.richText) {
      const text = part?.text ?? '';
      const partIsNew = isRedArgb(getConcreteArgb(part?.font?.color));
      const segments = text.split('\n');
      segments.forEach((segment, index) => {
        if (segment) {
          currentText += segment;
          currentIsNew = currentIsNew || partIsNew;
        }
        if (index < segments.length - 1) {
          pushLine(flags, currentText, currentIsNew);
          currentText = '';
          currentIsNew = false;
        }
      });
    }

    pushLine(flags, currentText, currentIsNew);
    return flags;
  }

  const text = getCellText(cell);
  if (!text) return [];
  const splitCount = splitLabels(text).length;
  return Array.from({ length: splitCount }, () => cellSignalsNew(cell));
}

function buildInputRows(ws) {
  let maxCol = 0;
  ws.eachRow({ includeEmpty: false }, (row) => {
    row.eachCell({ includeEmpty: false }, (cell) => {
      if (cell.col > maxCol) maxCol = cell.col;
    });
  });

  const rows = [];
  const styleRows = [];
  const removedStyleRows = [];
  const lineStyleRows = [];
  for (let ri = 1; ri <= ws.rowCount; ri++) {
    const row = ws.getRow(ri);
    const values = Array(maxCol).fill(null);
    const styles = Array(maxCol).fill(false);
    const removedStyles = Array(maxCol).fill(false);
    const lineStyles = Array.from({ length: maxCol }, () => []);
    for (let ci = 1; ci <= maxCol; ci++) {
      const cell = row.getCell(ci);
      const isMergedChild =
        cell.isMerged &&
        cell.master &&
        cell.master.address &&
        cell.master.address !== cell.address;
      values[ci - 1] = isMergedChild ? null : getCellText(cell);
      styles[ci - 1] = isMergedChild ? false : cellSignalsNew(cell);
      removedStyles[ci - 1] = isMergedChild ? false : cellSignalsRemoved(cell);
      lineStyles[ci - 1] = isMergedChild ? [] : buildCellLineNewFlags(cell);
    }
    rows.push(values);
    styleRows.push(styles);
    removedStyleRows.push(removedStyles);
    lineStyleRows.push(lineStyles);
  }
  return { rows, styleRows, removedStyleRows, lineStyleRows };
}

function isProcessableWorkbook(filePath) {
  const base = path.basename(filePath);
  return (
    filePath.toLowerCase().endsWith('.xlsx') &&
    !base.startsWith('~$') &&
    !base.toLowerCase().endsWith('_formatted.xlsx')
  );
}

function collectWorkbooks(rootDir) {
  const found = [];
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      found.push(...collectWorkbooks(fullPath));
      continue;
    }
    if (entry.isFile() && isProcessableWorkbook(fullPath)) found.push(fullPath);
  }
  return found.sort();
}

function buildColMap(rows) {
  // Find header row: first row where col[0] === "Event"
  let hdrIdx = -1;
  for (let i = 0; i < Math.min(5, rows.length); i++) {
    if (String(rows[i][0] ?? '').trim() === 'Event') {
      hdrIdx = i;
      break;
    }
  }

  if (hdrIdx >= 0) {
    const hdr = rows[hdrIdx].map((v) =>
      normalise(String(v ?? ''))
        .toLowerCase()
        .trim()
        .replace(/\s+/g, ' '),
    );
    const map = {};
    let enc = 0,
      esc = 0,
      ic = 0;
    hdr.forEach((lbl, ci) => {
      if (!lbl) return;
      if (lbl === 'event') {
        map[0] = ci;
        return;
      }
      if (
        lbl.includes('provide') ||
        lbl.includes('instruct') ||
        lbl.includes('qualify')
      ) {
        ic++;
        if (ic === 1) map[3] = ci;
        else if (ic === 2) map[4] = ci;
        return;
      }
      if (lbl.includes('english') && !lbl.includes('doc')) {
        enc++;
        if (enc === 1) map[1] = ci;
        else if (enc === 2) map[6] = ci;
        else if (enc === 3) map[9] = ci;
        return;
      }
      if (lbl.includes('spanish') && !lbl.includes('doc')) {
        esc++;
        if (esc === 1) map[2] = ci;
        else if (esc === 2) map[7] = ci;
        else if (esc === 3) map[10] = ci;
        return;
      }
      if (lbl.includes('categor')) {
        map[5] = ci;
        return;
      }
      if (lbl.includes('document enum')) {
        if (map[8] === undefined) map[8] = ci;
        return;
      }
      if (
        lbl.includes('document') &&
        !['english', 'spanish', 'sort', 'valid', 'text'].some((x) =>
          lbl.includes(x),
        )
      ) {
        if (map[8] === undefined) map[8] = ci;
        return;
      }
      if (lbl.includes('english') && lbl.includes('doc')) {
        map[9] = ci;
        return;
      }
      if (lbl.includes('spanish') && lbl.includes('doc')) {
        map[10] = ci;
        return;
      }
      if (lbl.includes('sort')) {
        map[11] = ci;
        return;
      }
      if (lbl.includes('valid') || lbl.includes('mandatory')) {
        map[12] = ci;
        return;
      }
    });
    if (map[0] !== undefined && map[5] !== undefined && map[8] !== undefined)
      return { map, dataStart: hdrIdx + 1 };
  }

  // Positional fallback from first data row
  const dataRow = hdrIdx >= 0 ? rows[hdrIdx + 1] : rows[0];
  const nonNull = dataRow.map((_, i) => i).filter((i) => dataRow[i] != null);
  const map = {};
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].forEach((slot, i) => {
    if (nonNull[i] !== undefined) map[slot] = nonNull[i];
  });
  return { map, dataStart: hdrIdx >= 0 ? hdrIdx + 1 : 0 };
}

function parseSheet(rows, styleRows, removedStyleRows, lineStyleRows) {
  const { map, dataStart } = buildColMap(rows);
  console.log(
    `  ${T.grey}Col map: ${Object.entries(map)
      .map(([k, v]) => `slot${k}→col${v}`)
      .join(', ')}${T.reset}`,
  );

  const g = (row, slot) => {
    const ci = map[slot];
    if (ci === undefined) return null;
    const v = row[ci];
    return v != null ? String(v).trim() : null;
  };
  const gv = (row, slot) => {
    const ci = map[slot];
    return ci !== undefined ? row[ci] : null;
  };
  const hasNew = (rowStyles, slots) =>
    slots.some((slot) => {
      const ci = map[slot];
      return ci !== undefined && rowStyles?.[ci] === true;
    });
  const hasRemoved = (rowStyles, slots) =>
    slots.some((slot) => {
      const ci = map[slot];
      return ci !== undefined && rowStyles?.[ci] === true;
    });
  const getLineFlags = (rowLineStyles, slot) => {
    const ci = map[slot];
    return ci === undefined ? [] : rowLineStyles?.[ci] ?? [];
  };

  const events = [];
  let evt = null,
    cat = null,
    lastDoc = null;

  for (let i = dataStart; i < rows.length; i++) {
    const row = rows[i];
    const rowStyles = styleRows?.[i] ?? [];
    const rowRemovedStyles = removedStyleRows?.[i] ?? [];
    const rowLineStyles = lineStyleRows?.[i] ?? [];
    const eventIsHighlighted = hasNew(rowStyles, [0, 1, 2, 3, 4]);
    const eventInstructionsAreHighlighted = hasNew(rowStyles, [3, 4]);
    const categoryIsHighlighted = hasNew(rowStyles, [5, 6, 7, 12]);
    const documentIsHighlighted = hasNew(rowStyles, [8, 9, 10, 11]);
    const documentContinuationIsHighlighted = hasNew(rowStyles, [9, 10]);
    const eventIsRemoved = hasRemoved(rowRemovedStyles, [0, 1, 2, 3, 4]);
    const categoryIsRemoved = hasRemoved(rowRemovedStyles, [5, 6, 7, 12]);
    const documentIsRemoved = hasRemoved(rowRemovedStyles, [8, 9, 10, 11]);
    const evEnum = g(row, 0),
      evEn = g(row, 1),
      evEs = g(row, 2),
      whatEn = g(row, 3),
      whatEs = g(row, 4);
    const catEnum = g(row, 5),
      catEn = g(row, 6),
      catEs = g(row, 7);
    const docEnum = g(row, 8),
      docEn = g(row, 9),
      docEs = g(row, 10);
    const sortN = gv(row, 11),
      valRule = g(row, 12);

    if (evEnum && evEn) {
      const enums = splitEnums(evEnum),
        en = splitLabels(evEn),
        es = splitLabels(evEs ?? '');
      let eventFlags = buildSplitNewFlags(enums.length, eventIsHighlighted && !eventIsRemoved);
      const enumLineFlags = getLineFlags(rowLineStyles, 0);
      const englishLineFlags = getLineFlags(rowLineStyles, 1);
      const spanishLineFlags = getLineFlags(rowLineStyles, 2);
      if (
        enums.length > 1 &&
        (enumLineFlags.length > 0 ||
          englishLineFlags.length > 0 ||
          spanishLineFlags.length > 0)
      ) {
        const itemFlags = enums.map(
          (_, index) =>
            !eventIsRemoved &&
            (Boolean(enumLineFlags[index]) ||
              Boolean(englishLineFlags[index]) ||
              Boolean(spanishLineFlags[index])),
        );
        const allNew = itemFlags.every(Boolean);
        eventFlags = {
          rowIsNew: eventInstructionsAreHighlighted || allNew,
          itemFlags,
        };
      }
      evt = {
        enumRows: enums.map((e, i) => ({
          enum: e,
          en: en[i] ?? en[en.length - 1] ?? '',
          es: es[i] ?? es[es.length - 1] ?? '',
          isNew: eventFlags.itemFlags[i] ?? false,
        })),
        what: whatEn ?? '',
        whatEs: whatEs ?? '',
        categories: [],
        rowIsNew: eventFlags.rowIsNew,
        isRemoved: eventIsRemoved,
      };
      events.push(evt);
      cat = null;
      lastDoc = null;
    }
    if (catEnum && evt) {
      cat = {
        enum: catEnum,
        en: catEn ?? '',
        es: catEs ?? '',
        validation: valRule ?? '',
        documents: [],
        isRemoved: evt.isRemoved || categoryIsRemoved,
        isNew: categoryIsHighlighted && !(evt.isRemoved || categoryIsRemoved),
      };
      evt.categories.push(cat);
      lastDoc = null;
    }
    if (docEnum && cat) {
      const parsedDocs = splitDocs(docEnum, docEn, docEs, sortN);
      const docFlags =
        evt?.rowIsNew || cat.isNew
          ? promoteAllFlags(buildSplitNewFlags(parsedDocs.length, documentIsHighlighted && !documentIsRemoved))
          : buildSplitNewFlags(parsedDocs.length, documentIsHighlighted && !documentIsRemoved);
      const docs = parsedDocs.map((doc, index) => ({
        ...doc,
        isRemoved: Boolean(evt?.isRemoved || cat?.isRemoved || documentIsRemoved),
        isNew:
          (docFlags.itemFlags[index] ?? false) &&
          !Boolean(evt?.isRemoved || cat?.isRemoved || documentIsRemoved),
      }));
      cat.documents.push(...docs);
      lastDoc = docs[docs.length - 1] ?? lastDoc;
    } else if (!docEnum && cat && lastDoc && (docEn || docEs)) {
      if (docEn) lastDoc.en = lastDoc.en ? `${lastDoc.en}\n${docEn}` : docEn;
      if (docEs) lastDoc.es = lastDoc.es ? `${lastDoc.es}\n${docEs}` : docEs;
      if (documentContinuationIsHighlighted) lastDoc.isNew = true;
      if (documentIsRemoved) lastDoc.isRemoved = true;
    }
  }
  return normalizeDocumentSorts(events);
}

// ════════════════════════════════════════════════════════════════════
// WRITER  (uses ExcelJS for styled output)
// ════════════════════════════════════════════════════════════════════
function write(ws, events, newNums) {
  ws.properties.showGridLines = false;
  ws.getColumn('A').width = CA;
  ws.getColumn('B').width = CB;
  ws.getColumn('C').width = CC;
  ws.getColumn('D').width = CD;
  ws.getColumn('E').width = CE;
  ws.getColumn('F').width = CF;

  // Title
  ws.mergeCells('A1:F1');
  cs(ws.getCell('A1'), 'Configuration & Validation Rules', {
    fc: 'FFFFFFFF',
    bg: C.EVENT,
    bold: true,
    sz: 14,
    ha: 'center',
  });
  ws.getRow(1).height = 30;

  // Warning banner
  ws.mergeCells('A2:F2');
  cs(
    ws.getCell('A2'),
    '⚠  GetInsured: Do NOT change Group Labels in the system. Edits to categories, documents & validation rules are permitted.',
    { fc: C.WARN_FC, bg: C.VAL, bold: true, sz: 9 },
  );
  ws.getRow(2).height = 22;

  // Column headers
  [
    'Field',
    'Enum',
    'English Label',
    'Spanish Label',
    'Validation Rules',
    '#',
  ].forEach((v, i) => {
    const cell = ws.getCell(3, i + 1);
    cell.value = v;
    cell.font = {
      name: FONT,
      bold: true,
      size: 9,
      color: { argb: 'FFFFFFFF' },
    };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.HDR } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FF5B9BD5' } },
      bottom: { style: 'thin', color: { argb: 'FF5B9BD5' } },
      left: { style: 'thin', color: { argb: 'FF5B9BD5' } },
      right: { style: 'thin', color: { argb: 'FF5B9BD5' } },
    };
  });
  ws.getRow(3).height = 22;
  ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 3 }];

  let r = 4;

  for (let gi = 0; gi < events.length; gi++) {
    const g = events[gi],
      idx = gi + 1,
      isN = newNums.includes(idx),
      eventIsRemoved = Boolean(g.isRemoved),
      eventRowIsNew = isN || (g.rowIsNew && g.enumRows.length <= 1);
    const eventP = {
      hBg: eventIsRemoved ? C.REMOVED_BG : eventRowIsNew ? C.NEW_BG : C.EVENT,
      hFc: eventIsRemoved ? C.REMOVED_FC : eventRowIsNew ? C.NEW_FC : 'FFFFFFFF',
      kBg: eventIsRemoved ? C.REMOVED_BG : eventRowIsNew ? C.NEW_KEY : C.EVKEY,
      lBg: eventIsRemoved ? C.REMOVED_BG : eventRowIsNew ? C.NEW_BG : C.EVLBL,
      lFc: eventIsRemoved ? C.REMOVED_FC : eventRowIsNew ? C.NEW_FC : 'FF1F3864',
      esFc: eventIsRemoved ? C.REMOVED_FC : eventRowIsNew ? C.NEW_FC : 'FF595959',
      enBg: eventIsRemoved ? C.REMOVED_BG : eventRowIsNew ? C.NEW_ENUM : C.ENUM,
      enFc: eventIsRemoved ? C.REMOVED_FC : eventRowIsNew ? C.NEW_FC : 'FF1A3A1A',
      iBg: eventIsRemoved ? C.REMOVED_BG : eventRowIsNew ? C.NEW_INST : C.INST,
      iFc: eventIsRemoved ? C.REMOVED_FC : eventRowIsNew ? C.NEW_FC : 'FF1F3864',
      strike: eventIsRemoved,
    };
    const rowPalette = (rowIsNew, rowIsRemoved = false) => ({
      cBg: rowIsRemoved ? C.REMOVED_BG : rowIsNew ? C.NEW_BG : C.CAT,
      cFc: rowIsRemoved ? C.REMOVED_FC : rowIsNew ? C.NEW_FC : 'FFFFFFFF',
      dBg: rowIsRemoved ? C.REMOVED_BG : rowIsNew ? C.NEW_ENUM : C.ENUM,
      dFc: rowIsRemoved ? C.REMOVED_FC : rowIsNew ? C.NEW_FC : 'FF375623',
      docBg: rowIsRemoved ? C.REMOVED_BG : rowIsNew ? C.NEW_BG : null,
      docFc: rowIsRemoved ? C.REMOVED_FC : rowIsNew ? C.NEW_FC : 'FF000000',
      docEsFc: rowIsRemoved ? C.REMOVED_FC : rowIsNew ? C.NEW_FC : 'FF595959',
      docLabelFc: rowIsRemoved ? C.REMOVED_FC : rowIsNew ? C.NEW_FC : 'FF2F5496',
      docSortFc: rowIsRemoved ? C.REMOVED_FC : rowIsNew ? C.NEW_FC : 'FF2F5496',
      valBg: rowIsRemoved ? C.REMOVED_BG : rowIsNew ? C.NEW_INST : C.VAL_RBG,
      valFc: rowIsRemoved ? C.REMOVED_FC : rowIsNew ? C.NEW_FC : C.VAL_RFC,
      strike: rowIsRemoved,
    });

    // Event group banner
    ws.mergeCells(`A${r}:F${r}`);
    cs(
      ws.getCell(r, 1),
      `Event Group ${idx}${eventRowIsNew ? '  ★ NEW — Yet to be implemented' : ''}`,
      { fc: eventP.hFc, bg: eventP.hBg, bold: true, strike: eventP.strike, sz: 10 },
    );
    ws.getRow(r).height = 22;
    r++;

    // Enum rows
    for (const er of g.enumRows) {
      const enumRowIsNew = isN || er.isNew || (g.rowIsNew && g.enumRows.length <= 1);
      const enumRowIsRemoved = eventIsRemoved || Boolean(er.isRemoved);
      const enumP = {
        kBg: enumRowIsRemoved ? C.REMOVED_BG : enumRowIsNew ? C.NEW_KEY : C.EVKEY,
        lBg: enumRowIsRemoved ? C.REMOVED_BG : enumRowIsNew ? C.NEW_BG : C.EVLBL,
        lFc: enumRowIsRemoved ? C.REMOVED_FC : enumRowIsNew ? C.NEW_FC : 'FF1F3864',
        esFc: enumRowIsRemoved ? C.REMOVED_FC : enumRowIsNew ? C.NEW_FC : 'FF595959',
        enBg: enumRowIsRemoved ? C.REMOVED_BG : enumRowIsNew ? C.NEW_ENUM : C.ENUM,
        enFc: enumRowIsRemoved ? C.REMOVED_FC : enumRowIsNew ? C.NEW_FC : 'FF1A3A1A',
        strike: enumRowIsRemoved,
      };
      cs(ws.getCell(r, 1), 'Enum', {
        fc: enumRowIsRemoved ? C.REMOVED_FC : 'FFFFFFFF',
        bg: enumP.kBg,
        bold: true,
        strike: enumP.strike,
        sz: 8,
        ha: 'right',
      });
      cs(ws.getCell(r, 2), er.enum, {
        fc: enumP.enFc,
        bg: enumP.enBg,
        bold: true,
        strike: enumP.strike,
        sz: 9,
        mono: true,
      });
      cs(ws.getCell(r, 3), er.en, { fc: enumP.lFc, bg: enumP.lBg, strike: enumP.strike, sz: 9 });
      cs(ws.getCell(r, 4), er.es, { fc: enumP.esFc, bg: enumP.lBg, strike: enumP.strike, sz: 8 });
      cs(ws.getCell(r, 5), '', { bg: enumP.lBg, strike: enumP.strike });
      cs(ws.getCell(r, 6), '', { bg: enumP.lBg, strike: enumP.strike });
      ws.getRow(r).height = maxH(
        autoH(er.enum, CB, 9, 18),
        autoH(er.en, CC, 9, 18),
        autoH(er.es, CD, 8, 18),
      );
      r++;
    }

    // Instructions (EN + ES)
    if (g.what || g.whatEs) {
      cs(ws.getCell(r, 1), 'Instructions', {
        fc: 'FFFFFFFF',
        bg: eventP.kBg,
        bold: true,
        strike: eventP.strike,
        sz: 8,
        ha: 'right',
      });
      cs(ws.getCell(r, 2), '', { bg: eventP.iBg, strike: eventP.strike });
      cs(ws.getCell(r, 3), g.what, {
        fc: eventP.iFc,
        bg: eventP.iBg,
        strike: eventP.strike,
        sz: 8,
        va: 'top',
      });
      cs(ws.getCell(r, 4), g.whatEs, {
        fc: eventP.esFc,
        bg: eventP.iBg,
        strike: eventP.strike,
        sz: 8,
        va: 'top',
      });
      cs(ws.getCell(r, 5), '', { bg: eventP.iBg, strike: eventP.strike });
      cs(ws.getCell(r, 6), '', { bg: eventP.iBg, strike: eventP.strike });
      ws.getRow(r).height = maxH(
        autoH(g.what, CC, 8, 30),
        autoH(g.whatEs, CD, 8, 30),
      );
      r++;
    }

    // Categories
    for (const cat of g.categories) {
      const catIsNew = isN || cat.isNew;
      const catIsRemoved = eventIsRemoved || Boolean(cat.isRemoved);
      const catP = rowPalette(catIsNew, catIsRemoved);
      cs(ws.getCell(r, 1), 'CATEGORY', {
        fc: catP.cFc,
        bg: catP.cBg,
        bold: true,
        strike: catP.strike,
        sz: 8,
        ha: 'center',
      });
      cs(ws.getCell(r, 2), cat.enum, {
        fc: catP.cFc,
        bg: catP.cBg,
        bold: true,
        strike: catP.strike,
        sz: 9,
        mono: true,
      });
      cs(ws.getCell(r, 3), cat.en, {
        fc: catP.cFc,
        bg: catP.cBg,
        bold: true,
        strike: catP.strike,
        sz: 9,
      });
      cs(ws.getCell(r, 4), cat.es, { fc: catP.cFc, bg: catP.cBg, strike: catP.strike, sz: 8 });
      cs(ws.getCell(r, 5), cat.validation, {
        fc: catP.valFc,
        bg: catP.valBg,
        strike: catP.strike,
        sz: 8,
        mono: true,
        va: 'top',
      });
      cs(ws.getCell(r, 6), '', { fc: catP.cFc, bg: catP.cBg, strike: catP.strike });
      ws.getRow(r).height = maxH(
        autoH(cat.enum, CB, 9, 22),
        autoH(cat.en, CC, 9, 22),
        autoH(cat.es, CD, 8, 22),
        autoH(cat.validation, CE, 8, 22),
      );
      r++;

      // Doc mini-header
      [
        '',
        'Document Enum',
        'English Label / Text',
        'Spanish Label / Text',
        'Validation Rules',
        '#',
      ].forEach((v, i) => {
        const cell = ws.getCell(r, i + 1);
        cell.value = v;
        cell.font = {
          name: FONT,
          bold: true,
          size: 7,
          color: { argb: 'FFFFFFFF' },
        };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: C.HDR_DOC },
        };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        docBdr(cell);
      });
      ws.getRow(r).height = 15;
      r++;

      // Doc rows
      cat.documents.forEach((doc, di) => {
        const docIsNew = isN || doc.isNew;
        const docIsRemoved = catIsRemoved || Boolean(doc.isRemoved);
        const docP = rowPalette(docIsNew, docIsRemoved);
        const bg = docP.docBg ?? (di % 2 === 1 ? C.ALT : C.WHITE);
        cs(ws.getCell(r, 1), 'DOC', {
          fc: docP.docLabelFc,
          bg,
          strike: docP.strike,
          sz: 7,
          ha: 'center',
        });
        cs(ws.getCell(r, 2), doc.enum, {
          fc: docP.dFc,
          bg: docP.dBg,
          bold: true,
          strike: docP.strike,
          sz: 8,
          mono: true,
        });
        cs(ws.getCell(r, 3), doc.en, {
          fc: docP.docFc,
          bg,
          strike: docP.strike,
          sz: 9,
          va: 'top',
        });
        cs(ws.getCell(r, 4), doc.es, {
          fc: docP.docEsFc,
          bg,
          strike: docP.strike,
          sz: 8,
          va: 'top',
        });
        cs(ws.getCell(r, 5), '', { bg, strike: docP.strike });
        cs(ws.getCell(r, 6), doc.sort, {
          fc: docP.docSortFc,
          bg,
          bold: true,
          strike: docP.strike,
          sz: 9,
          ha: 'center',
        });
        ws.getRow(r).height = maxH(
          autoH(doc.enum, CB, 8, 16),
          autoH(doc.en, CC, 9, 16),
          autoH(doc.es, CD, 8, 16),
        );
        r++;
      });
    }

    // Spacer
    for (let ci = 1; ci <= 6; ci++) {
      const cell = ws.getCell(r, ci);
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: C.SPACER },
      };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFD9D9D9' } },
        bottom: { style: 'thin', color: { argb: 'FFD9D9D9' } },
        left: { style: 'thin', color: { argb: 'FFD9D9D9' } },
        right: { style: 'thin', color: { argb: 'FFD9D9D9' } },
      };
    }
    ws.getRow(r).height = 8;
    r++;
  }
}

async function loadEvents(absInput, ExcelJS) {
  console.log(`  ${T.grey}Reading file...${T.reset}`);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(absInput, READ_XLSX_OPTS);
  const name = findSheetName(wb);
  const ws = wb.getWorksheet(name);
  const { rows, styleRows, removedStyleRows, lineStyleRows } = buildInputRows(ws);
  console.log(`  ${T.grey}Sheet: "${name}"${T.reset}`);

  return parseSheet(rows, styleRows, removedStyleRows, lineStyleRows);
}

function applyNewFlags(events, manualNums) {
  const manualNew = new Set(manualNums);
  const finalNewNums = [];
  events.forEach((event, i) => {
    const idx = i + 1;
    event.isManualNew = manualNew.has(idx);
    event.hasAutoNew = event.rowIsNew;
    event.isNew = event.isManualNew || event.rowIsNew;
    if (event.isNew) finalNewNums.push(idx);
  });
  return finalNewNums;
}

function printList(events) {
  console.log(`\n${T.bold}Found ${events.length} event group(s):\n${T.reset}`);
  events.forEach((g, i) => {
    let tag = '';
    if (g.hasAutoNew && g.isManualNew) tag = ` ${T.yellow}★ NEW${T.reset}`;
    else if (g.hasAutoNew) tag = ` ${T.yellow}★ NEW (auto)${T.reset}`;
    else if (g.isManualNew) tag = ` ${T.yellow}★ NEW (manual)${T.reset}`;
    console.log(`  ${T.cyan}Group ${i + 1}${T.reset}${tag}`);
    g.enumRows.forEach((er) =>
      console.log(`    ${T.grey}${er.enum}${T.reset}  ${er.en}`),
    );
    g.categories.forEach((cat) =>
      console.log(
        `    ${T.green}▸ ${cat.enum}${T.reset}  (${cat.documents.length} docs)`,
      ),
    );
    console.log();
  });
}

async function processWorkbook(absInput, outputPath, manualNums, listOnly, ExcelJS) {
  console.log('─'.repeat(52));
  console.log(`${T.bold}Processing...${T.reset}`);
  console.log(`  ${T.grey}File: ${absInput}${T.reset}`);

  const events = await loadEvents(absInput, ExcelJS);
  const finalNewNums = applyNewFlags(events, manualNums);

  if (listOnly) {
    printList(events);
    return { absInput, outputPath: null, events, finalNewNums };
  }

  console.log(`  ${T.grey}Writing formatted output...${T.reset}`);
  const wbOut = new ExcelJS.Workbook();
  write(wbOut.addWorksheet('Config & Validation Rules'), events, finalNewNums);
  await wbOut.xlsx.writeFile(outputPath);

  console.log(`\n${T.bold}Summary${T.reset}`);
  console.log(`  Event Groups : ${T.cyan}${events.length}${T.reset}`);
  console.log(
    `  Enums  : ${T.cyan}${events.reduce((a, g) => a + g.enumRows.length, 0)}${T.reset}`,
  );
  console.log(
    `  Docs   : ${T.cyan}${events.reduce((a, g) => a + g.categories.reduce((b, c) => b + c.documents.length, 0), 0)}${T.reset}`,
  );
  if (finalNewNums.length > 0)
    console.log(`  NEW    : ${T.yellow}Groups ${finalNewNums.join(', ')}${T.reset}`);
  console.log(`\n${T.green}${T.bold}✓ Done!${T.reset}`);
  console.log(`${T.green}  Saved → ${outputPath}${T.reset}\n`);

  return { absInput, outputPath, events, finalNewNums };
}

// ════════════════════════════════════════════════════════════════════
// MAIN
// ════════════════════════════════════════════════════════════════════
async function main() {
  const {
    newNums: presetNew,
    listOnly,
    showHelp,
    inputPath: cliInput,
    outputPath: cliOutput,
    batchDir: cliBatchDir,
  } = parseArgs();

  if (showHelp) {
    console.log(
      `\n${T.bold}${T.cyan}QLE / SEP Config Formatter${T.reset}\n\n${T.bold}USAGE${T.reset}\n  node qle-formatter.js\n  node qle-formatter.js --input ./state.xlsx\n  node qle-formatter.js --input ./state.xlsx --output ./state_formatted.xlsx\n  node qle-formatter.js --batch-dir ./sample-documents\n  node qle-formatter.js --new 10\n  node qle-formatter.js --new 3,7,10\n  node qle-formatter.js --list\n  node qle-formatter.js --help\n\n${T.bold}NOTES${T.reset}\n  Auto-detects NEW items from red text in the source workbook.\n  --new manually adds NEW events on top of auto-detection.\n  --batch-dir processes all .xlsx files recursively, skipping temp and already formatted files.\n`,
    );
    return;
  }

  ensureDeps();

  const ExcelJS = require(path.join(DEPS_DIR, 'node_modules', 'exceljs'));

  console.log(
    `\n${T.bold}${T.cyan}╔══════════════════════════════════════════════════╗\n║        QLE / SEP Config Formatter  v1.1          ║\n║  Formats any state's spec sheet into a clean     ║\n║  hierarchical Excel reference for developers     ║\n╚══════════════════════════════════════════════════╝${T.reset}\n`,
  );

  if (cliBatchDir) {
    const absBatchDir = path.resolve(cleanPath(cliBatchDir));
    if (!fs.existsSync(absBatchDir) || !fs.statSync(absBatchDir).isDirectory()) {
      throw new Error(`Batch directory not found: ${absBatchDir}`);
    }

    const files = collectWorkbooks(absBatchDir);
    if (files.length === 0) {
      console.log(`${T.yellow}No matching .xlsx files found in ${absBatchDir}${T.reset}`);
      return;
    }

    console.log(
      `${T.bold}Batch mode${T.reset}\n${T.grey}Processing ${files.length} workbook(s) under ${absBatchDir}.${T.reset}\n`,
    );

    const failures = [];
    for (const file of files) {
      const out = path.join(
        path.dirname(file),
        `${path.basename(file, '.xlsx')}_formatted.xlsx`,
      );
      try {
        await processWorkbook(file, out, presetNew, listOnly, ExcelJS);
      } catch (err) {
        failures.push({ file, error: err.message });
        console.error(`${T.red}✗ Failed: ${file}${T.reset}`);
        console.error(`  ${T.grey}${err.message}${T.reset}\n`);
      }
    }

    if (failures.length > 0) {
      console.log(`${T.yellow}${T.bold}Batch finished with ${failures.length} failure(s).${T.reset}`);
      failures.forEach((f) => console.log(`  ${T.red}${f.file}${T.reset} — ${f.error}`));
      process.exitCode = 1;
      return;
    }

    console.log(`${T.green}${T.bold}Batch complete.${T.reset}`);
    return;
  }

  if (cliInput) {
    const absInput = path.resolve(cleanPath(cliInput));
    if (!fs.existsSync(absInput)) throw new Error(`File not found: ${absInput}`);
    const outputPath = listOnly
      ? null
      : cliOutput
        ? path.resolve(cleanPath(cliOutput))
        : path.join(
            path.dirname(absInput),
            `${path.basename(absInput, '.xlsx')}_formatted.xlsx`,
          );
    await processWorkbook(absInput, outputPath, presetNew, listOnly, ExcelJS);
    return;
  }

  // ── Step 1: file ───────────────────────────────────────────────
  console.log(`${T.bold}Step 1 of 3 — Select your Excel file${T.reset}`);
  console.log(
    `${T.grey}Drag and drop the .xlsx file into this window, or type the full path.${T.reset}\n`,
  );

  let absInput = '';
  while (true) {
    const raw = await ask(`${T.cyan}📂 Drop file here:${T.reset} `);
    const resolved = cleanPath(raw);
    if (!resolved) {
      console.log(`${T.red}No path entered — please try again.\n${T.reset}`);
      continue;
    }
    absInput = path.resolve(resolved);
    if (!fs.existsSync(absInput)) {
      console.log(`${T.red}✗ File not found: ${absInput}\n${T.reset}`);
      continue;
    }
    if (!absInput.toLowerCase().endsWith('.xlsx')) {
      const c = await ask(
        `${T.yellow}⚠  Not an .xlsx file — continue anyway? (y/n):${T.reset} `,
      );
      if (!c.toLowerCase().startsWith('y')) {
        console.log();
        continue;
      }
    }
    break;
  }
  console.log(`${T.green}✓ File: ${absInput}${T.reset}\n`);

  // ── Step 2: NEW events ─────────────────────────────────────────
  let newNums = presetNew;
  console.log(`${T.bold}Step 2 of 3 — Mark NEW events (optional)${T.reset}`);
  if (newNums.length > 0) {
    console.log(
      `${T.yellow}✓ Pre-set NEW events: ${newNums.join(', ')}${T.reset}\n`,
    );
  } else {
    console.log(
      `${T.grey}Enter comma-separated event numbers to highlight as NEW.\nPress Enter to skip.\n${T.reset}`,
    );
    const raw = await ask(
      `${T.cyan}NEW event numbers (e.g. 10 or 3,7,10):${T.reset} `,
    );
    newNums = raw
      .split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n) && n > 0);
    console.log(
      newNums.length > 0
        ? `${T.yellow}✓ Will highlight Groups: ${newNums.join(', ')}${T.reset}\n`
        : `${T.grey}  Skipped.\n${T.reset}`,
    );
  }

  // ── Step 3: output path ────────────────────────────────────────
  const defaultOut = path.join(
    path.dirname(absInput),
    `${path.basename(absInput, '.xlsx')}_formatted.xlsx`,
  );
  let outputPath = defaultOut;

  if (!listOnly) {
    console.log(`${T.bold}Step 3 of 3 — Output file${T.reset}`);
    console.log(
      `${T.grey}Press Enter to save as:${T.reset} ${T.dim}${defaultOut}${T.reset}`,
    );
    console.log(`${T.grey}Or type a different path.\n${T.reset}`);
    const outRaw = await ask(`${T.cyan}Output path:${T.reset} `);
    if (outRaw) outputPath = path.resolve(cleanPath(outRaw));
    console.log(`${T.green}✓ Output: ${outputPath}${T.reset}\n`);
  }

  // ── Process ────────────────────────────────────────────────────
  console.log('─'.repeat(52));
  await processWorkbook(absInput, outputPath, newNums, listOnly, ExcelJS);
}

main().catch((err) => {
  console.error(`\n${T.red}✗ Error: ${err.message}${T.reset}`);
  process.exit(1);
});
