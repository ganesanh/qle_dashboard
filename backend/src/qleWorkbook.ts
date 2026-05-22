import ExcelJS from 'exceljs';
import { randomUUID } from 'node:crypto';
import type {
  DiffEntry,
  DiffSummary,
  QleCategory,
  QleDocument,
  QleEnumRow,
  QleEvent,
  QleFieldStateMap,
  QleValidationItem,
  QleWorkbookModel,
} from '../../shared/types.js';

type ValidationItemFieldFlags = {
  key: { isNew?: boolean; isRemoved?: boolean };
  value: { isNew?: boolean; isRemoved?: boolean };
};

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

const COLORS = {
  event: 'FF1F4E79',
  eventKey: 'FF2E4057',
  eventLabel: 'FFD6E4F0',
  category: 'FF2E75B6',
  enumBg: 'FFE2EFDA',
  instructions: 'FFEAF2FB',
  alt: 'FFEBF3FA',
  white: 'FFFFFFFF',
  spacer: 'FFE7E6E6',
  header: 'FF2F5496',
  headerDoc: 'FF5B9BD5',
  validationBg: 'FFD9E8D4',
  validationFg: 'FF1E4620',
  removedBg: 'FFFFFF00',
  removedFg: 'FFC00000',
};

function normalise(text: unknown): string {
  return String(text ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function splitEnums(text: string | null): string[] {
  return text
    ? normalise(text)
        .split(/[\n,]+/)
        .map((part) => part.trim())
        .filter(Boolean)
    : [];
}

function splitLabels(text: string | null): string[] {
  return text
    ? normalise(text)
        .split('\n')
        .map((part) => part.trim())
        .filter(Boolean)
    : [];
}

function splitBulletLabels(text: string | null): string[] {
  if (!text) return [];
  const normalized = normalise(text).trim();
  if (!normalized.includes('•')) return [];
  return normalized
    .split(/(?=•)/g)
    .map((part) => part.trim())
    .filter(Boolean);
}

function splitDocumentLabelCandidates(text: string | null): string[] {
  const bullets = splitBulletLabels(text);
  if (bullets.length > 0) return bullets;
  return splitLabels(text);
}

function splitDocs(
  enumRaw: string | null,
  enRaw: string | null,
  esRaw: string | null,
  sortValue: unknown,
): Array<Pick<QleDocument, 'enum' | 'en' | 'es' | 'sort'>> {
  const enums = splitEnums(enumRaw);
  const enBullets = splitBulletLabels(enRaw);
  const esBullets = splitBulletLabels(esRaw);
  const en = enBullets.length === enums.length ? enBullets : splitLabels(enRaw);
  const es = esBullets.length === enums.length ? esBullets : splitLabels(esRaw);
  return enums.map((docEnum, index) => ({
    enum: docEnum,
    en: en[index] ?? en[en.length - 1] ?? '',
    es: es[index] ?? es[es.length - 1] ?? '',
    sort: enums.length > 1 ? index + 1 : Number(sortValue ?? index + 1) || index + 1,
  }));
}

function splitValidationLines(text: string | null): string[] {
  return text
    ? normalise(text)
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
    : [];
}

function serializeValidationItems(items: QleValidationItem[]): string {
  return items
    .map((item) => `${item.key.trim()}: ${item.value.trim()}`.trim())
    .filter(Boolean)
    .join('\n');
}

function buildFieldStates(
  entries: Record<string, { isNew?: boolean; isRemoved?: boolean }>,
): QleFieldStateMap {
  return Object.fromEntries(
    Object.entries(entries).map(([key, state]) => [
      key,
      {
        isNew: Boolean(state.isNew) && !Boolean(state.isRemoved),
        manualIsNew: null,
        isRemoved: Boolean(state.isRemoved),
      },
    ]),
  );
}

function parseValidationItems(
  text: string | null,
  lineNewFlags: boolean[] = [],
  lineRemovedFlags: boolean[] = [],
  fieldFlags: ValidationItemFieldFlags[] = [],
): QleValidationItem[] {
  return splitValidationLines(text).map((line, index) => {
    const separatorIndex = line.indexOf(':');
    const hasSeparator = separatorIndex >= 0;
    const key = hasSeparator ? line.slice(0, separatorIndex).trim() : line.trim();
    const value = hasSeparator ? line.slice(separatorIndex + 1).trim() : '';
    const lineFieldFlags = fieldFlags[index];
    const keyFlags = lineFieldFlags?.key ?? {
      isNew: lineNewFlags[index],
      isRemoved: lineRemovedFlags[index],
    };
    const valueFlags = lineFieldFlags?.value ?? {
      isNew: lineNewFlags[index],
      isRemoved: lineRemovedFlags[index],
    };
    const lineIsRemoved = Boolean(keyFlags.isRemoved) && Boolean(valueFlags.isRemoved);
    const lineIsNew = !lineIsRemoved && Boolean(keyFlags.isNew) && Boolean(valueFlags.isNew);
    return {
      id: randomUUID(),
      key,
      value,
      fieldStates: buildFieldStates({
        key: keyFlags,
        value: valueFlags,
      }),
      isNew: lineIsNew,
      manualIsNew: null,
      isRemoved: lineIsRemoved,
    };
  });
}

function validationItemFieldStyle(
  item: QleValidationItem,
  fieldKey: 'key' | 'value',
): { isNew: boolean; isRemoved: boolean } {
  const fieldState = item.fieldStates?.[fieldKey];
  const isRemoved = Boolean(item.isRemoved) || Boolean(fieldState?.isRemoved);
  const isNew = !isRemoved && (Boolean(item.isNew) || Boolean(fieldState?.isNew));
  return { isNew, isRemoved };
}

function validationItemHasNew(item: QleValidationItem): boolean {
  return validationItemFieldStyle(item, 'key').isNew || validationItemFieldStyle(item, 'value').isNew;
}

function validationItemHasRemoved(item: QleValidationItem): boolean {
  return (
    validationItemFieldStyle(item, 'key').isRemoved ||
    validationItemFieldStyle(item, 'value').isRemoved
  );
}

function buildSplitNewFlags(count: number, rowHasHighlight: boolean): {
  rowIsNew: boolean;
  itemFlags: boolean[];
} {
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

function promoteAllFlags(flags: { rowIsNew: boolean; itemFlags: boolean[] }): {
  rowIsNew: boolean;
  itemFlags: boolean[];
} {
  if (!flags.rowIsNew && !flags.itemFlags.some(Boolean)) return flags;
  return {
    rowIsNew: flags.rowIsNew,
    itemFlags: flags.itemFlags.map(() => true),
  };
}

function normalizeDocumentSorts(events: QleEvent[]): QleEvent[] {
  events.forEach((event) => {
    event.categories.forEach((category) => {
      const firstDocument = category.documents[0];
      if (firstDocument && category.documents.length > 1) {
        const enCandidates = splitDocumentLabelCandidates(firstDocument.en);
        const esCandidates = splitDocumentLabelCandidates(firstDocument.es);
        const blankFollowingEn = category.documents.slice(1).every((document) => !document.en.trim());
        const blankFollowingEs = category.documents.slice(1).every((document) => !document.es.trim());

        if (blankFollowingEn && enCandidates.length === category.documents.length) {
          category.documents.forEach((document, index) => {
            document.en = enCandidates[index] ?? document.en;
          });
        }

        if (blankFollowingEs && esCandidates.length === category.documents.length) {
          category.documents.forEach((document, index) => {
            document.es = esCandidates[index] ?? document.es;
          });
        }
      }

      category.documents.forEach((document, index) => {
        document.sort = index + 1;
      });
    });
  });
  return events;
}

function findSheetName(workbook: ExcelJS.Workbook): string {
  const names = workbook.worksheets.map((worksheet) => worksheet.name);
  for (const preferred of [
    'Configuration & Validation Rules',
    'Configuration and Validation Ru',
    'QLE_Documents',
    'QLE Documents',
  ]) {
    if (names.includes(preferred)) return preferred;
  }
  return (
    names.find(
      (name) =>
        name.toLowerCase().startsWith('configuration') ||
        name.toLowerCase().startsWith('qle'),
    ) ?? names[0]
  );
}

function getCellText(cell: ExcelJS.Cell): string | null {
  if (cell.value == null) return null;
  if (typeof cell.value === 'object' && 'richText' in cell.value) {
    const text = cell.value.richText.map((part) => part.text ?? '').join('');
    return text.trim() || null;
  }
  const text = `${cell.text ?? ''}`.trim();
  return text || null;
}

function getConcreteArgb(color: Partial<ExcelJS.Color> | undefined): string | null {
  const raw = typeof color?.argb === 'string' ? color.argb.trim() : '';
  if (!raw) return null;
  const hex = raw.replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
  if (hex.length === 8) return hex;
  if (hex.length === 6) return `FF${hex}`;
  return null;
}

function isRedArgb(argb: string | null): boolean {
  if (!argb) return false;
  const rgb = argb.slice(-6);
  const r = parseInt(rgb.slice(0, 2), 16);
  const g = parseInt(rgb.slice(2, 4), 16);
  const b = parseInt(rgb.slice(4, 6), 16);
  return r >= 170 && g <= 130 && b <= 130;
}

function isYellowArgb(argb: string | null): boolean {
  if (!argb) return false;
  const rgb = argb.slice(-6);
  const r = parseInt(rgb.slice(0, 2), 16);
  const g = parseInt(rgb.slice(2, 4), 16);
  const b = parseInt(rgb.slice(4, 6), 16);
  return r >= 235 && g >= 210 && b <= 120;
}

function cellHasStrike(cell: ExcelJS.Cell): boolean {
  if (cell.font?.strike) return true;
  if (
    typeof cell.value === 'object' &&
    cell.value !== null &&
    'richText' in cell.value &&
    Array.isArray(cell.value.richText)
  ) {
    return cell.value.richText.some((part) => Boolean(part.font?.strike));
  }
  return false;
}

function cellSignalsNew(cell: ExcelJS.Cell): boolean {
  if (
    typeof cell.value === 'object' &&
    cell.value !== null &&
    'richText' in cell.value &&
    Array.isArray(cell.value.richText)
  ) {
    const hasRedRichText = cell.value.richText.some((part) =>
      isRedArgb(getConcreteArgb(part.font?.color)),
    );
    if (hasRedRichText) return true;
  }

  const fontArgb = getConcreteArgb(cell.font?.color);
  return isRedArgb(fontArgb);
}

function cellSignalsRemoved(cell: ExcelJS.Cell): boolean {
  const fill = cell.fill as Partial<ExcelJS.FillPattern> | undefined;
  const fillArgb = getConcreteArgb(fill?.fgColor) ?? getConcreteArgb(fill?.bgColor);
  return cellHasStrike(cell) && isYellowArgb(fillArgb);
}

function buildCellLineNewFlags(cell: ExcelJS.Cell): boolean[] {
  const pushLine = (flags: boolean[], text: string, isNew: boolean) => {
    if (text.trim()) flags.push(isNew);
  };

  if (
    typeof cell.value === 'object' &&
    cell.value !== null &&
    'richText' in cell.value &&
    Array.isArray(cell.value.richText)
  ) {
    const flags: boolean[] = [];
    let currentText = '';
    let currentIsNew = false;

    for (const part of cell.value.richText) {
      const text = part.text ?? '';
      const partIsNew = isRedArgb(getConcreteArgb(part.font?.color));
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

function buildCellLineRemovedFlags(cell: ExcelJS.Cell): boolean[] {
  const pushLine = (flags: boolean[], text: string, isRemoved: boolean) => {
    if (text.trim()) flags.push(isRemoved);
  };

  if (
    typeof cell.value === 'object' &&
    cell.value !== null &&
    'richText' in cell.value &&
    Array.isArray(cell.value.richText)
  ) {
    const flags: boolean[] = [];
    let currentText = '';
    let currentIsRemoved = false;

    for (const part of cell.value.richText) {
      const text = part.text ?? '';
      const partIsRemoved = Boolean(part.font?.strike);
      const segments = text.split('\n');

      segments.forEach((segment, index) => {
        if (segment) {
          currentText += segment;
          currentIsRemoved = currentIsRemoved || partIsRemoved;
        }
        if (index < segments.length - 1) {
          pushLine(flags, currentText, currentIsRemoved);
          currentText = '';
          currentIsRemoved = false;
        }
      });
    }

    pushLine(flags, currentText, currentIsRemoved);
    return flags;
  }

  const text = getCellText(cell);
  if (!text) return [];
  const splitCount = splitLabels(text).length;
  return Array.from({ length: splitCount }, () => cellSignalsRemoved(cell));
}

function buildValidationItemFieldFlags(cell: ExcelJS.Cell): ValidationItemFieldFlags[] {
  if (
    typeof cell.value === 'object' &&
    cell.value !== null &&
    'richText' in cell.value &&
    Array.isArray(cell.value.richText)
  ) {
    const lineSegments: Array<Array<{ text: string; isNew: boolean; isRemoved: boolean }>> = [];
    let currentLine: Array<{ text: string; isNew: boolean; isRemoved: boolean }> = [];

    const pushCurrentLine = () => {
      if (currentLine.map((segment) => segment.text).join('').trim()) {
        lineSegments.push(currentLine);
      }
      currentLine = [];
    };

    for (const part of cell.value.richText) {
      const text = part.text ?? '';
      const isRemoved = Boolean(part.font?.strike);
      const isNew = !isRemoved && isRedArgb(getConcreteArgb(part.font?.color));
      const segments = text.split('\n');

      segments.forEach((segment, index) => {
        if (segment) {
          currentLine.push({ text: segment, isNew, isRemoved });
        }
        if (index < segments.length - 1) {
          pushCurrentLine();
        }
      });
    }

    pushCurrentLine();

    return lineSegments.map((segments) => {
      const lineText = segments.map((segment) => segment.text).join('');
      const separatorIndex = lineText.indexOf(':');
      const key = { isNew: false, isRemoved: false };
      const value = { isNew: false, isRemoved: false };
      let cursor = 0;

      segments.forEach((segment) => {
        for (const _character of segment.text) {
          const target = separatorIndex >= 0 && cursor > separatorIndex ? value : key;
          if (segment.isRemoved) {
            target.isRemoved = true;
            target.isNew = false;
          } else if (segment.isNew) {
            target.isNew = true;
          }
          cursor += 1;
        }
      });

      return { key, value };
    });
  }

  const lineNewFlags = buildCellLineNewFlags(cell);
  const lineRemovedFlags = buildCellLineRemovedFlags(cell);
  return splitValidationLines(getCellText(cell)).map((_, index) => ({
    key: { isNew: lineNewFlags[index], isRemoved: lineRemovedFlags[index] },
    value: { isNew: lineNewFlags[index], isRemoved: lineRemovedFlags[index] },
  }));
}

function buildInputRows(worksheet: ExcelJS.Worksheet): {
  rows: Array<Array<string | null>>;
  styleRows: boolean[][];
  removedStyleRows: boolean[][];
  lineStyleRows: boolean[][][];
  lineRemovedRows: boolean[][][];
  validationFieldRows: ValidationItemFieldFlags[][][];
} {
  let maxCol = 0;
  worksheet.eachRow({ includeEmpty: false }, (row) => {
    row.eachCell({ includeEmpty: false }, (cell) => {
      const cellCol = Number(cell.col);
      if (cellCol > maxCol) maxCol = cellCol;
    });
  });

  const rows: Array<Array<string | null>> = [];
  const styleRows: boolean[][] = [];
  const removedStyleRows: boolean[][] = [];
  const lineStyleRows: boolean[][][] = [];
  const lineRemovedRows: boolean[][][] = [];
  const validationFieldRows: ValidationItemFieldFlags[][][] = [];

  for (let rowIndex = 1; rowIndex <= worksheet.rowCount; rowIndex++) {
    const row = worksheet.getRow(rowIndex);
    const values = Array<string | null>(maxCol).fill(null);
    const styles = Array<boolean>(maxCol).fill(false);
    const removedStyles = Array<boolean>(maxCol).fill(false);
    const lineStyles = Array.from({ length: maxCol }, () => [] as boolean[]);
    const lineRemoved = Array.from({ length: maxCol }, () => [] as boolean[]);
    const validationFields = Array.from({ length: maxCol }, () => [] as ValidationItemFieldFlags[]);

    for (let colIndex = 1; colIndex <= maxCol; colIndex++) {
      const cell = row.getCell(colIndex);
      const isMergedChild =
        cell.isMerged &&
        cell.master &&
        cell.master.address &&
        cell.master.address !== cell.address;
      values[colIndex - 1] = isMergedChild ? null : getCellText(cell);
      styles[colIndex - 1] = isMergedChild ? false : cellSignalsNew(cell);
      removedStyles[colIndex - 1] = isMergedChild ? false : cellSignalsRemoved(cell);
      lineStyles[colIndex - 1] = isMergedChild ? [] : buildCellLineNewFlags(cell);
      lineRemoved[colIndex - 1] = isMergedChild ? [] : buildCellLineRemovedFlags(cell);
      validationFields[colIndex - 1] = isMergedChild ? [] : buildValidationItemFieldFlags(cell);
    }

    rows.push(values);
    styleRows.push(styles);
    removedStyleRows.push(removedStyles);
    lineStyleRows.push(lineStyles);
    lineRemovedRows.push(lineRemoved);
    validationFieldRows.push(validationFields);
  }

  return { rows, styleRows, removedStyleRows, lineStyleRows, lineRemovedRows, validationFieldRows };
}

function buildColMap(rows: Array<Array<string | null>>): {
  map: Record<number, number>;
  dataStart: number;
} {
  let headerIndex = -1;
  for (let i = 0; i < Math.min(5, rows.length); i++) {
    if (`${rows[i][0] ?? ''}`.trim() === 'Event') {
      headerIndex = i;
      break;
    }
  }

  if (headerIndex >= 0) {
    const header = rows[headerIndex].map((value) =>
      normalise(value).toLowerCase().trim().replace(/\s+/g, ' '),
    );
    const map: Record<number, number> = {};
    let englishCount = 0;
    let spanishCount = 0;
    let instructionCount = 0;

    header.forEach((label, columnIndex) => {
      if (!label) return;
      if (label === 'event') {
        map[0] = columnIndex;
        return;
      }
      if (
        label.includes('provide') ||
        label.includes('instruct') ||
        label.includes('qualify')
      ) {
        instructionCount += 1;
        if (instructionCount === 1) map[3] = columnIndex;
        else if (instructionCount === 2) map[4] = columnIndex;
        return;
      }
      if (label.includes('english') && !label.includes('doc')) {
        englishCount += 1;
        if (englishCount === 1) map[1] = columnIndex;
        else if (englishCount === 2) map[6] = columnIndex;
        else if (englishCount === 3) map[9] = columnIndex;
        return;
      }
      if (label.includes('spanish') && !label.includes('doc')) {
        spanishCount += 1;
        if (spanishCount === 1) map[2] = columnIndex;
        else if (spanishCount === 2) map[7] = columnIndex;
        else if (spanishCount === 3) map[10] = columnIndex;
        return;
      }
      if (label.includes('categor')) {
        map[5] = columnIndex;
        return;
      }
      if (label.includes('document enum')) {
        if (map[8] === undefined) map[8] = columnIndex;
        return;
      }
      if (
        label.includes('document') &&
        !['english', 'spanish', 'sort', 'valid', 'text'].some((part) =>
          label.includes(part),
        )
      ) {
        if (map[8] === undefined) map[8] = columnIndex;
        return;
      }
      if (label.includes('english') && label.includes('doc')) {
        map[9] = columnIndex;
        return;
      }
      if (label.includes('spanish') && label.includes('doc')) {
        map[10] = columnIndex;
        return;
      }
      if (label.includes('sort')) {
        map[11] = columnIndex;
        return;
      }
      if (label.includes('valid') || label.includes('mandatory')) {
        map[12] = columnIndex;
      }
    });

    if (map[0] !== undefined && map[5] !== undefined && map[8] !== undefined) {
      return { map, dataStart: headerIndex + 1 };
    }
  }

  const dataRow = headerIndex >= 0 ? rows[headerIndex + 1] : rows[0];
  const nonNull = dataRow.map((_, index) => index).filter((index) => dataRow[index] != null);
  const map: Record<number, number> = {};
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].forEach((slot, index) => {
    if (nonNull[index] !== undefined) map[slot] = nonNull[index];
  });
  return { map, dataStart: headerIndex >= 0 ? headerIndex + 1 : 0 };
}

function findFormattedHeaderIndex(rows: Array<Array<string | null>>): number {
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index].slice(0, 6).map((value) => normalise(value).trim().toLowerCase());
    if (
      row[0] === 'field' &&
      row[1] === 'enum' &&
      row[2] === 'english label' &&
      row[3] === 'spanish label' &&
      row[4] === 'validation rules' &&
      row[5] === '#'
    ) {
      return index;
    }
  }
  return -1;
}

function parseFormattedWorkbook(
  fileName: string,
  sheetName: string,
  rows: Array<Array<string | null>>,
  styleRows: boolean[][],
  removedStyleRows: boolean[][],
  lineStyleRows: boolean[][][],
  lineRemovedRows: boolean[][][],
  validationFieldRows: ValidationItemFieldFlags[][][],
): QleWorkbookModel {
  const headerIndex = findFormattedHeaderIndex(rows);
  if (headerIndex < 0) {
    throw new Error('Formatted workbook header not found.');
  }

  const events: QleEvent[] = [];
  let currentEvent: QleEvent | null = null;
  let currentCategory: QleCategory | null = null;

  for (let rowIndex = headerIndex + 1; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex];
    const styles = styleRows[rowIndex] ?? [];
    const removedStyles = removedStyleRows[rowIndex] ?? [];
    const lineStyles = lineStyleRows[rowIndex] ?? [];
    const lineRemoved = lineRemovedRows[rowIndex] ?? [];
    const validationFields = validationFieldRows[rowIndex] ?? [];
    const field = normalise(row[0]).trim();
    const enumValue = normalise(row[1]).trim();
    const enValue = normalise(row[2]).trim();
    const esValue = normalise(row[3]).trim();
    const validationValue = normalise(row[4]).trim();
    const sortValue = normalise(row[5]).trim();

    if (
      field.startsWith('Event Group ') ||
      field.startsWith('Event ') ||
      field.startsWith('Group ')
    ) {
      currentEvent = {
        id: randomUUID(),
        eventNumber: events.length + 1,
        enumRows: [],
        instructionsEn: '',
        instructionsEs: '',
        fieldStates: {},
        isRemoved: removedStyles.some(Boolean),
        isNew: styles.some(Boolean) && !removedStyles.some(Boolean),
        categories: [],
      };
      events.push(currentEvent);
      currentCategory = null;
      continue;
    }

    if (!currentEvent) {
      continue;
    }

    if (field === 'Enum') {
      currentEvent.enumRows.push({
        id: randomUUID(),
        enum: enumValue,
        en: enValue,
        es: esValue,
        fieldStates: buildFieldStates({
          enum: { isNew: styles[1], isRemoved: removedStyles[1] },
          en: { isNew: styles[2], isRemoved: removedStyles[2] },
          es: { isNew: styles[3], isRemoved: removedStyles[3] },
        }),
        isRemoved: [1, 2, 3].some((index) => removedStyles[index]),
        isNew:
          [1, 2, 3].some((index) => styles[index]) &&
          ![1, 2, 3].some((index) => removedStyles[index]),
      });
      continue;
    }

    if (field === 'Instructions') {
      currentEvent.instructionsEn = enValue;
      currentEvent.instructionsEs = esValue;
      currentEvent.fieldStates = {
        ...(currentEvent.fieldStates ?? {}),
        ...buildFieldStates({
          instructionsEn: { isNew: styles[2], isRemoved: removedStyles[2] },
          instructionsEs: { isNew: styles[3], isRemoved: removedStyles[3] },
        }),
      };
      continue;
    }

    if (field === 'CATEGORY') {
      const validationItems = parseValidationItems(
        validationValue,
        lineStyles[4] ?? [],
        lineRemoved[4] ?? [],
        validationFields[4] ?? [],
      );
      currentCategory = {
        id: randomUUID(),
        enum: enumValue,
        en: enValue,
        es: esValue,
        validation: validationItems.length > 0 ? serializeValidationItems(validationItems) : validationValue,
        validationItems,
        fieldStates: buildFieldStates({
          enum: { isNew: styles[1], isRemoved: removedStyles[1] },
          en: { isNew: styles[2], isRemoved: removedStyles[2] },
          es: { isNew: styles[3], isRemoved: removedStyles[3] },
          validation: { isNew: styles[4], isRemoved: removedStyles[4] },
        }),
        isRemoved: [0, 1, 2, 3].some((index) => removedStyles[index]),
        isNew:
          [0, 1, 2, 3].some((index) => styles[index]) &&
          ![0, 1, 2, 3].some((index) => removedStyles[index]),
        documents: [],
      };
      currentEvent.categories.push(currentCategory);
      continue;
    }

    if (field === 'DOC' && currentCategory) {
      currentCategory.documents.push({
        id: randomUUID(),
        enum: enumValue,
        en: enValue,
        es: esValue,
        sort: sortValue ? Number(sortValue) || null : null,
        fieldStates: buildFieldStates({
          enum: { isNew: styles[1], isRemoved: removedStyles[1] || currentCategory.isRemoved },
          en: { isNew: styles[2], isRemoved: removedStyles[2] || currentCategory.isRemoved },
          es: { isNew: styles[3], isRemoved: removedStyles[3] || currentCategory.isRemoved },
        }),
        isRemoved: [1, 2, 3, 5].some((index) => removedStyles[index]) || currentCategory.isRemoved,
        isNew:
          [1, 2, 3, 5].some((index) => styles[index]) &&
          !([1, 2, 3, 5].some((index) => removedStyles[index]) || currentCategory.isRemoved),
      });
    }
  }

  return {
    id: randomUUID(),
    fileName,
    sourceSheet: sheetName,
    importedAt: new Date().toISOString(),
    events: normalizeDocumentSorts(events),
  };
}

export async function importWorkbook(
  fileName: string,
  input: Buffer,
): Promise<QleWorkbookModel> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(input) as any, READ_XLSX_OPTS);
  const sheetName = findSheetName(workbook);
  const worksheet = workbook.getWorksheet(sheetName);
  if (!worksheet) throw new Error(`Worksheet not found: ${sheetName}`);

  const { rows, styleRows, removedStyleRows, lineStyleRows, lineRemovedRows, validationFieldRows } = buildInputRows(worksheet);
  if (findFormattedHeaderIndex(rows) >= 0) {
    return parseFormattedWorkbook(
      fileName,
      sheetName,
      rows,
      styleRows,
      removedStyleRows,
      lineStyleRows,
      lineRemovedRows,
      validationFieldRows,
    );
  }

  const { map, dataStart } = buildColMap(rows);
  const getString = (row: Array<string | null>, slot: number): string | null => {
    const columnIndex = map[slot];
    if (columnIndex === undefined) return null;
    const value = row[columnIndex];
    return value != null ? `${value}`.trim() : null;
  };
  const getValue = (row: Array<string | null>, slot: number): string | null => {
    const columnIndex = map[slot];
    return columnIndex === undefined ? null : row[columnIndex];
  };
  const hasNew = (styles: boolean[], slots: number[]): boolean =>
    slots.some((slot) => {
      const columnIndex = map[slot];
      return columnIndex !== undefined && styles[columnIndex] === true;
    });
  const hasRemoved = (styles: boolean[], slots: number[]): boolean =>
    slots.some((slot) => {
      const columnIndex = map[slot];
      return columnIndex !== undefined && styles[columnIndex] === true;
    });
  const getLineFlags = (lineStyles: boolean[][], slot: number): boolean[] => {
    const columnIndex = map[slot];
    return columnIndex === undefined ? [] : lineStyles[columnIndex] ?? [];
  };

  const events: QleEvent[] = [];
  let currentEvent: QleEvent | null = null;
  let currentCategory: QleCategory | null = null;
  let lastDocument: QleDocument | null = null;

  for (let rowIndex = dataStart; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex];
    const rowStyles = styleRows[rowIndex] ?? [];
    const rowRemovedStyles = removedStyleRows[rowIndex] ?? [];
    const rowLineStyles = lineStyleRows[rowIndex] ?? [];
    const rowLineRemoved = lineRemovedRows[rowIndex] ?? [];
    const rowValidationFields = validationFieldRows[rowIndex] ?? [];
    const eventHasHighlight = hasNew(rowStyles, [0, 1, 2, 3, 4]);
    const eventInstructionsHaveHighlight = hasNew(rowStyles, [3, 4]);
    const categoryHasHighlight = hasNew(rowStyles, [5, 6, 7]);
    const documentHasHighlight = hasNew(rowStyles, [8, 9, 10, 11]);
    const documentContinuationHasHighlight = hasNew(rowStyles, [9, 10]);
    const eventIsRemoved = hasRemoved(rowRemovedStyles, [0, 1, 2, 3, 4]);
    const categoryIsRemoved = hasRemoved(rowRemovedStyles, [5, 6, 7]);
    const documentIsRemoved = hasRemoved(rowRemovedStyles, [8, 9, 10, 11]);
    const eventEnum = getString(row, 0);
    const eventEn = getString(row, 1);
    const eventEs = getString(row, 2);
    const instructionsEn = getString(row, 3);
    const instructionsEs = getString(row, 4);
    const categoryEnum = getString(row, 5);
    const categoryEn = getString(row, 6);
    const categoryEs = getString(row, 7);
    const documentEnum = getString(row, 8);
    const documentEn = getString(row, 9);
    const documentEs = getString(row, 10);
    const sortValue = getValue(row, 11);
    const validationRule = getString(row, 12);

    if (eventEnum && eventEn) {
      const enumRows = splitEnums(eventEnum);
      const englishRows = splitLabels(eventEn);
      const spanishRows = splitLabels(eventEs ?? '');
      let eventFlags = buildSplitNewFlags(enumRows.length, eventHasHighlight && !eventIsRemoved);
      const enumLineFlags = getLineFlags(rowLineStyles, 0);
      const englishLineFlags = getLineFlags(rowLineStyles, 1);
      const spanishLineFlags = getLineFlags(rowLineStyles, 2);
      if (
        enumRows.length > 1 &&
        (enumLineFlags.length > 0 || englishLineFlags.length > 0 || spanishLineFlags.length > 0)
      ) {
        const itemFlags = enumRows.map(
          (_, index) =>
            !eventIsRemoved &&
            (Boolean(enumLineFlags[index]) ||
              Boolean(englishLineFlags[index]) ||
              Boolean(spanishLineFlags[index])),
        );
        const allNew = itemFlags.every(Boolean);
        eventFlags = {
          rowIsNew: eventInstructionsHaveHighlight || allNew,
          itemFlags,
        };
      }
      currentEvent = {
        id: randomUUID(),
        eventNumber: events.length + 1,
        enumRows: enumRows.map((value, index) => ({
          id: randomUUID(),
          enum: value,
          en: englishRows[index] ?? englishRows[englishRows.length - 1] ?? '',
          es: spanishRows[index] ?? spanishRows[spanishRows.length - 1] ?? '',
          fieldStates: buildFieldStates({
            enum: { isNew: eventFlags.itemFlags[index], isRemoved: eventIsRemoved },
            en: { isNew: eventFlags.itemFlags[index], isRemoved: eventIsRemoved },
            es: { isNew: eventFlags.itemFlags[index], isRemoved: eventIsRemoved },
          }),
          isNew: eventFlags.itemFlags[index] ?? false,
          manualIsNew: null,
        })),
        instructionsEn: instructionsEn ?? '',
        instructionsEs: instructionsEs ?? '',
        fieldStates: buildFieldStates({
          instructionsEn: { isNew: eventInstructionsHaveHighlight, isRemoved: eventIsRemoved },
          instructionsEs: { isNew: eventInstructionsHaveHighlight, isRemoved: eventIsRemoved },
        }),
        isNew: eventFlags.rowIsNew,
        manualIsNew: null,
        isRemoved: eventIsRemoved,
        categories: [],
      };
      events.push(currentEvent);
      currentCategory = null;
      lastDocument = null;
    }

    if (categoryEnum && currentEvent) {
      const validationItems = parseValidationItems(
        validationRule,
        (rowLineStyles[map[12] ?? -1] ?? []).slice(),
        (rowLineRemoved[map[12] ?? -1] ?? []).slice(),
        (rowValidationFields[map[12] ?? -1] ?? []).slice(),
      );
      currentCategory = {
        id: randomUUID(),
        enum: categoryEnum,
        en: categoryEn ?? '',
        es: categoryEs ?? '',
        validation: validationItems.length > 0 ? serializeValidationItems(validationItems) : validationRule ?? '',
        validationItems,
        fieldStates: buildFieldStates({
          enum: { isNew: rowStyles[map[5] ?? -1], isRemoved: currentEvent.isRemoved || categoryIsRemoved },
          en: { isNew: rowStyles[map[6] ?? -1], isRemoved: currentEvent.isRemoved || categoryIsRemoved },
          es: { isNew: rowStyles[map[7] ?? -1], isRemoved: currentEvent.isRemoved || categoryIsRemoved },
          validation: { isNew: rowStyles[map[12] ?? -1], isRemoved: currentEvent.isRemoved || categoryIsRemoved },
        }),
        manualIsNew: null,
        isRemoved: currentEvent.isRemoved || categoryIsRemoved,
        isNew: categoryHasHighlight && !(currentEvent.isRemoved || categoryIsRemoved),
        documents: [],
      };
      currentEvent.categories.push(currentCategory);
      lastDocument = null;
    }

    if (documentEnum && currentCategory) {
      const parsedDocs = splitDocs(documentEnum, documentEn, documentEs, sortValue);
      const docFlags =
        currentEvent?.isNew || currentCategory.isNew
          ? promoteAllFlags(buildSplitNewFlags(parsedDocs.length, documentHasHighlight))
          : buildSplitNewFlags(parsedDocs.length, documentHasHighlight && !documentIsRemoved);
      const docs = parsedDocs.map((doc, index) => ({
        id: randomUUID(),
        ...doc,
        fieldStates: buildFieldStates({
          enum: {
            isNew: docFlags.itemFlags[index],
            isRemoved: Boolean(currentEvent?.isRemoved || currentCategory?.isRemoved || documentIsRemoved),
          },
          en: {
            isNew: docFlags.itemFlags[index],
            isRemoved: Boolean(currentEvent?.isRemoved || currentCategory?.isRemoved || documentIsRemoved),
          },
          es: {
            isNew: docFlags.itemFlags[index],
            isRemoved: Boolean(currentEvent?.isRemoved || currentCategory?.isRemoved || documentIsRemoved),
          },
        }),
        manualIsNew: null,
        isRemoved: Boolean(currentEvent?.isRemoved || currentCategory?.isRemoved || documentIsRemoved),
        isNew:
          (docFlags.itemFlags[index] ?? false) &&
          !Boolean(currentEvent?.isRemoved || currentCategory?.isRemoved || documentIsRemoved),
      }));
      currentCategory.documents.push(...docs);
      lastDocument = docs[docs.length - 1] ?? lastDocument;
    } else if (!documentEnum && currentCategory && lastDocument && (documentEn || documentEs)) {
      if (documentEn) lastDocument.en = lastDocument.en ? `${lastDocument.en}\n${documentEn}` : documentEn;
      if (documentEs) lastDocument.es = lastDocument.es ? `${lastDocument.es}\n${documentEs}` : documentEs;
      if (documentContinuationHasHighlight) {
        lastDocument.isNew = true;
        lastDocument.fieldStates = {
          ...(lastDocument.fieldStates ?? {}),
          en: {
            ...(lastDocument.fieldStates?.en ?? { manualIsNew: null }),
            isNew: true,
          },
          es: {
            ...(lastDocument.fieldStates?.es ?? { manualIsNew: null }),
            isNew: true,
          },
        };
      }
      if (documentIsRemoved) {
        lastDocument.isRemoved = true;
        lastDocument.fieldStates = {
          ...(lastDocument.fieldStates ?? {}),
          en: {
            ...(lastDocument.fieldStates?.en ?? { manualIsNew: null }),
            isRemoved: true,
            isNew: false,
          },
          es: {
            ...(lastDocument.fieldStates?.es ?? { manualIsNew: null }),
            isRemoved: true,
            isNew: false,
          },
        };
      }
    }
  }

  return {
    id: randomUUID(),
    fileName,
    sourceSheet: sheetName,
    importedAt: new Date().toISOString(),
    events: normalizeDocumentSorts(events),
  };
}

