import type { QleCategory, QleDocument, QleEnumRow, QleEvent, QleWorkbookModel } from './types.js';

export type ValidationIssue = {
  path: string;
  message: string;
};

type DocumentLabelReference = {
  en: string;
  es: string;
  reference: string;
};

function pushRequired(issues: ValidationIssue[], path: string, value: string | null | undefined, label: string) {
  if (!value || !value.trim()) {
    issues.push({ path, message: `${label} is required.` });
  }
}

function normaliseText(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function normaliseComparableText(value: string | null | undefined): string {
  return (value ?? '').replace(/\r\n/g, '\n').trim();
}

function buildDocumentReference(eventNumber: number, categoryLabel: string, documentEnum: string): string {
  return `Event ${eventNumber} > ${categoryLabel} > ${documentEnum}`;
}

export function isUnsupportedUiOnlyEvent(enumValue: string | null | undefined, englishLabel: string | null | undefined): boolean {
  const enumText = normaliseText(enumValue);
  const labelText = normaliseText(englishLabel);
  return (
    enumText.includes('unsupported event') ||
    enumText.includes('unsupprted event') ||
    enumText.includes('ui failure if some configuratiion is missing') ||
    enumText.includes('ui failure if some configuration is missing') ||
    labelText.includes('unsupported event')
  );
}

export function isUnsupportedUiOnlyWorkbookEvent(event: QleWorkbookModel['events'][number]): boolean {
  return event.enumRows.some((row) => isUnsupportedUiOnlyEvent(row.enum, row.en));
}

export function validateWorkbookModel(model: QleWorkbookModel): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const documentLabelRegistry = new Map<string, DocumentLabelReference>();

  model.events.forEach((event: QleEvent, eventIndex: number) => {
    if (event.isRemoved) {
      return;
    }

    if (isUnsupportedUiOnlyWorkbookEvent(event)) {
      return;
    }

    if (event.enumRows.length === 0) {
      issues.push({
        path: `events.${eventIndex}.enumRows`,
        message: `Event ${event.eventNumber} needs at least one enum row.`,
      });
    }

    pushRequired(
      issues,
      `events.${eventIndex}.instructionsEn`,
      event.instructionsEn,
      `Event ${event.eventNumber} English instructions`,
    );
    pushRequired(
      issues,
      `events.${eventIndex}.instructionsEs`,
      event.instructionsEs,
      `Event ${event.eventNumber} Spanish instructions`,
    );

    event.enumRows.forEach((row: QleEnumRow, rowIndex: number) => {
      pushRequired(issues, `events.${eventIndex}.enumRows.${rowIndex}.enum`, row.enum, `Event ${event.eventNumber} enum`);
      pushRequired(issues, `events.${eventIndex}.enumRows.${rowIndex}.en`, row.en, `Event ${event.eventNumber} English label`);
      pushRequired(issues, `events.${eventIndex}.enumRows.${rowIndex}.es`, row.es, `Event ${event.eventNumber} Spanish label`);
    });

    event.categories.forEach((category: QleCategory, categoryIndex: number) => {
      if (category.isRemoved) {
        return;
      }

      pushRequired(
        issues,
        `events.${eventIndex}.categories.${categoryIndex}.enum`,
        category.enum,
        `Event ${event.eventNumber} category enum`,
      );
      pushRequired(
        issues,
        `events.${eventIndex}.categories.${categoryIndex}.en`,
        category.en,
        `Event ${event.eventNumber} category English label`,
      );
      pushRequired(
        issues,
        `events.${eventIndex}.categories.${categoryIndex}.es`,
        category.es,
        `Event ${event.eventNumber} category Spanish label`,
      );
      pushRequired(
        issues,
        `events.${eventIndex}.categories.${categoryIndex}.validation`,
        category.validation,
        `Event ${event.eventNumber} category validation rule`,
      );

      if (category.documents.length === 0) {
        issues.push({
          path: `events.${eventIndex}.categories.${categoryIndex}.documents`,
          message: `Category ${category.enum || categoryIndex + 1} in Event ${event.eventNumber} needs at least one document.`,
        });
      }

      category.documents.forEach((document: QleDocument, documentIndex: number) => {
        if (document.isRemoved) {
          return;
        }

        const documentPath = `events.${eventIndex}.categories.${categoryIndex}.documents.${documentIndex}`;
        pushRequired(
          issues,
          `${documentPath}.enum`,
          document.enum,
          `Document enum in Event ${event.eventNumber}`,
        );
        pushRequired(
          issues,
          `${documentPath}.en`,
          document.en,
          `Document English label in Event ${event.eventNumber}`,
        );
        pushRequired(
          issues,
          `${documentPath}.es`,
          document.es,
          `Document Spanish label in Event ${event.eventNumber}`,
        );

        const documentEnumKey = document.enum.trim().toUpperCase();
        if (!documentEnumKey) {
          return;
        }

        const currentReferencePath = buildDocumentReference(
          event.eventNumber,
          category.enum || String(categoryIndex + 1),
          document.enum,
        );
        const currentEnglish = normaliseComparableText(document.en);
        const currentSpanish = normaliseComparableText(document.es);
        const existing = documentLabelRegistry.get(documentEnumKey);

        if (!existing) {
          documentLabelRegistry.set(documentEnumKey, {
            en: currentEnglish,
            es: currentSpanish,
            reference: currentReferencePath,
          });
          return;
        }

        if (existing.en !== currentEnglish) {
          issues.push({
            path: `${documentPath}.en`,
            message: `${currentReferencePath} English label conflicts with ${existing.reference}. Use the same English label in both events.`,
          });
        }

        if (existing.es !== currentSpanish) {
          issues.push({
            path: `${documentPath}.es`,
            message: `${currentReferencePath} Spanish label conflicts with ${existing.reference}. Use the same Spanish label in both events.`,
          });
        }
      });
    });
  });

  return issues;
}

export function collectEventEnums(model: QleWorkbookModel): Array<{ eventNumber: number; enum: string; en: string }> {
  return model.events.flatMap((event: QleEvent) =>
    event.isRemoved || isUnsupportedUiOnlyWorkbookEvent(event)
      ? []
      : event.enumRows.filter((row: QleEnumRow) => !row.isRemoved).map((row: QleEnumRow) => ({
          eventNumber: event.eventNumber,
          enum: row.enum.trim(),
          en: row.en.trim(),
        })),
  );
}
