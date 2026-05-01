function baseWorkbookStem(fileName: string): string {
  return fileName
    .replace(/\.xlsx$/i, '')
    .replace(/_v1\.\d+_\d{4}-\d{2}-\d{2}_formatted$/i, '')
    .replace(/_\d{4}-\d{2}-\d{2}_formatted$/i, '')
    .replace(/_formatted$/i, '');
}

export function buildVersionedFormattedName(
  fileName: string,
  versionNumber: number,
  date = new Date(),
): string {
  const stem = baseWorkbookStem(fileName);
  const dateText = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');

  return `${stem}_v1.${versionNumber}_${dateText}_formatted.xlsx`;
}