function styleCell(cell: ExcelJS.Cell, value: string | number, options: {
  bg: string;
  fg?: string;
  bold?: boolean;
  strike?: boolean;
  size?: number;
  align?: ExcelJS.Alignment['horizontal'];
  mono?: boolean;
}) {
  cell.value = value;
  cell.font = {
    name: options.mono ? 'Courier New' : 'Arial',
    size: options.size ?? 9,
    bold: options.bold ?? false,
    strike: options.strike ?? false,
    color: { argb: options.fg ?? 'FF000000' },
  };
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: options.bg } };
  cell.alignment = {
    horizontal: options.align ?? 'left',
    vertical: 'middle',
    wrapText: true,
  };
  cell.border = {
    top: { style: 'thin', color: { argb: 'FFB8CCE4' } },
    bottom: { style: 'thin', color: { argb: 'FFB8CCE4' } },
    left: { style: 'thin', color: { argb: 'FFB8CCE4' } },
    right: { style: 'thin', color: { argb: 'FFB8CCE4' } },
  };
}

function buildValidationCellValue(category: QleCategory): ExcelJS.CellValue {
  const items = category.validationItems ?? [];
  if (items.length === 0) {
    return category.validation;
  }

  const richText: ExcelJS.RichText[] = [];

  items.forEach((item, index) => {
    if (!item.key.trim()) {
      return;
    }

    const prefix = `${item.key.trim()}: `;
    const value = item.value.trim();
    const suffix = index < items.length - 1 ? '\n' : '';
    const keyStyle = validationItemFieldStyle(item, 'key');
    const valueStyle = validationItemFieldStyle(item, 'value');

    richText.push({
      font: {
        size: 8,
        name: 'Courier New',
        family: 3,
        bold: keyStyle.isNew,
        color: { argb: keyStyle.isRemoved || keyStyle.isNew ? COLORS.removedFg : COLORS.validationFg },
        strike: keyStyle.isRemoved,
      },
      text: prefix,
    });
    richText.push({
      font: {
        size: 8,
        name: 'Courier New',
        family: 3,
        bold: valueStyle.isNew,
        color: {
          argb: valueStyle.isRemoved || valueStyle.isNew ? COLORS.removedFg : COLORS.validationFg,
        },
        strike: valueStyle.isRemoved,
      },
      text: `${value}${suffix}`,
    });
  });

  return richText.length > 0 ? { richText } : category.validation;
}

