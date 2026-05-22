const UPLOAD_DOC_FILE_NAME_PATTERN =
  /^uploadDoc_([A-Za-z0-9_]+)_v?(\d+(?:\.\d+){0,2})_(\d{2})-(\d{2})-(\d{4})$/i;
const LEGACY_QLE_FILE_NAME_PATTERN =
  /^QLEDocumentsSpec_([A-Za-z0-9_]+)_v(\d+(?:\.\d+){0,2})_(\d{2})\.(\d{2})\.(\d{4})$/i;

type ParsedWorkbookName = {
  stateCode: string;
  versionParts: [number, number, number];
  versionSegmentCount: number;
  fileDate: Date | null;
};

function stripExtension(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '');
}

function parseVersionParts(versionText: string): {
  parts: [number, number, number];
  segmentCount: number;
} {
  const rawParts = versionText
    .split('.')
    .map((part) => Number.parseInt(part, 10))
    .filter((part) => Number.isFinite(part) && part >= 0);
  const [major = 1, minor = 0, patch = 0] = rawParts;
  return {
    parts: [major, minor, patch],
    segmentCount: Math.max(1, rawParts.length),
  };
}

function parseDateParts(year: string, month: string, day: string): Date | null {
  const parsedDate = new Date(
    Number.parseInt(year, 10),
    Number.parseInt(month, 10) - 1,
    Number.parseInt(day, 10),
  );
  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
}

function extractStateCode(fileName: string): string {
  const base = stripExtension(fileName);
  const uploadMatch = base.match(UPLOAD_DOC_FILE_NAME_PATTERN);
  if (uploadMatch) {
    return uploadMatch[1].toUpperCase();
  }

  const legacyMatch = base.match(LEGACY_QLE_FILE_NAME_PATTERN);
  if (legacyMatch) {
    return legacyMatch[1].toUpperCase();
  }

  const tokenMatch =
    base.match(/(?:^|[_\s-])([A-Z]{2}(?:_[A-Z0-9]+)?)(?:[_\s-]|$)/) ??
    base.match(/\b([A-Z]{2})\b/);
  return tokenMatch?.[1]?.toUpperCase() ?? 'STATE';
}

function parseWorkbookName(fileName: string): ParsedWorkbookName | null {
  const base = stripExtension(fileName);

  const uploadMatch = base.match(UPLOAD_DOC_FILE_NAME_PATTERN);
  if (uploadMatch) {
    const [, stateCode, versionText, dayText, monthText, yearText] = uploadMatch;
    const { parts, segmentCount } = parseVersionParts(versionText);
    return {
      stateCode: stateCode.toUpperCase(),
      versionParts: parts,
      versionSegmentCount: segmentCount,
      fileDate: parseDateParts(yearText, monthText, dayText),
    };
  }

  const legacyMatch = base.match(LEGACY_QLE_FILE_NAME_PATTERN);
  if (legacyMatch) {
    const [, stateCode, versionText, monthText, dayText, yearText] = legacyMatch;
    const { parts, segmentCount } = parseVersionParts(versionText);
    return {
      stateCode: stateCode.toUpperCase(),
      versionParts: parts,
      versionSegmentCount: segmentCount,
      fileDate: parseDateParts(yearText, monthText, dayText),
    };
  }

  return null;
}

function isSameCalendarDay(left: Date | null, right: Date): boolean {
  if (!left) return false;
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function formatFileDate(date: Date): string {
  return [
    String(date.getDate()).padStart(2, '0'),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getFullYear()),
  ].join('-');
}

function formatVersion(parts: [number, number, number], segmentCount: number): string {
  if (segmentCount <= 2 && parts[2] === 0) {
    return `${parts[0]}.${parts[1]}`;
  }
  return `${parts[0]}.${parts[1]}.${parts[2]}`;
}

export function buildVersionedFormattedName(
  fileName: string,
  versionNumber: number,
  date = new Date(),
): string {
  const revisionCount = Math.max(1, Math.floor(versionNumber));
  const parsed = parseWorkbookName(fileName);
  const stateCode = parsed?.stateCode ?? extractStateCode(fileName);

  if (!parsed) {
    const fallbackVersion: [number, number, number] = [1, Math.max(0, revisionCount - 1), 0];
    return `uploadDoc_${stateCode}_v${formatVersion(fallbackVersion, 2)}_${formatFileDate(date)}.xlsx`;
  }

  const [major, minor, patch] = parsed.versionParts;
  const sameDay = isSameCalendarDay(parsed.fileDate, date);
  const nextVersion = sameDay
    ? parsed.versionSegmentCount >= 3
      ? ([major, minor, patch + revisionCount] as [number, number, number])
      : ([major, minor + revisionCount, 0] as [number, number, number])
    : ([major + 1, 0, 0] as [number, number, number]);

  const nextSegmentCount = sameDay ? Math.max(2, parsed.versionSegmentCount) : 3;

  return `uploadDoc_${stateCode}_v${formatVersion(nextVersion, nextSegmentCount)}_${formatFileDate(date)}.xlsx`;
}