function resolveFieldStyle(
  fieldState: QleFieldStateMap[string] | undefined,
  baseBg: string,
  baseFg: string,
  newBg: string,
  entityIsNew: boolean,
  entityIsRemoved: boolean,
) {
  const isRemoved = entityIsRemoved || Boolean(fieldState?.isRemoved);
  const isNew = !isRemoved && (entityIsNew || Boolean(fieldState?.isNew));
  return {
    bg: isRemoved ? COLORS.removedBg : isNew ? newBg : baseBg,
    fg: isRemoved ? COLORS.removedFg : isNew ? 'FFC00000' : baseFg,
    strike: isRemoved,
  };
}

export async function exportWorkbook(model: QleWorkbookModel): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Config & Validation Rules');
  worksheet.properties.showGridLines = false;
  worksheet.columns = [
    { width: 15 },
    { width: 58 },
    { width: 52 },
    { width: 52 },
    { width: 36 },
    { width: 6 },
  ];

  worksheet.mergeCells('A1:F1');
  styleCell(worksheet.getCell('A1'), 'Configuration & Validation Rules', {
    bg: COLORS.event,
    fg: 'FFFFFFFF',
    bold: true,
    size: 14,
    align: 'center',
  });

  worksheet.mergeCells('A2:F2');
  styleCell(
    worksheet.getCell('A2'),
    'PM dashboard export. Review changes before sending to engineering.',
    {
      bg: 'FFFFF2CC',
      fg: 'FF7F3F00',
      bold: true,
    },
  );

  ['Field', 'Enum', 'English Label', 'Spanish Label', 'Validation Rules', '#'].forEach(
    (value, index) => {
      styleCell(worksheet.getCell(3, index + 1), value, {
        bg: COLORS.header,
        fg: 'FFFFFFFF',
        bold: true,
        align: 'center',
      });
    },
  );

  let row = 4;
  for (const event of model.events) {
    const eventIsRemoved = Boolean(event.isRemoved);
    worksheet.mergeCells(`A${row}:F${row}`);
    styleCell(worksheet.getCell(row, 1), `Event Group ${event.eventNumber}`, {
      bg: eventIsRemoved ? COLORS.removedBg : event.isNew ? 'FFFFEB9C' : COLORS.event,
      fg: eventIsRemoved ? COLORS.removedFg : event.isNew ? 'FFC00000' : 'FFFFFFFF',
      bold: true,
      strike: eventIsRemoved,
      size: 10,
    });
    row += 1;

    for (const enumRow of event.enumRows) {
      const isRemoved = eventIsRemoved || Boolean(enumRow.isRemoved);
      const enumIsNew = Boolean(event.isNew || enumRow.isNew);
      const enumStyle = resolveFieldStyle(
        enumRow.fieldStates?.enum,
        COLORS.enumBg,
        'FF1A3A1A',
        'FFFFF3CD',
        enumIsNew,
        isRemoved,
      );
      const enumEnStyle = resolveFieldStyle(
        enumRow.fieldStates?.en,
        COLORS.eventLabel,
        'FF1F3864',
        'FFFFEB9C',
        enumIsNew,
        isRemoved,
      );
      const enumEsStyle = resolveFieldStyle(
        enumRow.fieldStates?.es,
        COLORS.eventLabel,
        'FF595959',
        'FFFFEB9C',
        enumIsNew,
        isRemoved,
      );
      styleCell(worksheet.getCell(row, 1), 'Enum', {
        bg: isRemoved ? COLORS.removedBg : enumIsNew ? 'FFFF8C00' : COLORS.eventKey,
        fg: isRemoved ? COLORS.removedFg : 'FFFFFFFF',
        bold: true,
        strike: isRemoved,
        align: 'right',
      });
      styleCell(worksheet.getCell(row, 2), enumRow.enum, {
        bg: enumStyle.bg,
        fg: enumStyle.fg,
        bold: true,
        strike: enumStyle.strike,
        mono: true,
      });
      styleCell(worksheet.getCell(row, 3), enumRow.en, {
        bg: enumEnStyle.bg,
        fg: enumEnStyle.fg,
        strike: enumEnStyle.strike,
      });
      styleCell(worksheet.getCell(row, 4), enumRow.es, {
        bg: enumEsStyle.bg,
        fg: enumEsStyle.fg,
        strike: enumEsStyle.strike,
      });
      styleCell(worksheet.getCell(row, 5), '', {
        bg: isRemoved ? COLORS.removedBg : COLORS.eventLabel,
        strike: isRemoved,
      });
      styleCell(worksheet.getCell(row, 6), '', {
        bg: isRemoved ? COLORS.removedBg : COLORS.eventLabel,
        strike: isRemoved,
      });
      row += 1;
    }

    if (event.instructionsEn || event.instructionsEs) {
      styleCell(worksheet.getCell(row, 1), 'Instructions', {
        bg: eventIsRemoved ? COLORS.removedBg : event.isNew ? 'FFFF8C00' : COLORS.eventKey,
        fg: eventIsRemoved ? COLORS.removedFg : 'FFFFFFFF',
        bold: true,
        strike: eventIsRemoved,
        align: 'right',
      });
      styleCell(worksheet.getCell(row, 2), '', {
        bg: eventIsRemoved ? COLORS.removedBg : COLORS.instructions,
        strike: eventIsRemoved,
      });
      const instructionsEnStyle = resolveFieldStyle(
        event.fieldStates?.instructionsEn,
        COLORS.instructions,
        'FF1F3864',
        'FFFFF9E6',
        Boolean(event.isNew),
        eventIsRemoved,
      );
      styleCell(worksheet.getCell(row, 3), event.instructionsEn, {
        bg: instructionsEnStyle.bg,
        fg: instructionsEnStyle.fg,
        strike: instructionsEnStyle.strike,
      });
      const instructionsEsStyle = resolveFieldStyle(
        event.fieldStates?.instructionsEs,
        COLORS.instructions,
        'FF595959',
        'FFFFF9E6',
        Boolean(event.isNew),
        eventIsRemoved,
      );
      styleCell(worksheet.getCell(row, 4), event.instructionsEs, {
        bg: instructionsEsStyle.bg,
        fg: instructionsEsStyle.fg,
        strike: instructionsEsStyle.strike,
      });
      styleCell(worksheet.getCell(row, 5), '', {
        bg: eventIsRemoved ? COLORS.removedBg : COLORS.instructions,
        strike: eventIsRemoved,
      });
      styleCell(worksheet.getCell(row, 6), '', {
        bg: eventIsRemoved ? COLORS.removedBg : COLORS.instructions,
        strike: eventIsRemoved,
      });
      row += 1;
    }

    for (const category of event.categories) {
      const categoryIsNew = event.isNew || category.isNew;
      const categoryIsRemoved = eventIsRemoved || Boolean(category.isRemoved);
      const validationItems = category.validationItems ?? [];
      const validationHasRemoved = validationItems.some((item) => validationItemHasRemoved(item));
      const validationHasNew = validationItems.some((item) => validationItemHasNew(item));
      const categoryEnumStyle = resolveFieldStyle(
        category.fieldStates?.enum,
        COLORS.category,
        'FFFFFFFF',
        'FFFFEB9C',
        Boolean(categoryIsNew),
        categoryIsRemoved,
      );
      const categoryEnStyle = resolveFieldStyle(
        category.fieldStates?.en,
        COLORS.category,
        'FFFFFFFF',
        'FFFFEB9C',
        Boolean(categoryIsNew),
        categoryIsRemoved,
      );
      const categoryEsStyle = resolveFieldStyle(
        category.fieldStates?.es,
        COLORS.category,
        'FFFFFFFF',
        'FFFFEB9C',
        Boolean(categoryIsNew),
        categoryIsRemoved,
      );
      styleCell(worksheet.getCell(row, 1), 'CATEGORY', {
        bg: categoryIsRemoved ? COLORS.removedBg : categoryIsNew ? 'FFFFEB9C' : COLORS.category,
        fg: categoryIsRemoved ? COLORS.removedFg : categoryIsNew ? 'FFC00000' : 'FFFFFFFF',
        bold: true,
        strike: categoryIsRemoved,
        align: 'center',
      });
      styleCell(worksheet.getCell(row, 2), category.enum, {
        bg: categoryEnumStyle.bg,
        fg: categoryEnumStyle.fg,
        bold: true,
        strike: categoryEnumStyle.strike,
        mono: true,
      });
      styleCell(worksheet.getCell(row, 3), category.en, {
        bg: categoryEnStyle.bg,
        fg: categoryEnStyle.fg,
        bold: true,
        strike: categoryEnStyle.strike,
      });
      styleCell(worksheet.getCell(row, 4), category.es, {
        bg: categoryEsStyle.bg,
        fg: categoryEsStyle.fg,
        strike: categoryEsStyle.strike,
      });
      styleCell(worksheet.getCell(row, 5), '', {
        bg: categoryIsRemoved
          ? COLORS.removedBg
          : validationHasRemoved
            ? COLORS.removedBg
            : validationHasNew
              ? 'FFFFF9E6'
              : COLORS.validationBg,
        fg: categoryIsRemoved ? COLORS.removedFg : COLORS.validationFg,
        strike: categoryIsRemoved,
        mono: true,
        size: 8,
      });
      worksheet.getCell(row, 5).value = categoryIsRemoved ? category.validation : buildValidationCellValue(category);
      styleCell(worksheet.getCell(row, 6), '', {
        bg: categoryIsRemoved ? COLORS.removedBg : categoryIsNew ? 'FFFFEB9C' : COLORS.category,
        fg: categoryIsRemoved ? COLORS.removedFg : categoryIsNew ? 'FFC00000' : 'FFFFFFFF',
        strike: categoryIsRemoved,
      });
      row += 1;

      ['', 'Document Enum', 'English Label / Text', 'Spanish Label / Text', 'Validation Rules', '#'].forEach(
        (value, index) => {
          styleCell(worksheet.getCell(row, index + 1), value, {
            bg: COLORS.headerDoc,
            fg: 'FFFFFFFF',
            bold: true,
            align: 'center',
            size: 7,
          });
        },
      );
      row += 1;

      category.documents.forEach((document, index) => {
        const docIsNew = categoryIsNew || document.isNew;
        const docIsRemoved = categoryIsRemoved || Boolean(document.isRemoved);
        const background = docIsRemoved
          ? COLORS.removedBg
          : docIsNew
            ? 'FFFFEB9C'
            : index % 2 === 1
              ? COLORS.alt
              : COLORS.white;
        const documentEnumStyle = resolveFieldStyle(
          document.fieldStates?.enum,
          COLORS.enumBg,
          'FF375623',
          'FFFFF3CD',
          Boolean(docIsNew),
          docIsRemoved,
        );
        const documentEnStyle = resolveFieldStyle(
          document.fieldStates?.en,
          background,
          'FF000000',
          'FFFFEB9C',
          Boolean(docIsNew),
          docIsRemoved,
        );
        const documentEsStyle = resolveFieldStyle(
          document.fieldStates?.es,
          background,
          'FF595959',
          'FFFFEB9C',
          Boolean(docIsNew),
          docIsRemoved,
        );
        styleCell(worksheet.getCell(row, 1), 'DOC', {
          bg: background,
          fg: docIsRemoved ? COLORS.removedFg : docIsNew ? 'FFC00000' : 'FF2F5496',
          strike: docIsRemoved,
          align: 'center',
          size: 7,
        });
        styleCell(worksheet.getCell(row, 2), document.enum, {
          bg: documentEnumStyle.bg,
          fg: documentEnumStyle.fg,
          bold: true,
          strike: documentEnumStyle.strike,
          mono: true,
          size: 8,
        });
        styleCell(worksheet.getCell(row, 3), document.en, {
          bg: documentEnStyle.bg,
          fg: documentEnStyle.fg,
          strike: documentEnStyle.strike,
        });
        styleCell(worksheet.getCell(row, 4), document.es, {
          bg: documentEsStyle.bg,
          fg: documentEsStyle.fg,
          strike: documentEsStyle.strike,
          size: 8,
        });
        styleCell(worksheet.getCell(row, 5), '', { bg: background, strike: docIsRemoved });
        styleCell(worksheet.getCell(row, 6), document.sort ?? '', {
          bg: background,
          fg: docIsRemoved ? COLORS.removedFg : docIsNew ? 'FFC00000' : 'FF2F5496',
          bold: true,
          strike: docIsRemoved,
          align: 'center',
        });
        row += 1;
      });
    }

    for (let col = 1; col <= 6; col++) {
      const cell = worksheet.getCell(row, col);
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.spacer } };
    }
    row += 1;
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function flattenEvents(model: QleWorkbookModel): {
  events: Map<string, QleEvent>;
  enums: Map<string, { row: QleEnumRow; eventNumber: number }>;
  categories: Map<string, { category: QleCategory; eventNumber: number }>;
  documents: Map<string, { document: QleDocument; eventNumber: number; categoryEnum: string }>;
} {
  const events = new Map<string, QleEvent>();
  const enums = new Map<string, { row: QleEnumRow; eventNumber: number }>();
  const categories = new Map<string, { category: QleCategory; eventNumber: number }>();
  const documents = new Map<
    string,
    { document: QleDocument; eventNumber: number; categoryEnum: string }
  >();

  model.events.forEach((event) => {
    events.set(event.id, event);
    event.enumRows.forEach((row) => enums.set(row.id, { row, eventNumber: event.eventNumber }));
    event.categories.forEach((category) => {
      categories.set(category.id, { category, eventNumber: event.eventNumber });
      category.documents.forEach((document) =>
        documents.set(document.id, {
          document,
          eventNumber: event.eventNumber,
          categoryEnum: category.enum,
        }),
      );
    });
  });

  return { events, enums, categories, documents };
}

function pushChange(
  entries: DiffEntry[],
  kind: DiffEntry['kind'],
  entity: DiffEntry['entity'],
  path: string,
  detail: string,
) {
  entries.push({ kind, entity, path, detail });
}

export function diffWorkbooks(
  original: QleWorkbookModel,
  edited: QleWorkbookModel,
): DiffSummary {
  const originalFlat = flattenEvents(original);
  const editedFlat = flattenEvents(edited);
  const entries: DiffEntry[] = [];

  for (const [id, event] of editedFlat.events) {
    if (!originalFlat.events.has(id)) {
      pushChange(
        entries,
        event.isRemoved ? 'removed' : 'added',
        'event',
        `Event ${event.eventNumber}`,
        event.isRemoved ? 'Marked event as removed' : 'Added event',
      );
    } else {
      const before = originalFlat.events.get(id);
      if (
        before &&
        (
          before.instructionsEn !== event.instructionsEn ||
          before.instructionsEs !== event.instructionsEs ||
          before.isNew !== event.isNew ||
          before.isRemoved !== event.isRemoved ||
          before.eventNumber !== event.eventNumber
        )
      ) {
        pushChange(
          entries,
          event.isRemoved && !before.isRemoved ? 'removed' : 'changed',
          'event',
          `Event ${event.eventNumber}`,
          event.isRemoved && !before.isRemoved ? 'Marked event as removed' : 'Updated event details',
        );
      }
    }
  }
  for (const [id, event] of originalFlat.events) {
    if (!editedFlat.events.has(id)) {
      pushChange(entries, 'removed', 'event', `Event ${event.eventNumber}`, 'Removed event');
    }
  }

  for (const [id, enumEntry] of editedFlat.enums) {
    const before = originalFlat.enums.get(id);
    const { row, eventNumber } = enumEntry;
    const enumPath = `Event ${eventNumber} > ${row.enum}`;
    if (!before) {
      pushChange(
        entries,
        row.isRemoved ? 'removed' : 'added',
        'enum',
        enumPath,
        row.isRemoved ? 'Marked enum row as removed' : 'Added enum row',
      );
    } else if (
      before.row.enum !== row.enum ||
      before.row.en !== row.en ||
      before.row.es !== row.es ||
      before.row.isNew !== row.isNew ||
      before.row.isRemoved !== row.isRemoved
    ) {
      pushChange(
        entries,
        row.isRemoved && !before.row.isRemoved ? 'removed' : 'changed',
        'enum',
        enumPath,
        row.isRemoved && !before.row.isRemoved ? 'Marked enum row as removed' : 'Updated enum labels or status',
      );
    }
  }
  for (const [id, enumEntry] of originalFlat.enums) {
    if (!editedFlat.enums.has(id)) {
      pushChange(
        entries,
        'removed',
        'enum',
        `Event ${enumEntry.eventNumber} > ${enumEntry.row.enum}`,
        'Removed enum row',
      );
    }
  }

  for (const [id, categoryEntry] of editedFlat.categories) {
    const before = originalFlat.categories.get(id);
    const { category, eventNumber } = categoryEntry;
    const categoryPath = `Event ${eventNumber} > ${category.enum}`;
    if (!before) {
      pushChange(
        entries,
        category.isRemoved ? 'removed' : 'added',
        'category',
        categoryPath,
        category.isRemoved ? 'Marked category as removed' : 'Added category',
      );
    } else if (
      before.category.enum !== category.enum ||
      before.category.en !== category.en ||
      before.category.es !== category.es ||
      before.category.validation !== category.validation ||
      before.category.isNew !== category.isNew ||
      before.category.isRemoved !== category.isRemoved
    ) {
      pushChange(
        entries,
        category.isRemoved && !before.category.isRemoved ? 'removed' : 'changed',
        'category',
        categoryPath,
        category.isRemoved && !before.category.isRemoved
          ? 'Marked category as removed'
          : `Changed from Event ${before.eventNumber} > ${before.category.enum}`,
      );
    }
  }
  for (const [id, categoryEntry] of originalFlat.categories) {
    if (!editedFlat.categories.has(id)) {
      pushChange(
        entries,
        'removed',
        'category',
        `Event ${categoryEntry.eventNumber} > ${categoryEntry.category.enum}`,
        'Removed category',
      );
    }
  }

  for (const [id, documentEntry] of editedFlat.documents) {
    const before = originalFlat.documents.get(id);
    const { document, eventNumber, categoryEnum } = documentEntry;
    const documentPath = `Event ${eventNumber} > ${categoryEnum} > ${document.enum}`;
    if (!before) {
      pushChange(
        entries,
        document.isRemoved ? 'removed' : 'added',
        'document',
        documentPath,
        document.isRemoved ? 'Marked document row as removed' : 'Added document',
      );
    } else if (
      before.document.enum !== document.enum ||
      before.document.en !== document.en ||
      before.document.es !== document.es ||
      before.document.sort !== document.sort ||
      before.document.isNew !== document.isNew ||
      before.document.isRemoved !== document.isRemoved
    ) {
      pushChange(
        entries,
        document.isRemoved && !before.document.isRemoved ? 'removed' : 'changed',
        'document',
        documentPath,
        document.isRemoved && !before.document.isRemoved ? 'Marked document row as removed' : 'Updated document row',
      );
    }
  }
  for (const [id, documentEntry] of originalFlat.documents) {
    if (!editedFlat.documents.has(id)) {
      pushChange(
        entries,
        'removed',
        'document',
        `Event ${documentEntry.eventNumber} > ${documentEntry.categoryEnum} > ${documentEntry.document.enum}`,
        'Removed document row',
      );
    }
  }

  return {
    counts: {
      events: edited.events.length,
      enums: edited.events.reduce((sum, event) => sum + event.enumRows.length, 0),
      categories: edited.events.reduce((sum, event) => sum + event.categories.length, 0),
      documents: edited.events.reduce(
        (sum, event) =>
          sum + event.categories.reduce((inner, category) => inner + category.documents.length, 0),
        0,
      ),
      changes: entries.length,
    },
    entries,
  };
}

export function diffToMarkdown(summary: DiffSummary): string {
  const lines = ['# QLE Change Summary', '', `Total changes: ${summary.counts.changes}`, ''];
  if (summary.entries.length === 0) {
    lines.push('No structural changes detected.');
  } else {
    summary.entries.forEach((entry) => {
      lines.push(`- [${entry.kind}] ${entry.entity} \`${entry.path}\` — ${entry.detail}`);
    });
  }
  return `${lines.join('\n')}\n`;
}
