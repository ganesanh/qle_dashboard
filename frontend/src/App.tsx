import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type {
  DbConfig,
  DbConfigResponse,
  DbEventCheckResult,
  DbEventOption,
  DeveloperFlowApproveResult,
  DeveloperFlowCreatePrResult,
  DeveloperFlowRunResult,
  DeveloperFlowStatus,
  DeveloperStageResult,
  DiffEntry,
  DiffSummary,
  JiraCreateResult,
  JiraDraftForm,
  JiraDraft,
  QleCategory,
  QleDocument,
  QleEnumRow,
  QleEvent,
  QleWorkbookModel,
  ReadyForEngineeringResult,
} from '../../shared/types';
import { type ValidationIssue, validateWorkbookModel } from '../../shared/validation';

async function fetchJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const contentType = response.headers.get('content-type') ?? '';
  const raw = await response.text();
  const parseJson = () => {
    if (!raw.trim()) return {} as T;
    return JSON.parse(raw) as T;
  };

  if (!response.ok) {
    if (contentType.includes('application/json')) {
      const payload = JSON.parse(raw) as { error?: string };
      throw new Error(payload.error ?? 'Request failed');
    }
    if (raw.trim().startsWith('<!DOCTYPE') || raw.trim().startsWith('<html')) {
      throw new Error(`Request failed with HTTP ${response.status}. The API returned HTML instead of JSON. Check that the Vite proxy and Express API server are both running.`);
    }
    throw new Error(raw || 'Request failed');
  }

  if (contentType.includes('application/json')) {
    return parseJson();
  }
  if (raw.trim().startsWith('<!DOCTYPE') || raw.trim().startsWith('<html')) {
    throw new Error('The API returned HTML instead of JSON. Check that the Express API server is running on port 8787 and that Vite is proxying /api requests correctly.');
  }
  return parseJson();
}

function cloneModel<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function base64ToBlob(base64: string, type: string) {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type });
}

function createEmptyEvent(nextNumber: number): QleEvent {
  return {
    id: crypto.randomUUID(),
    eventNumber: nextNumber,
    enumRows: [{ id: crypto.randomUUID(), enum: '', en: '', es: '' }],
    instructionsEn: '',
    instructionsEs: '',
    categories: [],
  };
}

function markEventRemoved(event: QleEvent) {
  event.isRemoved = true;
  event.enumRows.forEach((row) => {
    row.isRemoved = true;
  });
  event.categories.forEach((category) => {
    category.isRemoved = true;
    category.documents.forEach((document) => {
      document.isRemoved = true;
    });
  });
}

function markCategoryRemoved(category: QleCategory) {
  category.isRemoved = true;
  category.documents.forEach((document) => {
    document.isRemoved = true;
  });
}

function createEmptyCategory(): QleCategory {
  return {
    id: crypto.randomUUID(),
    enum: '',
    en: '',
    es: '',
    validation: '',
    documents: [],
  };
}

function createEmptyDocument(nextSort: number): QleDocument {
  return {
    id: crypto.randomUUID(),
    enum: '',
    en: '',
    es: '',
    sort: nextSort,
  };
}

function normaliseComparableText(value: string | null | undefined): string {
  return (value ?? '').replace(/\r\n/g, '\n').trim();
}

function buildModelIndex(model: QleWorkbookModel | null) {
  const events = new Map<string, QleEvent>();
  const enumRows = new Map<string, QleEnumRow>();
  const categories = new Map<string, QleCategory>();
  const documents = new Map<string, QleDocument>();

  if (!model) {
    return { events, enumRows, categories, documents };
  }

  model.events.forEach((event) => {
    events.set(event.id, event);
    event.enumRows.forEach((row) => enumRows.set(row.id, row));
    event.categories.forEach((category) => {
      categories.set(category.id, category);
      category.documents.forEach((document) => documents.set(document.id, document));
    });
  });

  return { events, enumRows, categories, documents };
}

function syncDerivedNewFlags(model: QleWorkbookModel, baseline: QleWorkbookModel | null) {
  const baselineIndex = buildModelIndex(baseline);

  model.events.forEach((event, eventIndex) => {
    event.eventNumber = eventIndex + 1;
    const baselineEvent = baselineIndex.events.get(event.id);
    const derivedEventIsNew =
      !baselineEvent ||
      Boolean(baselineEvent.isNew) ||
      normaliseComparableText(event.instructionsEn) !== normaliseComparableText(baselineEvent.instructionsEn) ||
      normaliseComparableText(event.instructionsEs) !== normaliseComparableText(baselineEvent.instructionsEs);
    event.isNew = event.manualIsNew ?? derivedEventIsNew;

    event.enumRows.forEach((row) => {
      const baselineRow = baselineIndex.enumRows.get(row.id);
      const derivedRowIsNew =
        !baselineRow ||
        Boolean(baselineRow.isNew) ||
        normaliseComparableText(row.enum) !== normaliseComparableText(baselineRow.enum) ||
        normaliseComparableText(row.en) !== normaliseComparableText(baselineRow.en) ||
        normaliseComparableText(row.es) !== normaliseComparableText(baselineRow.es);
      row.isNew = row.manualIsNew ?? derivedRowIsNew;
    });

    event.categories.forEach((category) => {
      const baselineCategory = baselineIndex.categories.get(category.id);
      const derivedCategoryIsNew =
        !baselineCategory ||
        Boolean(baselineCategory.isNew) ||
        normaliseComparableText(category.enum) !== normaliseComparableText(baselineCategory.enum) ||
        normaliseComparableText(category.en) !== normaliseComparableText(baselineCategory.en) ||
        normaliseComparableText(category.es) !== normaliseComparableText(baselineCategory.es) ||
        normaliseComparableText(category.validation) !==
          normaliseComparableText(baselineCategory.validation);
      category.isNew = category.manualIsNew ?? derivedCategoryIsNew;

      category.documents.forEach((document, documentIndex) => {
        document.sort = documentIndex + 1;
        const baselineDocument = baselineIndex.documents.get(document.id);
        const derivedDocumentIsNew =
          !baselineDocument ||
          Boolean(baselineDocument.isNew) ||
          normaliseComparableText(document.enum) !== normaliseComparableText(baselineDocument.enum) ||
          normaliseComparableText(document.en) !== normaliseComparableText(baselineDocument.en) ||
          normaliseComparableText(document.es) !== normaliseComparableText(baselineDocument.es) ||
          (document.sort ?? null) !== (baselineDocument.sort ?? null);
        document.isNew = document.manualIsNew ?? derivedDocumentIsNew;
      });
    });
  });
}

function DownloadIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
      <path
        d="M10 3.5V11.5M10 11.5L6.75 8.25M10 11.5L13.25 8.25M4 13.75V14.25C4 14.912 4.263 15.547 4.732 16.015C5.2 16.484 5.835 16.75 6.5 16.75H13.5C14.165 16.75 14.8 16.484 15.268 16.015C15.737 15.547 16 14.912 16 14.25V13.75"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
      <path
        d="M7 7.25V5.75C7 4.7835 7.7835 4 8.75 4H14.25C15.2165 4 16 4.7835 16 5.75V11.25C16 12.2165 15.2165 13 14.25 13H12.75M5.75 7H11.25C12.2165 7 13 7.7835 13 8.75V14.25C13 15.2165 12.2165 16 11.25 16H5.75C4.7835 16 4 15.2165 4 14.25V8.75C4 7.7835 4.7835 7 5.75 7Z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function UndoIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
      <path
        d="M7 6L3.75 9.25L7 12.5M4.25 9.25H11.25C13.8734 9.25 16 11.3766 16 14"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
      <path
        d="M7.5 3.75H12.5M4 5.5H16M14.75 5.5L14.3125 14.25C14.2727 15.0456 13.6159 15.6667 12.8194 15.6667H7.18056C6.3841 15.6667 5.72726 15.0456 5.6875 14.25L5.25 5.5M8.25 8.5V12.5M11.75 8.5V12.5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
      <path
        d="M10 4.25V15.75M4.25 10H15.75"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ClipboardIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
      <rect x="5" y="4.5" width="10" height="12" rx="2.2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8 4.5V3.75C8 3.336 8.336 3 8.75 3H11.25C11.664 3 12 3.336 12 3.75V4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M8 8H12.75M8 11H12.75M8 14H11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function CodeIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
      <path d="M7.5 6L4 10L7.5 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12.5 6L16 10L12.5 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10.75 4.75L9.25 15.25" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function BriefcaseIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
      <rect x="3" y="6" width="14" height="10" rx="2.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M7.25 6V5.5C7.25 4.672 7.922 4 8.75 4H11.25C12.078 4 12.75 4.672 12.75 5.5V6" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3.5 10.5H16.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function ChevronUpIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
      <path
        d="M5.25 12.25L10 7.75L14.75 12.25"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
      <path
        d="M5.25 7.75L10 12.25L14.75 7.75"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
      <path
        d="M5.5 5.5L14.5 14.5M14.5 5.5L5.5 14.5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
      <path
        d="M10 12.75C11.5188 12.75 12.75 11.5188 12.75 10C12.75 8.48122 11.5188 7.25 10 7.25C8.48122 7.25 7.25 8.48122 7.25 10C7.25 11.5188 8.48122 12.75 10 12.75Z"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M16 10.75V9.25L14.5606 8.76063C14.4449 8.37132 14.2895 8.00028 14.0981 7.6525L14.75 6.25L13.75 5.25L12.3475 5.90187C11.9997 5.71048 11.6287 5.55507 11.2394 5.43937L10.75 4H9.25L8.76063 5.43937C8.37132 5.55507 8.00028 5.71048 7.6525 5.90187L6.25 5.25L5.25 6.25L5.90187 7.6525C5.71048 8.00028 5.55507 8.37132 5.43937 8.76063L4 9.25V10.75L5.43937 11.2394C5.55507 11.6287 5.71048 11.9997 5.90187 12.3475L5.25 13.75L6.25 14.75L7.6525 14.0981C8.00028 14.2895 8.37132 14.4449 8.76063 14.5606L9.25 16H10.75L11.2394 14.5606C11.6287 14.4449 11.9997 14.2895 12.3475 14.0981L13.75 14.75L14.75 13.75L14.0981 12.3475C14.2895 11.9997 14.4449 11.6287 14.5606 11.2394L16 10.75Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="spinner-icon">
      <path
        d="M10 3.25C6.27208 3.25 3.25 6.27208 3.25 10"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function createJiraForm(draft: JiraDraft): JiraDraftForm {
  return {
    summary: draft.summary,
    description: draft.description,
    issueType: 'Task',
    assigneeAccountId: '',
    fixVersionName: '',
    labels: 'qle,dashboard',
  };
}

function buildMissingEventDraft(fileName: string, dbCheck: DbEventCheckResult): JiraDraftForm {
  const lines = [
    'Please create the following SEP enrollment events after human review.',
    '',
    `Source workbook: ${fileName}`,
    '',
    ...dbCheck.missing.map(
      (item) => `- Event ${item.eventNumber}: ${item.eventName} -> ${item.englishLabel}`,
    ),
  ];

  return {
    summary: `Create missing SEP enrollment events for ${fileName}`,
    description: lines.join('\n'),
    issueType: 'Task',
    assigneeAccountId: '',
    fixVersionName: '',
    labels: 'qle,event-setup',
  };
}

type ReviewSummaryGroup = {
  eventNumber: number | null;
  title: string;
  items: string[];
};

function pushReviewGroupItem(
  groups: Map<string, ReviewSummaryGroup>,
  eventNumber: number | null,
  item: string,
) {
  const title = eventNumber == null ? 'Other changes' : `Event ${eventNumber}`;
  const key = String(eventNumber ?? 'other');
  const group = groups.get(key) ?? { eventNumber, title, items: [] };
  if (!group.items.includes(item)) {
    group.items.push(item);
  }
  groups.set(key, group);
}

function mergeReviewGroups(
  primary: ReviewSummaryGroup[],
  secondary: ReviewSummaryGroup[],
): ReviewSummaryGroup[] {
  const groups = new Map<string, ReviewSummaryGroup>();

  const appendGroups = (source: ReviewSummaryGroup[]) => {
    source.forEach((group) => {
      const key = String(group.eventNumber ?? 'other');
      const existing = groups.get(key) ?? {
        eventNumber: group.eventNumber,
        title: group.title,
        items: [],
      };
      group.items.forEach((item) => {
        if (!existing.items.includes(item)) {
          existing.items.push(item);
        }
      });
      groups.set(key, existing);
    });
  };

  appendGroups(primary);
  appendGroups(secondary);

  return Array.from(groups.values()).sort((left, right) => {
    if (left.eventNumber == null) return 1;
    if (right.eventNumber == null) return -1;
    return left.eventNumber - right.eventNumber;
  });
}

function buildMarkedNewReviewGroups(
  model: QleWorkbookModel | null,
  originalModel: QleWorkbookModel | null,
): ReviewSummaryGroup[] {
  if (!model) return [];
  const groups = new Map<string, ReviewSummaryGroup>();

  model.events.forEach((event) => {
    event.enumRows.forEach((row) => {
      const originalEvent = originalModel?.events.find((item) => item.id === event.id);
      const existedInOriginal = originalEvent?.enumRows.some((item) => item.id === row.id);
      if (row.isNew && !row.isRemoved && !existedInOriginal) {
        pushReviewGroupItem(
          groups,
          event.eventNumber,
          formatReviewItemWithLabels('Add enum', [{ label: 'Enum', value: row.enum }], row.en, row.es),
        );
      }
    });

    event.categories.forEach((category) => {
      const originalEvent = originalModel?.events.find((item) => item.id === event.id);
      const originalCategory = originalEvent?.categories.find((item) => item.id === category.id);
      const existedInOriginal = Boolean(originalCategory);
      if (category.isNew && !category.isRemoved && !existedInOriginal) {
        pushReviewGroupItem(
          groups,
          event.eventNumber,
          formatReviewItemWithLabels(
            'Add category',
            [{ label: 'Category', value: category.enum }],
            category.en,
            category.es,
          ),
        );
      }

      category.documents.forEach((document) => {
        const documentExistedInOriginal = originalCategory?.documents.some(
          (item) => item.id === document.id,
        );
        if (
          document.isNew &&
          !document.isRemoved &&
          !category.isRemoved &&
          document.enum.trim() &&
          !documentExistedInOriginal
        ) {
          pushReviewGroupItem(
            groups,
            event.eventNumber,
            formatReviewItemWithLabels(
              'Add document',
              [
                { label: 'Category', value: category.enum },
                { label: 'Document', value: document.enum },
              ],
              document.en,
              document.es,
            ),
          );
        }
      });
    });
  });

  return Array.from(groups.values()).sort((left, right) => {
    if (left.eventNumber == null) return 1;
    if (right.eventNumber == null) return -1;
    return left.eventNumber - right.eventNumber;
  });
}

function buildMarkedRemovedReviewGroups(model: QleWorkbookModel | null): ReviewSummaryGroup[] {
  if (!model) return [];
  const groups = new Map<string, ReviewSummaryGroup>();

  model.events.forEach((event) => {
    if (event.isRemoved) {
      pushReviewGroupItem(groups, event.eventNumber, `Remove event: Event ${event.eventNumber}`);
    }

    event.enumRows.forEach((row) => {
      if (row.isRemoved) {
        pushReviewGroupItem(groups, event.eventNumber, `Remove enum: ${row.enum}`);
      }
    });

    event.categories.forEach((category) => {
      const removedDocuments = category.documents.filter(
        (document) => (document.isRemoved || category.isRemoved) && document.enum.trim(),
      );

      if (category.isRemoved) {
        if (removedDocuments.length > 0) {
          pushReviewGroupItem(
            groups,
            event.eventNumber,
            [
              `Remove document from ${category.enum}:`,
              ...removedDocuments.map((document) => `  * ${document.enum}`),
            ].join('\n'),
          );
        } else {
          pushReviewGroupItem(groups, event.eventNumber, `Remove category: ${category.enum}`);
        }
        return;
      }

      removedDocuments.forEach((document) => {
        pushReviewGroupItem(
          groups,
          event.eventNumber,
          `Remove document: ${category.enum} > ${document.enum}`,
        );
      });
    });
  });

  return Array.from(groups.values()).sort((left, right) => {
    if (left.eventNumber == null) return 1;
    if (right.eventNumber == null) return -1;
    return left.eventNumber - right.eventNumber;
  });
}

function shouldIncludeReviewDiffEntry(entry: DiffEntry, model: QleWorkbookModel | null): boolean {
  if (!model) return true;

  if (entry.entity === 'category' && entry.kind === 'removed') {
    const parsed = parseCategoryPath(entry.path);
    const event = model.events.find((item) => item.eventNumber === parsed.eventNumber);
    const category = event?.categories.find((item) => item.enum === parsed.categoryEnum);
    if (category?.isRemoved) return false;
  }

  if (entry.entity === 'document' && entry.kind === 'removed') {
    const parsed = parseDocumentPath(entry.path);
    const event = model.events.find((item) => item.eventNumber === parsed.eventNumber);
    const category = event?.categories.find((item) => item.enum === parsed.categoryEnum);
    const document = category?.documents.find((item) => item.enum === parsed.documentEnum);
    if (category?.isRemoved || document?.isRemoved) return false;
  }

  if (entry.kind !== 'added') return true;

  if (entry.entity === 'enum') {
    const parsed = parseEventEnumPath(entry.path);
    if (parsed.eventNumber == null) return true;
    const event = model.events.find((item) => item.eventNumber === parsed.eventNumber);
    const row = event?.enumRows.find((item) => item.enum === parsed.enumName);
    return Boolean(row?.isNew && !row.isRemoved);
  }

  if (entry.entity === 'category') {
    const parsed = parseCategoryPath(entry.path);
    if (parsed.eventNumber == null) return true;
    const event = model.events.find((item) => item.eventNumber === parsed.eventNumber);
    const category = event?.categories.find((item) => item.enum === parsed.categoryEnum);
    return Boolean(category?.isNew && !category.isRemoved);
  }

  if (entry.entity === 'document') {
    const parsed = parseDocumentPath(entry.path);
    if (parsed.eventNumber == null) return true;
    const event = model.events.find((item) => item.eventNumber === parsed.eventNumber);
    const category = event?.categories.find((item) => item.enum === parsed.categoryEnum);
    const document = category?.documents.find((item) => item.enum === parsed.documentEnum);
    if (category?.isRemoved || document?.isRemoved) {
      return Boolean(document?.enum.trim());
    }
    return Boolean(
      document?.isNew &&
        !document.isRemoved &&
        !category?.isRemoved &&
        document.enum.trim(),
    );
  }

  return true;
}

function filterReviewDiffEntries(entries: DiffEntry[], model: QleWorkbookModel | null): DiffEntry[] {
  return entries.filter((entry) => shouldIncludeReviewDiffEntry(entry, model));
}

function formatReviewItemWithLabels(
  prefix: string,
  lines: { label: string; value: string }[],
  en: string,
  es: string,
) {
  return [
    `${prefix}:`,
    ...lines.map((line) => `  ${line.label}: ${line.value}`),
    `  English label: "${en}"`,
    `  Spanish label: "${es}"`,
  ].join('\n');
}

function shouldRenderReviewItem(item: string): boolean {
  if (!item.startsWith('Add document:')) return true;
  return item
    .split('\n')
    .some((line) => line.trim().startsWith('Document:') && line.split(':').slice(1).join(':').trim());
}

function formatChangedLabelReviewItem(
  prefix: string,
  lines: { label: string; value: string }[],
  before: { en: string; es: string } | null,
  after: { en: string; es: string },
) {
  const changedLines = [
    `${prefix}: ${lines.map((line) => line.value).join(' > ')}`,
  ];

  if (!before || before.en !== after.en) {
    changedLines.push(`  English label: "${after.en}"`);
  }
  if (!before || before.es !== after.es) {
    changedLines.push(`  Spanish label: "${after.es}"`);
  }

  return changedLines.join('\n');
}

function findCategoryForReview(
  model: QleWorkbookModel | null,
  eventNumber: number | null,
  categoryEnum: string,
): QleCategory | null {
  if (!model || eventNumber == null) return null;
  const event = model.events.find((item) => item.eventNumber === eventNumber);
  return event?.categories.find((item) => item.enum === categoryEnum) ?? null;
}

function findDocumentForReview(
  model: QleWorkbookModel | null,
  eventNumber: number | null,
  categoryEnum: string,
  documentEnum: string,
): QleDocument | null {
  const category = findCategoryForReview(model, eventNumber, categoryEnum);
  return category?.documents.find((item) => item.enum === documentEnum) ?? null;
}

function buildLaymanSummary(
  diff: DiffSummary,
  model?: QleWorkbookModel | null,
  originalModel?: QleWorkbookModel | null,
): ReviewSummaryGroup[] {
  const groups = new Map<string, ReviewSummaryGroup>();
  const reviewEntries = filterReviewDiffEntries(diff.entries, model ?? null);

  reviewEntries.slice(0, 10).forEach((entry) => {
    if (entry.entity === 'enum') {
      const parsed = parseEventEnumPath(entry.path);
      const prefix =
        entry.kind === 'added'
          ? 'Add enum'
          : entry.kind === 'changed'
            ? 'Update enum'
            : 'Remove enum';
      const row =
        entry.kind === 'added' || entry.kind === 'changed'
          ? findEnumRowForDiff(model ?? null, entry)
          : null;
      const originalRow =
        entry.kind === 'changed' ? findOriginalEnumRowForDiff(originalModel ?? null, entry) : null;
      pushReviewGroupItem(
        groups,
        parsed.eventNumber,
        row
          ? entry.kind === 'changed'
            ? formatChangedLabelReviewItem(
                prefix,
                [{ label: 'Enum', value: parsed.enumName }],
                originalRow,
                row,
              )
            : formatReviewItemWithLabels(prefix, [{ label: 'Enum', value: parsed.enumName }], row.en, row.es)
          : `${prefix}: ${parsed.enumName}`,
      );
      return;
    }
    if (entry.entity === 'category') {
      const parsed = parseCategoryPath(entry.path);
      const prefix =
        entry.kind === 'added'
          ? 'Add category'
          : entry.kind === 'changed'
            ? 'Update category'
            : 'Remove category';
      const category =
        entry.kind === 'added'
          ? findCategoryForReview(model ?? null, parsed.eventNumber, parsed.categoryEnum)
          : null;
      pushReviewGroupItem(
        groups,
        parsed.eventNumber,
        category
          ? formatReviewItemWithLabels(
              prefix,
              [{ label: 'Category', value: parsed.categoryEnum }],
              category.en,
              category.es,
            )
          : `${prefix}: ${parsed.categoryEnum}`,
      );
      return;
    }
    if (entry.entity === 'document') {
      const parsed = parseDocumentPath(entry.path);
      const category = findCategoryForReview(model ?? null, parsed.eventNumber, parsed.categoryEnum);
      const document =
        entry.kind === 'added' || entry.kind === 'changed'
          ? findDocumentForReview(
              model ?? null,
              parsed.eventNumber,
              parsed.categoryEnum,
              parsed.documentEnum,
            )
          : null;
      const shouldRemoveDocument = entry.kind === 'removed' || Boolean(category?.isRemoved || document?.isRemoved);
      const prefix =
        shouldRemoveDocument
          ? 'Remove document'
          : entry.kind === 'added'
            ? 'Add document'
            : 'Update document';
      if (shouldRemoveDocument) {
        if (parsed.documentEnum.trim()) {
          pushReviewGroupItem(
            groups,
            parsed.eventNumber,
            `${prefix}: ${parsed.categoryEnum} > ${parsed.documentEnum}`,
          );
        }
        return;
      }
      pushReviewGroupItem(
        groups,
        parsed.eventNumber,
        document
          ? formatReviewItemWithLabels(
              prefix,
              [
                { label: 'Category', value: parsed.categoryEnum },
                { label: 'Document', value: parsed.documentEnum },
              ],
              document.en,
              document.es,
            )
          : `${prefix}: ${parsed.categoryEnum} > ${parsed.documentEnum}`,
      );
      return;
    }
    if (entry.entity === 'event') {
      const match = entry.path.match(/^Event\s+(\d+)/i);
      const eventNumber = match ? Number(match[1]) : null;
      const prefix =
        entry.kind === 'added'
          ? 'Add event'
          : entry.kind === 'changed'
            ? 'Update event'
            : 'Remove event';
      pushReviewGroupItem(groups, eventNumber, `${prefix}: ${entry.path}`);
      return;
    }
    pushReviewGroupItem(groups, null, `${entry.kind} ${entry.entity}: ${entry.path}`);
  });

  const diffSummary = Array.from(groups.values()).sort((left, right) => {
    if (left.eventNumber == null) return 1;
    if (right.eventNumber == null) return -1;
    return left.eventNumber - right.eventNumber;
  });

  const markedRemovedGroups = buildMarkedRemovedReviewGroups(model ?? null);
  const markedNewGroups = buildMarkedNewReviewGroups(model ?? null, originalModel ?? null);
  const summary = mergeReviewGroups(mergeReviewGroups(diffSummary, markedRemovedGroups), markedNewGroups);

  if (summary.length === 0) {
    return [{ eventNumber: null, title: 'Changes', items: ['No structural changes were detected yet.'] }];
  }
  return summary;
}

function extractStateFromFileName(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '');
  const match =
    base.match(/(?:^|[_\s-])([A-Z]{2})(?:[_\s-]|$)/) ??
    base.match(/\b([A-Z]{2})\b/);
  return match?.[1] ?? 'State';
}

function buildReviewJiraTitle(fileName: string): string {
  return `Update QLE upload document for ${extractStateFromFileName(fileName)}`;
}

const ACTIVE_FLOW_STORAGE_KEY = 'qle-dashboard-active-flow';
const DB_CONFIG_STORAGE_KEY = 'qle-dashboard-db-config';
function parseEventEnumPath(path: string): { eventNumber: number | null; enumName: string } {
  const match = path.match(/^Event\s+(\d+)\s*>\s*(.+)$/i);
  if (!match) {
    return { eventNumber: null, enumName: path };
  }
  return { eventNumber: Number(match[1]), enumName: match[2].trim() };
}

function findEnumRowForDiff(
  model: QleWorkbookModel | null,
  entry: DiffEntry,
): { eventNumber: number; enumName: string; en: string; es: string } | null {
  if (!model || entry.entity !== 'enum') return null;
  const parsed = parseEventEnumPath(entry.path);
  if (parsed.eventNumber == null) return null;
  const event = model.events.find((item) => item.eventNumber === parsed.eventNumber);
  const row = event?.enumRows.find((item) => item.enum === parsed.enumName);
  if (!event || !row) return null;
  return {
    eventNumber: event.eventNumber,
    enumName: row.enum,
    en: row.en,
    es: row.es,
  };
}

function findOriginalEnumRowForDiff(
  model: QleWorkbookModel | null,
  entry: DiffEntry,
): { en: string; es: string } | null {
  if (!model || entry.entity !== 'enum') return null;
  const parsed = parseEventEnumPath(entry.path);
  if (parsed.eventNumber == null) return null;
  const event = model.events.find((item) => item.eventNumber === parsed.eventNumber);
  const row = event?.enumRows.find((item) => item.enum === parsed.enumName);
  if (!row) return null;
  return { en: row.en, es: row.es };
}

function parseCategoryPath(path: string): { eventNumber: number | null; categoryEnum: string } {
  const match = path.match(/^Event\s+(\d+)\s*>\s*(.+)$/i);
  if (!match) {
    return { eventNumber: null, categoryEnum: path };
  }
  return { eventNumber: Number(match[1]), categoryEnum: match[2].trim() };
}

function parseDocumentPath(
  path: string,
): { eventNumber: number | null; categoryEnum: string; documentEnum: string } {
  const match = path.match(/^Event\s+(\d+)\s*>\s*(.+?)\s*>\s*(.+)$/i);
  if (!match) {
    return { eventNumber: null, categoryEnum: '', documentEnum: path };
  }
  return {
    eventNumber: Number(match[1]),
    categoryEnum: match[2].trim(),
    documentEnum: match[3].trim(),
  };
}

function highlightChangedText(before: string, after: string): ReactNode {
  if (!before || before === after) return after;

  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) {
    prefix += 1;
  }

  let beforeSuffix = before.length - 1;
  let afterSuffix = after.length - 1;
  while (
    beforeSuffix >= prefix &&
    afterSuffix >= prefix &&
    before[beforeSuffix] === after[afterSuffix]
  ) {
    beforeSuffix -= 1;
    afterSuffix -= 1;
  }

  const start = after.slice(0, prefix);
  const changed = after.slice(prefix, afterSuffix + 1);
  const end = after.slice(afterSuffix + 1);

  if (!changed) return after;

  return (
    <>
      {start}
      <span className="detail-highlight">{changed}</span>
      {end}
    </>
  );
}

function formatDetailedChangeText(
  entry: DiffEntry,
  model: QleWorkbookModel | null,
  originalModel: QleWorkbookModel | null,
): string[] {
  if (entry.entity === 'enum') {
    const enumRow = findEnumRowForDiff(model, entry);
    if (!enumRow) return [`[${entry.kind}] enum ${entry.path}`];
    return [
      `Event#: ${enumRow.eventNumber}`,
      `Enum: ${enumRow.enumName}`,
      `English label: "${enumRow.en}"`,
      `Spanish label: "${enumRow.es}"`,
    ];
  }

  if (entry.entity === 'category' && entry.kind === 'changed') {
    const parsed = parseCategoryPath(entry.path);
    const fromMatch = entry.detail.match(/^Changed from (.+)$/);
    const fromValue = fromMatch ? fromMatch[1] : entry.detail;
    const previousCategory = fromValue.replace(/^Event\s+\d+\s*>\s*/, '');
    return [`[Change] Category: Event ${parsed.eventNumber ?? '?'} > ${previousCategory} to ${parsed.categoryEnum}`];
  }

  if (entry.entity === 'document' && entry.kind === 'added') {
    const parsed = parseDocumentPath(entry.path);
    return [
      '[Added] Document:',
      `  Event ${parsed.eventNumber ?? '?'}`,
      `  Category: ${parsed.categoryEnum}`,
      `  Document: ${parsed.documentEnum}`,
    ];
  }

  return [`[${entry.kind}] ${entry.entity} ${entry.path}`];
}

function buildReviewDescription(
  summary: ReviewSummaryGroup[],
  diff: DiffSummary | null,
  model: QleWorkbookModel | null,
  originalModel: QleWorkbookModel | null,
): string {
  const lines = ['Changes To Implement'];
  summary.forEach((group) => {
    lines.push(`${group.title}:`);
    group.items.filter(shouldRenderReviewItem).forEach((item) => {
      const itemLines = item.split('\n');
      lines.push(`- ${itemLines[0]}`);
      itemLines.slice(1).forEach((line) => lines.push(line));
    });
  });
  return lines.join('\n');
}

function renderDetailedChange(
  entry: DiffEntry,
  model: QleWorkbookModel | null,
  originalModel: QleWorkbookModel | null,
): ReactNode {
  if (entry.entity === 'enum') {
    const enumRow = findEnumRowForDiff(model, entry);
    const originalEnumRow = entry.kind === 'changed' ? findOriginalEnumRowForDiff(originalModel, entry) : null;
    if (!enumRow) {
      return `[${entry.kind}] enum ${entry.path}`;
    }
    return (
      <div className="detail-card">
        <div className="detail-line">
          Event#: {enumRow.eventNumber}
        </div>
        <div className="detail-line">
          Enum: {enumRow.enumName}
        </div>
        <div className="detail-line">
          English label: "
          {originalEnumRow ? highlightChangedText(originalEnumRow.en, enumRow.en) : enumRow.en}"
        </div>
        <div className="detail-line">
          Spanish label: "
          {originalEnumRow ? highlightChangedText(originalEnumRow.es, enumRow.es) : enumRow.es}"
        </div>
      </div>
    );
  }

  if (entry.entity === 'category' && entry.kind === 'changed') {
    const parsed = parseCategoryPath(entry.path);
    const fromMatch = entry.detail.match(/^Changed from (.+)$/);
    const fromValue = fromMatch ? fromMatch[1] : entry.detail;
    const previousCategory = fromValue.replace(/^Event\s+\d+\s*>\s*/, '');
    return (
      <div className="detail-card">
        <div className="detail-line">
          [Change] Category: Event {parsed.eventNumber ?? '?'} &gt; {previousCategory} to{' '}
          <span className="detail-highlight">{parsed.categoryEnum}</span>
        </div>
      </div>
    );
  }

  if (entry.entity === 'document' && entry.kind === 'added') {
    const parsed = parseDocumentPath(entry.path);
    return (
      <div className="detail-card">
        <div className="detail-line">[Added] Document:</div>
        <div className="detail-line detail-indent">Event {parsed.eventNumber ?? '?'}</div>
        <div className="detail-line detail-indent">
          Category: {parsed.categoryEnum}
        </div>
        <div className="detail-line detail-indent">
          Document: {parsed.documentEnum}
        </div>
      </div>
    );
  }

  return `[${entry.kind}] ${entry.entity} ${entry.path}`;
}

export function App() {
  const [dbConfigModalOpen, setDbConfigModalOpen] = useState(false);
  const [dbConfigForm, setDbConfigForm] = useState<DbConfig>({
    host: '',
    port: 5444,
    database: '',
    user: '',
    password: '',
    schema: 'public',
    ssl: false,
  });
  const [dbConfigSaving, setDbConfigSaving] = useState(false);
  const [original, setOriginal] = useState<QleWorkbookModel | null>(null);
  const [downloadedModel, setDownloadedModel] = useState<QleWorkbookModel | null>(null);
  const [edited, setEdited] = useState<QleWorkbookModel | null>(null);
  const [stagedFormattedModel, setStagedFormattedModel] = useState<QleWorkbookModel | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [diff, setDiff] = useState<DiffSummary | null>(null);
  const [jiraDraft, setJiraDraft] = useState<JiraDraft | null>(null);
  const [jiraForm, setJiraForm] = useState<JiraDraftForm | null>(null);
  const [missingJiraForm, setMissingJiraForm] = useState<JiraDraftForm | null>(null);
  const [validationIssues, setValidationIssues] = useState<ValidationIssue[]>([]);
  const [dbCheck, setDbCheck] = useState<DbEventCheckResult | null>(null);
  const [jiraModalOpen, setJiraModalOpen] = useState(false);
  const [createMissingEventJira, setCreateMissingEventJira] = useState(true);
  const [jiraResults, setJiraResults] = useState<JiraCreateResult[]>([]);
  const [eventOptions, setEventOptions] = useState<DbEventOption[]>([]);
  const [eventOptionsHelp, setEventOptionsHelp] = useState<string>('');
  const [activeEnumRowId, setActiveEnumRowId] = useState<string | null>(null);
  const [enumQuery, setEnumQuery] = useState<string>('');
  const [eventOptionsLoading, setEventOptionsLoading] = useState(false);
  const [exportVersion, setExportVersion] = useState(1);
  const [readyModalOpen, setReadyModalOpen] = useState(false);
  const [readyJiraKey, setReadyJiraKey] = useState('');
  const [readyResult, setReadyResult] = useState<ReadyForEngineeringResult | null>(null);
  const [jiraCreateStatus, setJiraCreateStatus] = useState<string>('');
  const [jiraCreateError, setJiraCreateError] = useState<string>('');
  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const [reviewSummary, setReviewSummary] = useState<ReviewSummaryGroup[]>([]);
  const [reviewDownloadUrl, setReviewDownloadUrl] = useState<string>('');
  const [reviewDownloadName, setReviewDownloadName] = useState<string>('');
  const [reviewJiraTitle, setReviewJiraTitle] = useState<string>('');
  const [history, setHistory] = useState<
    Array<{ edited: QleWorkbookModel; selectedEventId: string | null }>
  >([]);
  const [activeFlow, setActiveFlow] = useState<'pm' | 'developer' | 'agent'>(() => {
    if (typeof window === 'undefined') return 'pm';
    const stored = window.localStorage.getItem(ACTIVE_FLOW_STORAGE_KEY);
    return stored === 'developer' ? 'developer' : 'pm';
  });
  const [sidebarExpanded, setSidebarExpanded] = useState(true);
  const [theme, setTheme] = useState<'classic' | 'soft'>('classic');
  const [pmWorkspaceCollapsed, setPmWorkspaceCollapsed] = useState(false);
  const [developerWorkspaceCollapsed, setDeveloperWorkspaceCollapsed] = useState(false);
  const [developerJiraKey, setDeveloperJiraKey] = useState('');
  const [developerWorkbookName, setDeveloperWorkbookName] = useState('');
  const [developerWorkbookFile, setDeveloperWorkbookFile] = useState<File | null>(null);
  const [developerStageResult, setDeveloperStageResult] = useState<DeveloperStageResult | null>(null);
  const [developerRunId, setDeveloperRunId] = useState<string | null>(null);
  const [developerRunStatus, setDeveloperRunStatus] = useState<DeveloperFlowStatus | null>(null);
  const [developerApprovalCaptured, setDeveloperApprovalCaptured] = useState(false);
  const [developerPendingAction, setDeveloperPendingAction] = useState<'run' | 'approve' | 'createPr' | null>(null);
  const [developerReviewChangesCollapsed, setDeveloperReviewChangesCollapsed] = useState(false);
  const [developerUiCodeReviewCollapsed, setDeveloperUiCodeReviewCollapsed] = useState(true);
  const [developerPrSummaryCollapsed, setDeveloperPrSummaryCollapsed] = useState(true);
  const [status, setStatus] = useState<string>('Upload a workbook to get started.');
  const [busy, setBusy] = useState(false);
  const [lastAutosavedAt, setLastAutosavedAt] = useState<string | null>(null);
  const lastScrollYRef = useRef(0);
  const scrollFrameRef = useRef<number | null>(null);
  const collapseAnchorRef = useRef(0);
  const expandAnchorRef = useRef(0);

  const selectedEvent = useMemo(
    () => edited?.events.find((event) => event.id === selectedEventId) ?? null,
    [edited, selectedEventId],
  );
  const dbConnectionSummary = useMemo(() => {
    if (!dbConfigForm.host.trim() || !dbConfigForm.database.trim()) return '';
    const schema = dbConfigForm.schema.trim() || 'public';
    return `${dbConfigForm.host}:${dbConfigForm.port}/${dbConfigForm.database} (schema: ${schema}${dbConfigForm.ssl ? ', SSL' : ''})`;
  }, [dbConfigForm]);

  const dbSettingsTooltip = dbConnectionSummary
    ? `Configure PM database connection. Connected this session to ${dbConnectionSummary}.`
    : 'Configure PM database connection for event validation and lookup.';
  const hasUnsavedChanges = useMemo(() => {
    if (!downloadedModel || !edited) return false;
    return JSON.stringify(downloadedModel) !== JSON.stringify(edited);
  }, [downloadedModel, edited]);
  const developerExecutionItems = useMemo(
    () =>
      developerRunStatus?.steps ?? [
        {
          label: 'Request intake',
          state:
            developerJiraKey.trim() && developerWorkbookName
              ? 'Ready'
              : developerJiraKey.trim() || developerWorkbookName
                ? 'In progress'
                : 'Idle',
          detail:
            developerJiraKey.trim() && developerWorkbookName
              ? 'Jira key and workbook are ready.'
              : 'Provide the Jira key and reviewed workbook.',
        },
        {
          label: 'Read Jira and fetch workbook',
          state: developerStageResult ? 'Prepared' : 'Idle',
          detail: developerStageResult
            ? 'Expected output: Jira is reachable, workbook source is chosen, and the isolated worktree is ready.'
            : 'Expected output: Jira is checked, workbook source is resolved, and the worktree is prepared.',
        },
        {
          label: 'Create branch',
          state: developerStageResult ? 'Queued' : 'Idle',
          detail: developerStageResult
            ? 'Expected output: a clean isolated worktree is ready for implementation.'
            : 'This starts after Jira context and workbook source are confirmed.',
        },
        {
          label: 'Run skill and review changes',
          state: developerStageResult ? 'Queued' : 'Idle',
          detail: developerStageResult
            ? 'Developer Dashboard will run Cursor CLI, inspect changes, and return a diff summary.'
            : 'This step starts after you click Run Implementation Flow.',
        },
        {
          label: 'Start preview server',
          state: developerRunStatus?.previewUrl ? 'Completed' : developerStageResult ? 'Queued' : 'Idle',
          detail: developerRunStatus?.previewUrl
            ? `Preview is ready at ${developerRunStatus.previewUrl}.`
            : developerStageResult
              ? 'The isolated worktree preview will start after the skill produces changes.'
              : 'This starts after the skill run completes.',
        },
        {
          label: 'Approval and push',
          state: developerApprovalCaptured ? 'Approved' : developerStageResult ? 'Awaiting approval' : 'Idle',
          detail: developerApprovalCaptured
            ? 'Approval captured. Commit and push can follow.'
            : 'Approve only after the generated changes are verified.',
        },
        {
          label: 'Create PR',
          state: developerRunStatus?.prCreateUrl ? 'Completed' : developerApprovalCaptured ? 'Ready' : 'Idle',
          detail: developerRunStatus?.prCreateUrl
            ? 'UI code review and PR summary are ready for the PR page.'
            : developerApprovalCaptured
              ? 'Run UI code review and PR summary, then open the PR page.'
              : 'Available after the branch is pushed.',
        },
      ],
    [
      developerApprovalCaptured,
      developerJiraKey,
      developerRunStatus,
      developerStageResult,
      developerWorkbookName,
    ],
  );

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(ACTIVE_FLOW_STORAGE_KEY, activeFlow);
    }
  }, [activeFlow]);

  useEffect(() => {
    let cancelled = false;

    const loadDbConfig = async () => {
      const savedRaw =
        typeof window !== 'undefined' ? window.localStorage.getItem(DB_CONFIG_STORAGE_KEY) : null;

      if (savedRaw) {
        try {
          const savedConfig = JSON.parse(savedRaw) as DbConfig;
          const payload = await fetchJson<DbConfigResponse>('/api/db/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ config: savedConfig }),
          });
          if (!cancelled) {
            setDbConfigForm(payload.config);
          }
          return;
        } catch {
          if (typeof window !== 'undefined') {
            window.localStorage.removeItem(DB_CONFIG_STORAGE_KEY);
          }
        }
      }

      try {
        const payload = await fetchJson<DbConfigResponse>('/api/db/config');
        if (!cancelled) {
          setDbConfigForm(payload.config);
        }
      } catch {
        // keep defaults
      }
    };

    void loadDbConfig();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (activeFlow !== 'pm') {
      return undefined;
    }
    const handleScroll = () => {
      if (scrollFrameRef.current != null) return;
      scrollFrameRef.current = window.requestAnimationFrame(() => {
        const currentY = window.scrollY;
        const delta = currentY - lastScrollYRef.current;
        if (!pmWorkspaceCollapsed) {
          if (delta > 18 && currentY > 180) {
            if (collapseAnchorRef.current === 0) collapseAnchorRef.current = currentY;
            if (currentY - collapseAnchorRef.current > 72) {
              setPmWorkspaceCollapsed(true);
              expandAnchorRef.current = currentY;
              collapseAnchorRef.current = 0;
            }
          } else {
            collapseAnchorRef.current = 0;
          }
        } else {
          if (currentY < 120) {
            setPmWorkspaceCollapsed(false);
            collapseAnchorRef.current = currentY;
            expandAnchorRef.current = 0;
          } else if (delta < -18) {
            if (expandAnchorRef.current === 0) expandAnchorRef.current = currentY;
            if (expandAnchorRef.current - currentY > 96) {
              setPmWorkspaceCollapsed(false);
              collapseAnchorRef.current = currentY;
              expandAnchorRef.current = 0;
            }
          } else {
            expandAnchorRef.current = currentY;
          }
        }
        lastScrollYRef.current = currentY;
        scrollFrameRef.current = null;
      });
    };
    lastScrollYRef.current = window.scrollY;
    collapseAnchorRef.current = window.scrollY;
    expandAnchorRef.current = window.scrollY;
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleScroll);
      if (scrollFrameRef.current != null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
        scrollFrameRef.current = null;
      }
    };
  }, [activeFlow, pmWorkspaceCollapsed]);

  useEffect(() => {
    if (!developerRunId) {
      return undefined;
    }

    let cancelled = false;
    const poll = async () => {
      try {
        const payload = await fetchJson<DeveloperFlowStatus>(
          `/api/developer-flow/status/${developerRunId}`,
        );
        if (cancelled) return;
      setDeveloperRunStatus(payload);
      if (payload.overallState === 'running') {
        const runningStep =
          payload.steps.find((step) => step.state === 'Running') ??
          payload.steps.find((step) => step.state === 'Prepared');
          setStatus(
            runningStep
              ? `Developer Dashboard: ${runningStep.detail}`
              : 'Developer Dashboard is running.',
          );
        }
        if (payload.overallState === 'failed') {
          setBusy(false);
          setDeveloperPendingAction(null);
          setStatus(`Developer Dashboard failed. ${payload.error ?? 'Check execution details.'}`);
          return;
        }
        if (payload.overallState === 'awaiting_approval') {
          setBusy(false);
          setDeveloperPendingAction(null);
          setStatus('Developer Dashboard is ready for review. Check changed files before approving.');
          return;
        }
        if (payload.overallState === 'completed') {
          setBusy(false);
          setDeveloperPendingAction(null);
          setStatus(`Developer Dashboard completed on branch ${payload.branchName}.`);
          return;
        }
        window.setTimeout(poll, 2000);
      } catch (error) {
        if (cancelled) return;
        setBusy(false);
        setStatus(
          `Developer Dashboard polling failed. ${
            error instanceof Error ? error.message : 'Unknown error.'
          }`,
        );
      }
    };

    void poll();
    return () => {
      cancelled = true;
    };
  }, [developerRunId]);

  function applyValidationState(model: QleWorkbookModel, baseStatus?: string): ValidationIssue[] {
    const issues = validateWorkbookModel(model);
    setValidationIssues(issues);
    if (issues.length > 0) {
      setStatus(`${issues.length} required field${issues.length === 1 ? '' : 's'} still need attention.`);
    } else if (baseStatus) {
      setStatus(baseStatus);
    }
    return issues;
  }

  function noteAutosave() {
    const timestamp = new Date().toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
    });
    setLastAutosavedAt(timestamp);
    if (edited) {
      const issues = validateWorkbookModel(edited);
      setValidationIssues(issues);
      if (issues.length > 0) {
        setStatus(`${issues.length} required field${issues.length === 1 ? '' : 's'} still need attention.`);
        return;
      }
    }
    setStatus(`Draft auto-saved at ${timestamp}.`);
  }

  async function loadEventOptions(query = '') {
    setEnumQuery(query);
    setEventOptionsLoading(true);
    const payload = await fetchJson<{
      configured: boolean;
      options: DbEventOption[];
      errors: string[];
    }>(`/api/db/event-options?q=${encodeURIComponent(query)}`);
    setEventOptions(payload.options);
    setEventOptionsHelp(
      payload.errors[0] ??
        (payload.configured ? 'Choose an existing event name from the database.' : 'Database autocomplete is not configured.'),
    );
    setEventOptionsLoading(false);
  }

  const filteredEventOptions = useMemo(() => {
    const query = enumQuery.trim().toLowerCase();
    if (!query) return eventOptions;
    return eventOptions.filter(
      (option) =>
        option.eventName.toLowerCase().includes(query) ||
        option.eventLabel.toLowerCase().includes(query),
    );
  }, [enumQuery, eventOptions]);

  function ensureValidEdited(actionLabel: string): boolean {
    if (!edited) return false;
    const issues = validateWorkbookModel(edited);
    setValidationIssues(issues);
    if (issues.length > 0) {
      setStatus(`${actionLabel} blocked. Complete all required fields first.`);
      return false;
    }
    return true;
  }

  async function handleImport(file: File) {
    setBusy(true);
    setStatus(`Importing ${file.name}...`);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const model = await fetchJson<QleWorkbookModel>('/api/import-workbook', {
        method: 'POST',
        body: formData,
      });
      setOriginal(model);
      setDownloadedModel(cloneModel(model));
      setEdited(cloneModel(model));
      setSelectedEventId(model.events[0]?.id ?? null);
      setDiff(null);
      setJiraDraft(null);
      setJiraForm(null);
      setMissingJiraForm(null);
      setDbCheck(null);
      setJiraResults([]);
      setReadyResult(null);
      setReadyJiraKey('');
      setJiraCreateStatus('');
      setJiraCreateError('');
      setReviewModalOpen(false);
      setReviewSummary([]);
      setReviewDownloadUrl('');
      setReviewDownloadName('');
      setReviewJiraTitle('');
      setExportVersion(1);
      setHistory([]);
      applyValidationState(model, `Imported ${model.events.length} events from ${file.name}.`);
    } finally {
      setBusy(false);
    }
  }

  async function handleFormatFirst(file: File) {
    setBusy(true);
    setStatus(`Formatting ${file.name}...`);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const payload = await fetchJson<{
        fileName: string;
        savedPath: string;
        workbookBase64: string;
        model: QleWorkbookModel;
      }>('/api/format-unformatted-workbook', {
        method: 'POST',
        body: formData,
      });
      const blob = base64ToBlob(
        payload.workbookBase64,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      downloadBlob(blob, payload.fileName);
      setStagedFormattedModel(payload.model);
      setOriginal(cloneModel(payload.model));
      setDownloadedModel(cloneModel(payload.model));
      setEdited(cloneModel(payload.model));
      setSelectedEventId(payload.model.events[0]?.id ?? null);
      setDiff(null);
      setJiraDraft(null);
      setJiraForm(null);
      setMissingJiraForm(null);
      setDbCheck(null);
      setJiraResults([]);
      setReadyResult(null);
      setReadyJiraKey('');
      setJiraCreateStatus('');
      setJiraCreateError('');
      setReviewModalOpen(false);
      setReviewSummary([]);
      setReviewDownloadUrl('');
      setReviewDownloadName('');
      setReviewJiraTitle('');
      setExportVersion(1);
      setHistory([]);
      applyValidationState(
        payload.model,
        `Formatted ${file.name}, saved ${payload.fileName} to ${payload.savedPath}, and loaded ${payload.model.events.length} events into the dashboard.`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Formatting failed.';
      setStatus(`Formatting failed for ${file.name}. ${message}`);
    } finally {
      setBusy(false);
    }
  }

  function loadStagedFormattedModel() {
    if (!stagedFormattedModel) return;
    setOriginal(cloneModel(stagedFormattedModel));
    setDownloadedModel(cloneModel(stagedFormattedModel));
    setEdited(cloneModel(stagedFormattedModel));
    setSelectedEventId(stagedFormattedModel.events[0]?.id ?? null);
    setDiff(null);
    setJiraDraft(null);
    setJiraForm(null);
    setMissingJiraForm(null);
    setDbCheck(null);
    setJiraResults([]);
    setReadyResult(null);
    setReadyJiraKey('');
    setJiraCreateStatus('');
    setJiraCreateError('');
    setReviewModalOpen(false);
    setReviewSummary([]);
    setReviewDownloadUrl('');
    setReviewDownloadName('');
    setReviewJiraTitle('');
    setExportVersion(1);
    setHistory([]);
    applyValidationState(
      stagedFormattedModel,
      `Loaded formatted workbook for editing: ${stagedFormattedModel.fileName}`,
    );
  }

  function mutateEdited(mutator: (draft: QleWorkbookModel) => void) {
    setEdited((current) => {
      if (!current) return current;
      setHistory((existing) =>
        [...existing, { edited: cloneModel(current), selectedEventId }].slice(-50),
      );
      const next = cloneModel(current);
      mutator(next);
      syncDerivedNewFlags(next, downloadedModel ?? original ?? null);
      setDiff(null);
      setJiraDraft(null);
      setDbCheck(null);
      setJiraResults([]);
      setReadyResult(null);
      setJiraCreateStatus('');
      setJiraCreateError('');
      setReviewModalOpen(false);
      applyValidationState(next, 'Changes in progress. Save updates to download the refreshed workbook.');
      return next;
    });
  }

  function handleUndo() {
    setHistory((existing) => {
      const previous = existing[existing.length - 1];
      if (!previous) {
        setStatus('Nothing to undo.');
        return existing;
      }

      setEdited(cloneModel(previous.edited));
      setSelectedEventId(previous.selectedEventId);
      setDiff(null);
      setJiraDraft(null);
      setJiraForm(null);
      setMissingJiraForm(null);
      setDbCheck(null);
      setJiraResults([]);
      setReadyResult(null);
      setJiraCreateStatus('');
      setJiraCreateError('');
      setReviewModalOpen(false);
      applyValidationState(previous.edited, 'Undid the last change.');
      return existing.slice(0, -1);
    });
  }

  async function refreshDiff() {
    if (!original || !edited) return;
    setBusy(true);
    try {
      const summary = await fetchJson<DiffSummary>('/api/diff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ original, edited }),
      });
      setDiff(summary);
      setStatus(`Computed ${summary.counts.changes} changes.`);
    } finally {
      setBusy(false);
    }
  }

  function buildCurrentWorkbookSnapshot(): QleWorkbookModel | null {
    if (!edited) return null;
    const snapshot = cloneModel(edited);
    syncDerivedNewFlags(snapshot, downloadedModel ?? original ?? null);
    return snapshot;
  }

  async function handleSaveWorkbook() {
    const snapshot = buildCurrentWorkbookSnapshot();
    if (!snapshot) return;
    const issues = validateWorkbookModel(snapshot);
    setValidationIssues(issues);
    if (issues.length > 0) {
      setStatus('Download blocked. Complete all required fields first.');
      return;
    }
    setBusy(true);
    setStatus('Saving updates and generating the formatted workbook...');
    try {
      const response = await fetch('/api/export-workbook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: snapshot, versionNumber: exportVersion }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({ error: 'Export failed' }));
        throw new Error(payload.error ?? 'Export failed');
      }
      const blob = await response.blob();
      const match = /filename="([^"]+)"/i.exec(response.headers.get('Content-Disposition') ?? '');
      const savedPath = response.headers.get('X-Saved-Path');
      downloadBlob(blob, match?.[1] ?? snapshot.fileName);
      setEdited(snapshot);
      setDownloadedModel(cloneModel(snapshot));
      setLastAutosavedAt(null);
      setExportVersion((current) => current + 1);
      setHistory([]);
      applyValidationState(
        snapshot,
        `Workbook updated and downloaded${savedPath ? `, and saved to ${savedPath}` : ''}. You can keep editing or generate a bundle.`,
      );
    } finally {
      setBusy(false);
    }
  }

  function clearDraft() {
    setOriginal(null);
    setDownloadedModel(null);
    setEdited(null);
    setSelectedEventId(null);
    setDiff(null);
    setJiraDraft(null);
    setStagedFormattedModel(null);
    setJiraForm(null);
    setMissingJiraForm(null);
    setValidationIssues([]);
    setDbCheck(null);
    setJiraResults([]);
    setJiraModalOpen(false);
    setReadyModalOpen(false);
    setReadyResult(null);
    setReadyJiraKey('');
    setJiraCreateStatus('');
    setJiraCreateError('');
    setReviewModalOpen(false);
    setReviewSummary([]);
    setReviewDownloadUrl('');
    setReviewDownloadName('');
    setReviewJiraTitle('');
    setExportVersion(1);
    setHistory([]);
    setStatus('Cleared the current draft. Upload a workbook to get started.');
  }

  function handleDeveloperWorkbookSelect(file: File | null) {
    if (!file) return;
    setActiveFlow('developer');
    setDeveloperWorkbookFile(file);
    setDeveloperWorkbookName(file.name);
    resetDeveloperFlowViewState();
    const detectedState = extractStateFromFileName(file.name);
    setStatus(
      detectedState !== 'State'
        ? `Attached developer workbook ${file.name} (detected state: ${detectedState}).`
        : `Attached developer workbook ${file.name}.`,
    );
  }

  function resetDeveloperFlowViewState() {
    setDeveloperStageResult(null);
    setDeveloperRunId(null);
    setDeveloperRunStatus(null);
    setDeveloperApprovalCaptured(false);
    setDeveloperPendingAction(null);
    setDeveloperReviewChangesCollapsed(false);
    setDeveloperUiCodeReviewCollapsed(true);
    setDeveloperPrSummaryCollapsed(true);
  }

  async function handleRunDeveloperFlow() {
    if (!developerJiraKey.trim()) {
      setStatus('Enter a Jira key to run Developer Dashboard.');
      return;
    }
    if (!developerWorkbookFile) {
      setStatus('Upload a workbook to run Developer Dashboard.');
      return;
    }

    resetDeveloperFlowViewState();
    setBusy(true);
    setDeveloperPendingAction('run');
    setActiveFlow('developer');
    setStatus(`Running Developer Dashboard for ${developerJiraKey.trim()}...`);
    try {
      const formData = new FormData();
      formData.append('jiraKey', developerJiraKey.trim());
      formData.append('file', developerWorkbookFile);
      const payload = await fetchJson<DeveloperFlowRunResult>('/api/developer-flow/run', {
        method: 'POST',
        body: formData,
      });
      setDeveloperStageResult(payload.stage);
      setDeveloperRunId(payload.runId);
      setDeveloperRunStatus(null);
      setDeveloperApprovalCaptured(false);
      setStatus(`Developer Dashboard started for ${payload.stage.jiraKey}.`);
    } catch (error) {
      setDeveloperPendingAction(null);
      const message = error instanceof Error ? error.message : 'Developer Dashboard run failed.';
      setStatus(`Developer Dashboard failed to start. ${message}`);
    } finally {
      // keep busy=true while polling handles the live run
    }
  }

  async function handleApproveDeveloperFlow() {
    if (!developerRunId) {
      setStatus('Run Implementation Flow before approving.');
      return;
    }
    setBusy(true);
    setDeveloperPendingAction('approve');
    setActiveFlow('developer');
    setStatus('Approving Developer Dashboard and pushing branch...');
    try {
      const payload = await fetchJson<DeveloperFlowApproveResult>('/api/developer-flow/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: developerRunId }),
      });
      setDeveloperApprovalCaptured(true);
      setStatus(
        `Developer Dashboard pushed ${payload.branchName}${
          payload.commitSha ? ` at ${payload.commitSha.slice(0, 7)}` : ''
        }. Create PR when you're ready to run the review and summary skills.`,
      );
      if (developerRunId) {
        const refreshed = await fetchJson<DeveloperFlowStatus>(
          `/api/developer-flow/status/${developerRunId}`,
        );
        setDeveloperRunStatus(refreshed);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Approval failed.';
      setStatus(`Developer Dashboard approval failed. ${message}`);
    } finally {
      setDeveloperPendingAction(null);
      setBusy(false);
    }
  }

  async function handleCreateDeveloperPr() {
    if (!developerRunId) {
      setStatus('Run Implementation Flow before creating the PR.');
      return;
    }

    setBusy(true);
    setDeveloperPendingAction('createPr');
    setActiveFlow('developer');
    setDeveloperRunStatus((current) =>
      current
        ? {
            ...current,
            overallState: 'running',
            steps: current.steps.map((step) =>
              step.key === 'createPr'
                ? {
                    ...step,
                    state: 'Running',
                    detail: 'Running ui-code-review and pr-summary, then preparing the Create PR page.',
                  }
                : step,
            ),
          }
        : current,
    );
    setStatus('Preparing Create PR handoff...');

    try {
      const payload = await fetchJson<DeveloperFlowCreatePrResult>('/api/developer-flow/create-pr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: developerRunId }),
      });
      window.open(payload.prCreateUrl, '_blank', 'noopener,noreferrer');
      setStatus('Create PR is ready. The PR page opened in a new tab.');
      const refreshed = await fetchJson<DeveloperFlowStatus>(
        `/api/developer-flow/status/${developerRunId}`,
      );
      setDeveloperRunStatus(refreshed);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Create PR failed.';
      setStatus(`Developer Dashboard Create PR failed. ${message}`);
      if (developerRunId) {
        try {
          const refreshed = await fetchJson<DeveloperFlowStatus>(
            `/api/developer-flow/status/${developerRunId}`,
          );
          setDeveloperRunStatus(refreshed);
        } catch {
          // Ignore refresh errors after the main request fails.
        }
      }
    } finally {
      setDeveloperPendingAction(null);
      setBusy(false);
    }
  }

  async function handleSaveDbConfig() {
    setDbConfigSaving(true);
    try {
      const payload = await fetchJson<DbConfigResponse>('/api/db/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: dbConfigForm }),
      });
      setDbConfigForm(payload.config);
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(DB_CONFIG_STORAGE_KEY, JSON.stringify(payload.config));
      }
      setDbConfigModalOpen(false);
      setStatus(`PM Dashboard database settings saved for ${payload.config.host}:${payload.config.port}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save database settings.';
      setStatus(`PM Dashboard database settings failed. ${message}`);
    } finally {
      setDbConfigSaving(false);
    }
  }

  async function handleBundle() {
    if (!original || !edited) return;
    if (!ensureValidEdited('Bundle generation')) return;
    setBusy(true);
    setStatus('Generating implementation bundle...');
    try {
      const payload = await fetchJson<{ bundleDir: string }>('/api/bundles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ original, edited, versionNumber: exportVersion }),
      });
      setExportVersion((current) => current + 1);
      setStatus(`Bundle created in ${payload.bundleDir}.`);
    } finally {
      setBusy(false);
    }
  }

  async function handleJiraDraft(summaryOverride?: string) {
    if (!original || !edited) return;
    if (!ensureValidEdited('Jira drafting')) return;
    setBusy(true);
    try {
      const [payload, dbPayload] = await Promise.all([
        fetchJson<JiraDraft>('/api/jira/draft', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ original, edited }),
        }),
        fetchJson<DbEventCheckResult>('/api/db/check-events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: edited }),
        }),
      ]);
      setJiraDraft(payload);
      const nextForm = createJiraForm(payload);
      if (summaryOverride?.trim()) {
        nextForm.summary = summaryOverride.trim();
      }
      setJiraForm(nextForm);
      setDbCheck(dbPayload);
      setMissingJiraForm(dbPayload.missing.length > 0 ? buildMissingEventDraft(edited.fileName, dbPayload) : null);
      setCreateMissingEventJira(dbPayload.missing.length > 0);
      setJiraResults([]);
      setJiraCreateStatus('');
      setJiraCreateError('');
      setJiraModalOpen(true);
      setStatus('Generated Jira draft.');
    } finally {
      setBusy(false);
    }
  }

  async function handleOpenReviewJiraForm() {
    if (!original || !edited) return;
    const fallbackUrl = 'https://jira.getinsured.com/secure/CreateIssue!default.jspa';
    const pendingWindow = window.open(fallbackUrl, '_blank');
    const description = buildReviewDescription(reviewSummary, diff, edited, original);
    setBusy(true);
    try {
      const payload = await fetchJson<{ url: string }>('/api/jira/create-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          summary: reviewJiraTitle.trim() || buildReviewJiraTitle(edited.fileName),
          description,
          issueType: 'Task',
        }),
      });
      if (pendingWindow) {
        pendingWindow.location.href = payload.url;
      } else {
        window.open(payload.url, '_blank');
      }
      setReviewModalOpen(false);
      setStatus('Opened Jira create page in a new tab.');
    } catch (error) {
      if (pendingWindow) {
        pendingWindow.location.href = fallbackUrl;
      } else {
        window.open(fallbackUrl, '_blank');
      }
      const message = error instanceof Error ? error.message : 'Failed to build Jira create link.';
      setStatus(`Opened Jira fallback create page. ${message}`);
      setReviewModalOpen(false);
    } finally {
      setBusy(false);
    }
  }

  async function createJiraIssue(form: JiraDraftForm, includeWorkbook: boolean): Promise<JiraCreateResult> {
    if (!edited && includeWorkbook) {
      throw new Error('No workbook loaded.');
    }
    return fetchJson<JiraCreateResult>('/api/jira/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form,
      }),
    });
  }

  async function attachWorkbookToJira(issueKey: string) {
    if (!edited) return;
    await fetchJson<{ ok: boolean }>('/api/jira/attach-workbook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        issueKey,
        model: edited,
        versionNumber: exportVersion,
      }),
    });
  }

  async function copyText(value: string, successMessage: string) {
    await navigator.clipboard.writeText(value);
    setStatus(successMessage);
  }

  async function handleReviewChanges() {
    if (!original || !edited) return;
    const snapshot = buildCurrentWorkbookSnapshot();
    if (!snapshot) return;
    setBusy(true);
    try {
      const [summary, exportResponse] = await Promise.all([
        fetchJson<DiffSummary>('/api/diff', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ original, edited: snapshot }),
        }),
        fetch('/api/export-workbook', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: snapshot, versionNumber: exportVersion }),
        }),
      ]);

      setDiff(summary);
      setEdited(snapshot);
      setReviewSummary(buildLaymanSummary(summary, snapshot, original));
      setReviewJiraTitle(buildReviewJiraTitle(snapshot.fileName));
      setJiraResults([]);
      setJiraCreateStatus('');
      setJiraCreateError('');

      if (!exportResponse.ok) {
        const payload = await exportResponse.json().catch(() => ({ error: 'Workbook export failed' }));
        throw new Error(payload.error ?? 'Workbook export failed');
      }

      const blob = await exportResponse.blob();
      if (reviewDownloadUrl) {
        URL.revokeObjectURL(reviewDownloadUrl);
      }
      const url = URL.createObjectURL(blob);
      const match = /filename="([^"]+)"/i.exec(exportResponse.headers.get('Content-Disposition') ?? '');
      setReviewDownloadUrl(url);
      setReviewDownloadName(match?.[1] ?? snapshot.fileName);
      setReviewModalOpen(true);
    } finally {
      setBusy(false);
    }
  }

  async function handleReadyForEngineering() {
    if (!original || !edited) return;
    if (!ensureValidEdited('Ready for Engineering')) return;
    if (!readyJiraKey.trim()) {
      setStatus('Ready for Engineering needs a Jira key.');
      return;
    }
    setBusy(true);
    try {
      const payload = await fetchJson<ReadyForEngineeringResult>('/api/ready-for-engineering', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          original,
          edited,
          jiraKey: readyJiraKey.trim(),
          versionNumber: exportVersion,
        }),
      });
      setReadyResult(payload);
      setReadyModalOpen(false);
      setExportVersion((current) => current + 1);
      setStatus(`Ready for Engineering package created for ${payload.jiraKey}.`);
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateJira() {
    if (!edited || !jiraForm) return;
    if (!ensureValidEdited('Jira creation')) return;
    const pendingWindow = window.open('', '_blank');
    if (pendingWindow) {
      pendingWindow.document.title = 'Opening Jira...';
      pendingWindow.document.body.innerHTML =
        '<p style="font-family: Arial, sans-serif; padding: 24px;">Creating Jira, please wait...</p>';
    }
    setJiraCreateError('');
    setJiraCreateStatus('Creating Jira issue...');
    setBusy(true);
    try {
      const results: JiraCreateResult[] = [];
      const mainIssue = await createJiraIssue(jiraForm, false);
      results.push(mainIssue);
      setJiraCreateStatus(`Created Jira ${mainIssue.key}.`);

      if (createMissingEventJira && missingJiraForm && dbCheck && dbCheck.missing.length > 0) {
        setJiraCreateStatus(`Created Jira ${mainIssue.key}. Creating missing-event Jira...`);
        const missingIssue = await createJiraIssue(missingJiraForm, false);
        results.push(missingIssue);
        setJiraCreateStatus(`Created Jira ${results.map((result) => result.key).join(', ')}.`);
      }

      setJiraResults(results);
      const primaryUrl = results[0]?.browseUrl;
      if (pendingWindow) {
        if (primaryUrl) {
          pendingWindow.location.href = primaryUrl;
        } else {
          pendingWindow.close();
        }
      } else if (primaryUrl) {
        window.location.href = primaryUrl;
      }
      setStatus(
        `Created Jira ${results.map((result) => result.key).join(', ')}.`,
      );
      setJiraCreateStatus(`Created Jira ${results.map((result) => result.key).join(', ')}. Attaching workbook...`);
      void attachWorkbookToJira(mainIssue.key)
        .then(() => {
          setJiraCreateStatus(`Created Jira ${results.map((result) => result.key).join(', ')}. Workbook attached.`);
          setStatus(`Created Jira ${results.map((result) => result.key).join(', ')}. Workbook attached.`);
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : 'Workbook attachment failed.';
          setJiraCreateError(message);
          setJiraCreateStatus(`Created Jira ${results.map((result) => result.key).join(', ')}. Workbook attachment needs attention.`);
          setStatus(`Created Jira ${results.map((result) => result.key).join(', ')}. ${message}`);
        });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Jira creation failed.';
      setJiraCreateError(message);
      setJiraCreateStatus('Jira creation failed.');
      if (pendingWindow) pendingWindow.close();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`app-shell theme-${theme} ${sidebarExpanded ? 'sidebar-expanded' : 'sidebar-collapsed'}`}>
      <aside className="sidebar-shell">
        <nav className="nav-rail" aria-label="Flow navigation">
          <button
            type="button"
            className="rail-badge rail-toggle"
            title={sidebarExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
            onClick={() => setSidebarExpanded((current) => !current)}
          >
            {sidebarExpanded ? 'QLE Document' : 'Q'}
          </button>
          <button
            type="button"
            className={`rail-nav ${activeFlow === 'pm' ? 'active' : ''}`}
            onClick={() => setActiveFlow('pm')}
            title="PM Dashboard"
          >
            <ClipboardIcon />
            {sidebarExpanded ? <span>PM Dashboard</span> : null}
          </button>
          <button
            type="button"
            className={`rail-nav ${activeFlow === 'developer' ? 'active' : ''}`}
            onClick={() => setActiveFlow('developer')}
            title="Developer Dashboard"
          >
            <CodeIcon />
            {sidebarExpanded ? <span>Developer Dashboard</span> : null}
          </button>
          {edited ? (
            <button
              type="button"
              className="rail-nav rail-download"
              disabled={busy || !hasUnsavedChanges}
              onClick={() => void handleSaveWorkbook()}
              title="Download the latest formatted workbook"
            >
              <DownloadIcon />
              {sidebarExpanded ? <span>Download</span> : null}
            </button>
          ) : null}
          <button
            type="button"
            className="rail-nav rail-theme"
            onClick={() => setTheme((current) => (current === 'classic' ? 'soft' : 'classic'))}
            title="Switch theme"
          >
            <PlusIcon />
            {sidebarExpanded ? <span>{theme === 'classic' ? 'Soft Theme' : 'Classic Theme'}</span> : null}
          </button>
        </nav>
      </aside>

      <main className="main-pane">
        <div className="status-bar">{status}</div>
        {activeFlow === 'developer' ? (
          <section className="editor">
            <section className={`pm-workspace developer-workspace ${developerWorkspaceCollapsed ? 'collapsed' : ''}`}>
              <div className="pm-workspace-header">
                <div className="flow-hero">
                  <div className="sidebar-brow">Developer Dashboard</div>
                  <h2>Implementation Intake</h2>
                  <p>Start from the Jira and workbook, then hand the request into the QLE skill workflow for code changes and review.</p>
                </div>
                <button
                  className="icon-only-button developer-collapse-button"
                  type="button"
                  title={developerWorkspaceCollapsed ? 'Expand Developer Dashboard' : 'Collapse Developer Dashboard'}
                  onClick={() => setDeveloperWorkspaceCollapsed((current) => !current)}
                >
                  {developerWorkspaceCollapsed ? <ChevronDownIcon /> : <ChevronUpIcon />}
                </button>
              </div>

              {!developerWorkspaceCollapsed ? (
                <>
                  <div className="pm-intake-grid">
                    <div className="panel developer-panel">
                      <div className="section-label">Request Intake</div>
                      <label className="upload-card intake-card">
                        <span className="intake-title">Jira request</span>
                        <span className="intake-copy">Enter the Jira key the developer will use as the source of truth for implementation.</span>
                        <input
                          type="text"
                          placeholder="HIX-224362"
                          value={developerJiraKey}
                          onChange={(event) => {
                            setDeveloperJiraKey(event.target.value.toUpperCase());
                            setDeveloperStageResult(null);
                            setDeveloperApprovalCaptured(false);
                          }}
                        />
                      </label>
                    </div>
                    <div className="panel developer-panel">
                      <div className="section-label">Request Intake</div>
                      <label className="upload-card intake-card">
                        <span className="intake-title">Workbook for the skill</span>
                        <span className="intake-copy">Upload the reviewed workbook here as a fallback or override for the Jira attachment.</span>
                        <input
                          type="file"
                          accept=".xlsx"
                          onChange={(event) => handleDeveloperWorkbookSelect(event.target.files?.[0] ?? null)}
                        />
                        {developerWorkbookName ? <span className="field-hint">Attached: {developerWorkbookName}</span> : null}
                        {!developerWorkbookName ? (
                          <span className="field-hint developer-warning">
                            Browser refreshes clear file uploads. Reattach the workbook before running Developer Dashboard.
                          </span>
                        ) : null}
                      </label>
                    </div>
                  </div>

                  <div className="pm-action-strip developer-action-strip">
                    <div className="pm-action-copy">
                      <div className="section-label">Next Step</div>
                      <h3>Run Implementation Flow</h3>
                      <p>Use Jira plus the reviewed workbook to start the implementation workflow, then verify both the generated diff and the isolated preview before commit and push.</p>
                    </div>
                    <div className="pm-action-group">
                      <button
                        className="action-emphasis"
                        type="button"
                        disabled={busy || !developerJiraKey.trim() || !developerWorkbookFile}
                        title="Start Developer Dashboard with Cursor CLI and the configured Jira MCP server"
                        onClick={() => void handleRunDeveloperFlow()}
                      >
                        {developerPendingAction === 'run' ? <SpinnerIcon /> : null}
                        <span>Run Implementation Flow</span>
                      </button>
                    </div>
                  </div>

                  <div className="workflow-grid">
                    <div className="panel developer-panel">
                      <div className="panel-header">
                        <h3>Planned actions</h3>
                      </div>
                      <ul className="plain-list">
                        <li>Read the Jira request and attachment.</li>
                        <li>Create a working branch for the implementation.</li>
                        <li>Run the formatted QLE skill with the workbook context.</li>
                        <li>Start a preview server from the isolated worktree for visual verification.</li>
                        <li>Open changes for user verification before commit and push.</li>
                      </ul>
                    </div>

                    <div className="panel developer-panel">
                      <div className="panel-header">
                        <h3>Skill handoff</h3>
                      </div>
                      <div className="developer-meta-list">
                        <div>
                          <strong>Skill</strong>
                          <span>/Users/ganesan_h/Documents/workfolder/iex/.cursor/skills/qle/add-enums-formatted</span>
                        </div>
                        <div>
                          <strong>Branch preview</strong>
                          <span>{developerJiraKey ? `cursor/${developerJiraKey.toLowerCase()}-qle-update` : 'cursor/jira-key-qle-update'}</span>
                        </div>
                        <div>
                          <strong>Workbook source</strong>
                          <span>{developerWorkbookName || 'Use Jira attachment or upload a workbook above.'}</span>
                        </div>
                        <div>
                          <strong>Preview target</strong>
                          <span>{developerRunStatus?.previewUrl || 'http://127.0.0.1:8888/mp/documents after the preview step completes.'}</span>
                        </div>
                        <div>
                          <strong>Preview state</strong>
                          <span>{developerStageResult?.previewStateCode || 'Infer from Jira when the run starts.'}</span>
                        </div>
                      </div>
                    </div>

                    <div className="panel developer-panel">
                      <div className="panel-header">
                        <h3>Execution Status</h3>
                      </div>
                      <div className="developer-status-list">
                        {developerExecutionItems.map((item) => (
                          <div key={item.label} className="developer-status-item">
                            <div>
                              <strong>{item.label}</strong>
                              {'key' in item &&
                              item.key === 'approvalAndPush' &&
                              developerRunStatus?.branchBrowseUrl &&
                              item.detail.includes(developerRunStatus.branchName) ? (
                                <span>
                                  {item.detail.split(developerRunStatus.branchName)[0]}
                                  <a
                                    href={developerRunStatus.branchBrowseUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    {developerRunStatus.branchName}
                                  </a>
                                  {item.detail.split(developerRunStatus.branchName).slice(1).join(developerRunStatus.branchName)}
                                </span>
                              ) : 'key' in item &&
                                item.key === 'previewServer' &&
                                developerRunStatus?.previewUrl &&
                                item.detail.includes(developerRunStatus.previewUrl) ? (
                                <span>
                                  {item.detail.split(developerRunStatus.previewUrl)[0]}
                                  <a
                                    href={developerRunStatus.previewUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    {developerRunStatus.previewUrl}
                                  </a>
                                  {item.detail.split(developerRunStatus.previewUrl).slice(1).join(developerRunStatus.previewUrl)}
                                </span>
                              ) : (
                                <span>{item.detail}</span>
                              )}
                            </div>
                            <span className={`developer-status-badge state-${item.state.toLowerCase().replace(/\s+/g, '-')}`}>
                              {item.state}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="panel developer-panel">
                      <div className="panel-header">
                        <h3>Approval</h3>
                      </div>
                      <p className="developer-approval-copy">
                        After the skill run produces changed files and a diff summary, use this checkpoint to confirm the implementation before commit and push.
                      </p>
                      <div className="pm-action-group">
                        <button
                          className="ghost action-secondary"
                          type="button"
                          disabled={
                            busy ||
                            !developerRunId ||
                            developerRunStatus?.overallState !== 'awaiting_approval'
                          }
                          onClick={() => void handleApproveDeveloperFlow()}
                        >
                          {developerPendingAction === 'approve' ? <SpinnerIcon /> : null}
                          <span>Approve and push</span>
                        </button>
                        <button
                          className="modal-link-button"
                          type="button"
                          disabled={
                            busy ||
                            !developerRunId ||
                            (developerRunStatus?.overallState !== 'completed' &&
                              developerRunStatus?.overallState !== 'failed')
                          }
                          onClick={() => void handleCreateDeveloperPr()}
                        >
                          {developerPendingAction === 'createPr' ? <SpinnerIcon /> : null}
                          <span>Create PR</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  {developerRunStatus &&
                  (developerRunStatus.changedFiles.length > 0 ||
                    developerRunStatus.diffSummary ||
                    developerRunStatus.changeRequestSummary ||
                    developerRunStatus.detailedDiff) ? (
                    <div className="panel developer-panel">
                      <div className="panel-header">
                        <h3>Review changes</h3>
                        <button
                          className="icon-only-button developer-collapse-button"
                          type="button"
                          title={developerReviewChangesCollapsed ? 'Expand Review changes' : 'Collapse Review changes'}
                          onClick={() => setDeveloperReviewChangesCollapsed((current) => !current)}
                        >
                          {developerReviewChangesCollapsed ? <ChevronDownIcon /> : <ChevronUpIcon />}
                        </button>
                      </div>
                      {!developerReviewChangesCollapsed && developerRunStatus.changeRequestSummary ? (
                        <div className="developer-diff-block">
                          <strong>Change request</strong>
                          <pre>{developerRunStatus.changeRequestSummary}</pre>
                        </div>
                      ) : null}
                      {!developerReviewChangesCollapsed && developerRunStatus.previewUrl ? (
                        <div className="developer-meta-list">
                          <div>
                            <strong>Preview URL</strong>
                            <span>
                              <a href={developerRunStatus.previewUrl} target="_blank" rel="noreferrer">
                                {developerRunStatus.previewUrl}
                              </a>
                            </span>
                          </div>
                        </div>
                      ) : null}
                      {!developerReviewChangesCollapsed && developerRunStatus.changedFiles.length > 0 ? (
                        <div className="developer-meta-list">
                          <div>
                            <strong>Changed files</strong>
                            <span>{developerRunStatus.changedFiles.join(', ')}</span>
                          </div>
                        </div>
                      ) : null}
                      {!developerReviewChangesCollapsed && developerRunStatus.diffSummary ? (
                        <div className="developer-diff-block">
                          <strong>Diff summary</strong>
                          <pre>{developerRunStatus.diffSummary}</pre>
                        </div>
                      ) : null}
                      {!developerReviewChangesCollapsed && developerRunStatus.detailedDiff ? (
                        <div className="developer-diff-block">
                          <strong>What changed</strong>
                          <pre>{developerRunStatus.detailedDiff}</pre>
                        </div>
                      ) : null}
                      {developerRunStatus.uiCodeReviewSummary ? (
                        <div className="developer-diff-block">
                          <div className="panel-header">
                            <strong>UI code review</strong>
                            <div className="panel-header-actions">
                              <button
                                className="ghost icon-only-button"
                                type="button"
                                title="Copy UI code review"
                                onClick={() =>
                                  void copyText(
                                    developerRunStatus.uiCodeReviewSummary ?? '',
                                    'UI code review copied.',
                                  )
                                }
                              >
                                <CopyIcon />
                              </button>
                              <button
                                className="icon-only-button developer-collapse-button"
                                type="button"
                                title={developerUiCodeReviewCollapsed ? 'Expand UI code review' : 'Collapse UI code review'}
                                onClick={() => setDeveloperUiCodeReviewCollapsed((current) => !current)}
                              >
                                {developerUiCodeReviewCollapsed ? <ChevronDownIcon /> : <ChevronUpIcon />}
                              </button>
                            </div>
                          </div>
                          {!developerUiCodeReviewCollapsed ? <pre>{developerRunStatus.uiCodeReviewSummary}</pre> : null}
                        </div>
                      ) : null}
                      {developerRunStatus.prSummaryText ? (
                        <div className="developer-diff-block">
                          <div className="panel-header">
                            <strong>PR summary</strong>
                            <div className="panel-header-actions">
                              <button
                                className="ghost icon-only-button"
                                type="button"
                                title="Copy PR summary"
                                onClick={() =>
                                  void copyText(
                                    developerRunStatus.prSummaryText ?? '',
                                    'PR summary copied.',
                                  )
                                }
                              >
                                <CopyIcon />
                              </button>
                              <button
                                className="icon-only-button developer-collapse-button"
                                type="button"
                                title={developerPrSummaryCollapsed ? 'Expand PR summary' : 'Collapse PR summary'}
                                onClick={() => setDeveloperPrSummaryCollapsed((current) => !current)}
                              >
                                {developerPrSummaryCollapsed ? <ChevronDownIcon /> : <ChevronUpIcon />}
                              </button>
                            </div>
                          </div>
                          {!developerPrSummaryCollapsed ? <pre>{developerRunStatus.prSummaryText}</pre> : null}
                        </div>
                      ) : null}
                      {developerRunStatus.prTitle ? (
                        <div className="developer-meta-list">
                          <div>
                            <strong>PR title</strong>
                            <span>{developerRunStatus.prTitle}</span>
                          </div>
                          <div>
                            <button
                              className="ghost icon-button"
                              type="button"
                              onClick={() =>
                                void copyText(
                                  developerRunStatus.prTitle ?? '',
                                  'PR title copied.',
                                )
                              }
                            >
                              <CopyIcon />
                              <span>Copy PR title</span>
                            </button>
                          </div>
                        </div>
                      ) : null}
                      {developerRunStatus.prCreateUrl ? (
                        <div className="developer-diff-block">
                          <div className="panel-header">
                            <strong>Go to PR</strong>
                            <div className="panel-header-actions">
                              <a
                                className="modal-link-button"
                                href={developerRunStatus.prCreateUrl}
                                target="_blank"
                                rel="noreferrer"
                              >
                                Go to PR
                              </a>
                              <button
                                className="ghost icon-button"
                                type="button"
                                onClick={() =>
                                  void copyText(
                                    developerRunStatus.prCreateUrl ?? '',
                                    'Create PR link copied.',
                                  )
                                }
                              >
                                <CopyIcon />
                                <span>Copy PR link</span>
                              </button>
                            </div>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {developerStageResult ? (
                    <div className="panel developer-panel">
                      <div className="panel-header">
                        <h3>Staged handoff</h3>
                      </div>
                      <div className="developer-meta-list">
                        <div>
                          <strong>Bundle folder</strong>
                          <span>{developerStageResult.bundleDir}</span>
                        </div>
                        <div>
                          <strong>Handoff file</strong>
                          <span>{developerStageResult.handoffFile}</span>
                        </div>
                        <div>
                          <strong>Workbook copy</strong>
                          <span>{developerStageResult.workbookPath}</span>
                        </div>
                        <div>
                          <strong>Preview state</strong>
                          <span>{developerStageResult.previewStateCode || 'Unknown'}</span>
                        </div>
                        <div>
                          <strong>Repo worktree</strong>
                          <span>{developerStageResult.worktreePath}</span>
                        </div>
                        <div>
                          <strong>Launch guide</strong>
                          <span>{developerStageResult.launchGuide}</span>
                        </div>
                        <div>
                          <strong>Cursor output log</strong>
                          <span>{developerStageResult.cursorOutputLog}</span>
                        </div>
                        <div>
                          <strong>Cursor error log</strong>
                          <span>{developerStageResult.cursorErrorLog}</span>
                        </div>
                        <div>
                          <strong>Preview output log</strong>
                          <span>{developerStageResult.previewOutputLog}</span>
                        </div>
                        <div>
                          <strong>Preview error log</strong>
                          <span>{developerStageResult.previewErrorLog}</span>
                        </div>
                        <div>
                          <strong>UI review output log</strong>
                          <span>{developerStageResult.uiCodeReviewOutputLog}</span>
                        </div>
                        <div>
                          <strong>UI review error log</strong>
                          <span>{developerStageResult.uiCodeReviewErrorLog}</span>
                        </div>
                        <div>
                          <strong>PR summary output log</strong>
                          <span>{developerStageResult.prSummaryOutputLog}</span>
                        </div>
                        <div>
                          <strong>PR summary error log</strong>
                          <span>{developerStageResult.prSummaryErrorLog}</span>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </>
              ) : null}
            </section>

          </section>
        ) : !edited || !selectedEvent ? (
          <section className="empty-state">
            <div className="pm-workspace-header">
              <div className="flow-hero">
                <div className="sidebar-brow">PM Dashboard</div>
                <h2>Workbook Intake</h2>
                <p>Choose the right starting point below. Both options open in the central workspace so PMs can stay focused on the flow.</p>
                {dbConnectionSummary ? (
                  <p className="pm-db-connection">Connected to DB: {dbConnectionSummary}</p>
                ) : null}
              </div>
              <div className="pm-header-actions">
                <button
                  className="ghost icon-only-button"
                  type="button"
                  title={dbSettingsTooltip}
                  onClick={() => setDbConfigModalOpen(true)}
                >
                  <GearIcon />
                </button>
              </div>
            </div>
            <div className="workflow-grid">
              <label className="upload-card">
                <span>Open formatted workbook for editing</span>
                <input
                  type="file"
                  accept=".xlsx"
                  disabled={busy}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void handleImport(file);
                  }}
                />
              </label>
              <label className="upload-card">
                <span>Format unformatted workbook</span>
                <input
                  type="file"
                  accept=".xlsx"
                  disabled={busy}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void handleFormatFirst(file);
                  }}
                />
              </label>
            </div>
            {stagedFormattedModel ? (
              <div className="panel">
                <h3>Formatted Review Ready</h3>
                <p>
                  Downloaded a formatted workbook for <strong>{stagedFormattedModel.fileName}</strong>.
                  Review it first, then open that formatted version in the editor.
                </p>
                <button disabled={busy} onClick={loadStagedFormattedModel}>
                  Open formatted workbook in editor
                </button>
              </div>
            ) : null}
          </section>
        ) : (
          <section className="editor">
            <section className={`pm-workspace ${pmWorkspaceCollapsed ? 'collapsed' : ''}`}>
              <div className="pm-workspace-header">
                <div className="flow-hero">
                  <div className="sidebar-brow">PM Dashboard</div>
                  <h2>Workbook Intake</h2>
                  <p>Start from a formatted workbook or convert an unformatted one, then use the action tray below to review and export changes.</p>
                  {dbConnectionSummary ? (
                    <p className="pm-db-connection">Connected to DB: {dbConnectionSummary}</p>
                  ) : null}
                </div>
                <div className="pm-header-actions">
                  <button
                    className="ghost icon-only-button"
                    type="button"
                    title={dbSettingsTooltip}
                    onClick={() => setDbConfigModalOpen(true)}
                  >
                    <GearIcon />
                  </button>
                  <button
                    className="ghost icon-only-button"
                    type="button"
                    title={pmWorkspaceCollapsed ? 'Expand PM Dashboard' : 'Collapse PM Dashboard'}
                    onClick={() => setPmWorkspaceCollapsed((current) => !current)}
                  >
                    {pmWorkspaceCollapsed ? <ChevronDownIcon /> : <ChevronUpIcon />}
                  </button>
                </div>
              </div>

              {!pmWorkspaceCollapsed ? (
                <>
                  <div className="pm-intake-grid">
                    <label className="upload-card intake-card">
                      <span className="intake-title">Open formatted workbook</span>
                      <span className="intake-copy">Continue editing a workbook that is already in the formatted dashboard structure.</span>
                      <input
                        type="file"
                        accept=".xlsx"
                        disabled={busy}
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) void handleImport(file);
                        }}
                      />
                    </label>
                    <label className="upload-card intake-card">
                      <span className="intake-title">Format unformatted workbook</span>
                      <span className="intake-copy">Convert the source workbook first, review it, then reopen the formatted result for editing.</span>
                      <input
                        type="file"
                        accept=".xlsx"
                        disabled={busy}
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) void handleFormatFirst(file);
                        }}
                      />
                    </label>
                  </div>

                  <div className="panel events-panel">
                    <div className="panel-header">
                      <h3>Event Groups</h3>
                      <button
                        className="ghost"
                        disabled={busy}
                        title="Add a new event after the existing events"
                        onClick={() =>
                          mutateEdited((draft) => {
                            const event = createEmptyEvent(draft.events.length + 1);
                            draft.events.push(event);
                            setSelectedEventId(event.id);
                          })
                        }
                      >
                        Add Group
                      </button>
                    </div>
                    <div className="event-list event-list-readable">
                      {edited.events.map((event) => (
                        <button
                          key={event.id}
                          className={[
                            'event-pill',
                            event.id === selectedEventId ? 'active' : '',
                            event.isRemoved ? 'removed-row' : '',
                          ].filter(Boolean).join(' ')}
                          title={`Open Event ${event.eventNumber}${event.isRemoved ? ' (removed)' : ''}`}
                          onClick={() => setSelectedEventId(event.id)}
                        >
                          Group {event.eventNumber}{event.isRemoved ? ' - Removed' : ''}
                        </button>
                      ))}
                    </div>
                  </div>

                </>
              ) : null}
            </section>

            {(diff || validationIssues.length > 0 || dbCheck) ? (
              <div className="workflow-grid">
                {diff ? (
                  <div className="panel">
                    <h3>Diff Summary</h3>
                    <p>{diff.counts.changes} changes detected.</p>
                    <ul className="plain-list">
                      {diff.entries.slice(0, 20).map((entry, index) => (
                        <li key={`${entry.path}-${index}`}>
                          [{entry.kind}] {entry.entity} {entry.path}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {validationIssues.length > 0 ? (
                  <div className="panel required-fields-panel">
                    <div className="required-fields-header">
                      <div className="section-label">Validation</div>
                      <h3>Required Fields</h3>
                      <p>Complete these before downloading, bundling, or creating Jira.</p>
                    </div>
                    <ul className="plain-list required-fields-list">
                      {validationIssues.slice(0, 12).map((issue) => (
                        <li key={issue.path}>{issue.message}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {dbCheck ? (
                  <div className="panel">
                    <h3>DB Event Check</h3>
                    {!dbCheck.configured ? <p>Database lookup is not configured yet.</p> : null}
                    {dbCheck.errors.length > 0 ? (
                      <ul className="plain-list">
                        {dbCheck.errors.map((error) => (
                          <li key={error}>{error}</li>
                        ))}
                      </ul>
                    ) : null}
                    {dbCheck.missing.length > 0 ? (
                      <>
                        <p>{dbCheck.missing.length} event names are missing from `sep_enrollment_events`.</p>
                        <ul className="plain-list">
                          {dbCheck.missing.map((item) => (
                            <li key={`${item.eventNumber}-${item.eventName}`}>
                              Event {item.eventNumber}: {item.eventName} {'->'} {item.englishLabel}
                            </li>
                          ))}
                        </ul>
                      </>
                    ) : dbCheck.configured && dbCheck.errors.length === 0 ? (
                      <p>All event names in this workbook were found in the database.</p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="save-banner">
              <div>
                <strong>{hasUnsavedChanges ? 'Workbook download needed' : 'Workbook is up to date'}</strong>
                <p>
                  {hasUnsavedChanges
                    ? 'Your latest edits are saved in the dashboard draft. Download when you want the refreshed workbook.'
                    : 'The downloaded workbook matches the latest edits in the dashboard.'}
                </p>
                {lastAutosavedAt ? <p>Last draft autosave: {lastAutosavedAt}.</p> : null}
              </div>
              <button
                className="primary-save"
                disabled={busy || !hasUnsavedChanges}
                title="Download the latest formatted workbook with your edits"
                onClick={() => void handleSaveWorkbook()}
              >
                <DownloadIcon />
                <span>Download</span>
              </button>
            </div>

            <div className="pm-action-strip">
              <div className="pm-action-copy">
                <div className="section-label">Next Step</div>
                <h3>Review before handoff</h3>
                <p>
                  {hasUnsavedChanges
                    ? 'Download the workbook above, then review changes before handing the update off.'
                    : 'Review the current changes or clear the draft before moving on.'}
                </p>
                {lastAutosavedAt ? <span>Last draft autosave: {lastAutosavedAt}</span> : null}
              </div>
              <div className="pm-action-group">
                <button
                  className="action-emphasis"
                  disabled={busy}
                  title="Compare your current edits against the imported workbook"
                  onClick={() => void handleReviewChanges()}
                >
                  Review Changes
                </button>
                <button
                  className="ghost action-secondary"
                  disabled={busy}
                  title="Clear the current local draft and start over"
                  onClick={clearDraft}
                >
                  Clear Draft
                </button>
              </div>
            </div>

            <div className="editor-header">
              <h2>Group {selectedEvent.eventNumber}</h2>
              <div className="action-row">
                <button
                  className="ghost danger icon-button"
                  title="Mark this event as removed in the workbook"
                  onClick={() =>
                    mutateEdited((draft) => {
                      const event = draft.events.find((item) => item.id === selectedEvent.id);
                      if (event) markEventRemoved(event);
                    })
                  }
                >
                  <TrashIcon />
                  <span>{selectedEvent.isRemoved ? 'Event Removed' : 'Remove Event'}</span>
                </button>
                <button
                  className="ghost icon-button"
                  disabled={busy || history.length === 0}
                  title="Undo the most recent workbook edit"
                  onClick={handleUndo}
                >
                  <UndoIcon />
                  <span>Undo</span>
                </button>
              </div>
            </div>

            <div className="panel">
              <div className="panel-header">
                <h3>Enum Rows</h3>
                <button
                  className="ghost icon-button"
                  title="Add another enum row under this event"
                  onClick={() =>
                    mutateEdited((draft) => {
                      const event = draft.events.find((item) => item.id === selectedEvent.id);
                      event?.enumRows.push({ id: crypto.randomUUID(), enum: '', en: '', es: '' });
                    })
                  }
                >
                  <PlusIcon />
                  <span>Add Enum</span>
                </button>
              </div>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Enum</th>
                    <th>English</th>
                    <th>Spanish</th>
                    <th className="table-col-toggle">New</th>
                    <th className="table-col-actions"></th>
                  </tr>
                </thead>
                <tbody>
                  {selectedEvent.enumRows.map((row) => (
                    <tr key={row.id} className={row.isRemoved ? 'removed-row' : ''}>
                      <td>
                        <div className="autocomplete-field">
                          <input
                            value={row.enum}
                            placeholder="Start typing an event name"
                            onBlur={() => {
                              noteAutosave();
                              window.setTimeout(() => setActiveEnumRowId((current) => (current === row.id ? null : current)), 120);
                            }}
                            onFocus={() => {
                              setActiveEnumRowId(row.id);
                              setEnumQuery(row.enum);
                              void loadEventOptions(row.enum);
                            }}
                            onChange={(event) =>
                              mutateEdited((draft) => {
                                const target = draft.events
                                  .find((item) => item.id === selectedEvent.id)
                                ?.enumRows.find((item) => item.id === row.id);
                                if (target) target.enum = event.target.value;
                              })
                            }
                            onInput={(event) => {
                              const value = (event.target as HTMLInputElement).value;
                              setEnumQuery(value);
                              void loadEventOptions(value);
                            }}
                          />
                          {activeEnumRowId === row.id && filteredEventOptions.length > 0 ? (
                            <div className="autocomplete-menu">
                              <div className="autocomplete-status">
                                {eventOptionsLoading
                                  ? 'Loading event names...'
                                  : `${filteredEventOptions.length} suggestion${filteredEventOptions.length === 1 ? '' : 's'}`}
                              </div>
                              <ul className="autocomplete-list">
                                {filteredEventOptions.map((option) => (
                                  <li key={`${option.eventName}-${option.eventLabel}`}>
                                    <button
                                      type="button"
                                      className="autocomplete-option"
                                      onMouseDown={(event) => {
                                        event.preventDefault();
                                        mutateEdited((draft) => {
                                          const target = draft.events
                                            .find((item) => item.id === selectedEvent.id)
                                            ?.enumRows.find((item) => item.id === row.id);
                                          if (target) target.enum = option.eventName;
                                        });
                                        setEnumQuery(option.eventName);
                                        setActiveEnumRowId(null);
                                      }}
                                    >
                                      <strong>{option.eventName}</strong>
                                      <span>{option.eventLabel}</span>
                                    </button>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ) : activeEnumRowId === row.id ? (
                            <div className="autocomplete-menu">
                              <div className="autocomplete-status">
                                {eventOptionsLoading ? 'Loading event names...' : 'No matching event names.'}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      </td>
                      <td>
                        <input
                          value={row.en}
                          onBlur={noteAutosave}
                          onChange={(event) =>
                            mutateEdited((draft) => {
                              const target = draft.events
                                .find((item) => item.id === selectedEvent.id)
                                ?.enumRows.find((item) => item.id === row.id);
                              if (target) target.en = event.target.value;
                            })
                          }
                        />
                      </td>
                      <td>
                        <input
                          value={row.es}
                          onBlur={noteAutosave}
                          onChange={(event) =>
                            mutateEdited((draft) => {
                              const target = draft.events
                                .find((item) => item.id === selectedEvent.id)
                                ?.enumRows.find((item) => item.id === row.id);
                              if (target) target.es = event.target.value;
                            })
                          }
                        />
                      </td>
                      <td className="table-cell-toggle">
                        <input
                          type="checkbox"
                          checked={Boolean(row.isNew)}
                          onBlur={noteAutosave}
                          onChange={(event) =>
                            mutateEdited((draft) => {
                              const target = draft.events
                                .find((item) => item.id === selectedEvent.id)
                                ?.enumRows.find((item) => item.id === row.id);
                              if (target) {
                                target.manualIsNew = event.target.checked;
                                target.isNew = event.target.checked;
                              }
                            })
                          }
                        />
                      </td>
                      <td className="table-cell-actions">
                        <button
                          className="ghost danger icon-only-button"
                          title="Delete this enum row"
                          onClick={() =>
                            mutateEdited((draft) => {
                              const event = draft.events.find((item) => item.id === selectedEvent.id);
                              const target = event?.enumRows.find((item) => item.id === row.id);
                              if (target) target.isRemoved = true;
                            })
                          }
                        >
                          <TrashIcon />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="field-hint">{eventOptionsHelp || 'Start typing to search existing event names.'}</p>
            </div>

            <div className="panel">
              <h3>Instructions</h3>
              <div className="two-up">
                <label>
                  English
                  <textarea
                    rows={4}
                    value={selectedEvent.instructionsEn}
                    onBlur={noteAutosave}
                    onChange={(event) =>
                      mutateEdited((draft) => {
                        const target = draft.events.find((item) => item.id === selectedEvent.id);
                        if (target) target.instructionsEn = event.target.value;
                      })
                    }
                  />
                </label>
                <label>
                  Spanish
                  <textarea
                    rows={4}
                    value={selectedEvent.instructionsEs}
                    onBlur={noteAutosave}
                    onChange={(event) =>
                      mutateEdited((draft) => {
                        const target = draft.events.find((item) => item.id === selectedEvent.id);
                        if (target) target.instructionsEs = event.target.value;
                      })
                    }
                  />
                </label>
              </div>
            </div>

            <div className="panel">
              <div className="panel-header">
                <h3>Categories</h3>
                <button
                  className="ghost icon-button"
                  title="Add a category under this event"
                  onClick={() =>
                    mutateEdited((draft) => {
                      const event = draft.events.find((item) => item.id === selectedEvent.id);
                      event?.categories.push(createEmptyCategory());
                    })
                  }
                >
                  <PlusIcon />
                  <span>Add Category</span>
                </button>
              </div>

              <div className="category-stack">
                {selectedEvent.categories.map((category) => (
                  <div key={category.id} className={category.isRemoved ? 'category-card removed-row' : 'category-card'}>
                    <div className="panel-header">
                      <strong>{category.enum || 'New category'}{category.isRemoved ? ' - Removed' : ''}</strong>
                      <button
                        className="ghost danger icon-only-button"
                        title="Mark this category and its documents as removed"
                        onClick={() =>
                          mutateEdited((draft) => {
                            const event = draft.events.find((item) => item.id === selectedEvent.id);
                            const target = event?.categories.find((item) => item.id === category.id);
                            if (target) markCategoryRemoved(target);
                          })
                        }
                      >
                        <TrashIcon />
                      </button>
                    </div>

                    <div className="two-up">
                      <label>
                        Category Enum
                        <input
                          value={category.enum}
                          onBlur={noteAutosave}
                          onChange={(event) =>
                            mutateEdited((draft) => {
                              const target = draft.events
                                .find((item) => item.id === selectedEvent.id)
                                ?.categories.find((item) => item.id === category.id);
                              if (target) target.enum = event.target.value;
                            })
                          }
                        />
                      </label>
                      <label>
                        Validation Rule
                        <textarea
                          rows={3}
                          value={category.validation}
                          onBlur={noteAutosave}
                          onChange={(event) =>
                            mutateEdited((draft) => {
                              const target = draft.events
                                .find((item) => item.id === selectedEvent.id)
                                ?.categories.find((item) => item.id === category.id);
                              if (target) target.validation = event.target.value;
                            })
                          }
                        />
                      </label>
                    </div>

                    <div className="two-up">
                      <label>
                        English
                        <input
                          value={category.en}
                          onBlur={noteAutosave}
                          onChange={(event) =>
                            mutateEdited((draft) => {
                              const target = draft.events
                                .find((item) => item.id === selectedEvent.id)
                                ?.categories.find((item) => item.id === category.id);
                              if (target) target.en = event.target.value;
                            })
                          }
                        />
                      </label>
                      <label>
                        Spanish
                        <input
                          value={category.es}
                          onBlur={noteAutosave}
                          onChange={(event) =>
                            mutateEdited((draft) => {
                              const target = draft.events
                                .find((item) => item.id === selectedEvent.id)
                                ?.categories.find((item) => item.id === category.id);
                              if (target) target.es = event.target.value;
                            })
                          }
                        />
                      </label>
                    </div>

                    <div className="panel-header nested">
                      <h4>Documents</h4>
                      <button
                        className="ghost icon-button"
                        disabled={Boolean(category.isRemoved)}
                        title={
                          category.isRemoved
                            ? 'Cannot add documents to a removed category'
                            : 'Add a document under this category'
                        }
                        onClick={() =>
                          mutateEdited((draft) => {
                            const target = draft.events
                              .find((item) => item.id === selectedEvent.id)
                              ?.categories.find((item) => item.id === category.id);
                            target?.documents.push(createEmptyDocument((target.documents.length || 0) + 1));
                          })
                        }
                      >
                        <PlusIcon />
                        <span>Add Document</span>
                      </button>
                    </div>
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th className="table-col-index">#</th>
                          <th>Enum</th>
                          <th>English</th>
                          <th>Spanish</th>
                          <th className="table-col-toggle">New</th>
                          <th className="table-col-actions"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {category.documents.map((document, documentIndex) => (
                          <tr key={document.id} className={document.isRemoved ? 'removed-row' : ''}>
                            <td className="table-cell-index">{documentIndex + 1}</td>
                            <td>
                              <input
                                value={document.enum}
                                onBlur={noteAutosave}
                                onChange={(event) =>
                                  mutateEdited((draft) => {
                                    const target = draft.events
                                      .find((item) => item.id === selectedEvent.id)
                                      ?.categories.find((item) => item.id === category.id)
                                      ?.documents.find((item) => item.id === document.id);
                                    if (target) target.enum = event.target.value;
                                  })
                                }
                              />
                            </td>
                            <td>
                              <input
                                value={document.en}
                                onBlur={noteAutosave}
                                onChange={(event) =>
                                  mutateEdited((draft) => {
                                    const target = draft.events
                                      .find((item) => item.id === selectedEvent.id)
                                      ?.categories.find((item) => item.id === category.id)
                                      ?.documents.find((item) => item.id === document.id);
                                    if (target) target.en = event.target.value;
                                  })
                                }
                              />
                            </td>
                            <td>
                              <input
                                value={document.es}
                                onBlur={noteAutosave}
                                onChange={(event) =>
                                  mutateEdited((draft) => {
                                    const target = draft.events
                                      .find((item) => item.id === selectedEvent.id)
                                      ?.categories.find((item) => item.id === category.id)
                                      ?.documents.find((item) => item.id === document.id);
                                    if (target) target.es = event.target.value;
                                  })
                                }
                              />
                            </td>
                            <td className="table-cell-toggle">
                              <input
                                type="checkbox"
                                checked={Boolean(document.isNew)}
                                onBlur={noteAutosave}
                                onChange={(event) =>
                                  mutateEdited((draft) => {
                                    const target = draft.events
                                      .find((item) => item.id === selectedEvent.id)
                                      ?.categories.find((item) => item.id === category.id)
                                      ?.documents.find((item) => item.id === document.id);
                                    if (target) {
                                      target.manualIsNew = event.target.checked;
                                      target.isNew = event.target.checked;
                                    }
                                  })
                                }
                              />
                            </td>
                            <td className="table-cell-actions">
                              <button
                                className="ghost danger icon-only-button"
                                title="Delete this document row"
                                onClick={() =>
                                  mutateEdited((draft) => {
                                    const target = draft.events
                                      .find((item) => item.id === selectedEvent.id)
                                      ?.categories.find((item) => item.id === category.id);
                                    if (!target) return;
                                    const documentTarget = target.documents.find(
                                      (item) => item.id === document.id,
                                    );
                                    if (documentTarget) documentTarget.isRemoved = true;
                                  })
                                }
                              >
                                <TrashIcon />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}
      </main>

      {reviewModalOpen ? (
        <div className="modal-backdrop">
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="panel-header">
              <h2>Review Changes</h2>
              <button
                className="modal-close-button icon-only-button"
                title="Close review modal"
                onClick={() => setReviewModalOpen(false)}
              >
                <CloseIcon />
              </button>
            </div>
            <div className="modal-grid">
              <label className="modal-span">
                <div className="panel-header">
                  <span>Jira Title</span>
                  <button
                    className="ghost icon-only-button"
                    type="button"
                    title="Copy Jira title"
                    onClick={() =>
                      void copyText(
                        reviewJiraTitle.trim() || (edited ? buildReviewJiraTitle(edited.fileName) : ''),
                        'Copied Jira title.',
                      )
                    }
                  >
                    <CopyIcon />
                  </button>
                </div>
                <input value={reviewJiraTitle} onChange={(event) => setReviewJiraTitle(event.target.value)} />
              </label>
              <div className="modal-span panel modal-subpanel">
                <div className="panel-header">
                  <h3>Changes To Implement</h3>
                  <button
                    className="ghost icon-only-button"
                    type="button"
                    title="Copy changes to implement"
                    onClick={() =>
                      void copyText(
                        buildReviewDescription(reviewSummary, diff, edited, original),
                        'Copied changes to implement.',
                      )
                    }
                  >
                    <CopyIcon />
                  </button>
                </div>
                <div className="review-summary-groups">
                  {reviewSummary.map((group) => (
                    <div key={group.title} className="review-summary-group">
                      <p className="detail-heading">{group.title}:</p>
                      <ul className="plain-list">
                        {group.items.filter(shouldRenderReviewItem).map((item) => (
                          <li key={`${group.title}-${item}`} className="review-summary-item">
                            {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
              <div className="modal-span panel modal-subpanel">
                <h3>Workbook</h3>
                {reviewDownloadUrl ? (
                  <p>
                    <a href={reviewDownloadUrl} download={reviewDownloadName}>
                      Download latest workbook: {reviewDownloadName}
                    </a>
                  </p>
                ) : (
                  <p>The latest workbook download link will appear here.</p>
                )}
              </div>
            </div>
            {jiraCreateStatus ? (
              <div className="panel modal-subpanel">
                <p><strong>Status:</strong> {jiraCreateStatus}</p>
                {jiraCreateError ? <p><strong>Error:</strong> {jiraCreateError}</p> : null}
                {jiraResults.length > 0 ? (
                  <ul className="plain-list">
                    {jiraResults.map((result) => (
                      <li key={result.key}>
                        {result.browseUrl ? (
                          <a href={result.browseUrl} target="_blank" rel="noreferrer">
                            {result.key}
                          </a>
                        ) : (
                          result.key
                        )}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
            <div className="modal-actions">
              <button className="ghost" onClick={() => setReviewModalOpen(false)}>
                Cancel
              </button>
              <button className="ghost modal-link-button" disabled={busy} onClick={() => void handleOpenReviewJiraForm()}>
                Create Jira
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {dbConfigModalOpen ? (
        <div className="modal-backdrop" onClick={() => setDbConfigModalOpen(false)}>
          <div className="modal-card db-config-modal" onClick={(event) => event.stopPropagation()}>
            <div className="panel-header">
              <h2>PM Database Settings</h2>
              <button
                className="modal-close-button icon-only-button"
                title="Close database settings"
                onClick={() => setDbConfigModalOpen(false)}
              >
                <CloseIcon />
              </button>
            </div>
            <p className="modal-note">
              Configure the database connection used for PM Dashboard validation and event lookups.
            </p>
            <div className="modal-grid">
              <label>
                Host
                <input
                  value={dbConfigForm.host}
                  onChange={(event) =>
                    setDbConfigForm((current) => ({ ...current, host: event.target.value }))
                  }
                />
              </label>
              <label>
                Port
                <input
                  type="number"
                  min={1}
                  value={dbConfigForm.port}
                  onChange={(event) =>
                    setDbConfigForm((current) => ({
                      ...current,
                      port: Number(event.target.value) || 0,
                    }))
                  }
                />
              </label>
              <label>
                Database
                <input
                  value={dbConfigForm.database}
                  onChange={(event) =>
                    setDbConfigForm((current) => ({ ...current, database: event.target.value }))
                  }
                />
              </label>
              <label>
                Schema
                <input
                  value={dbConfigForm.schema}
                  onChange={(event) =>
                    setDbConfigForm((current) => ({ ...current, schema: event.target.value }))
                  }
                />
              </label>
              <label>
                User
                <input
                  value={dbConfigForm.user}
                  onChange={(event) =>
                    setDbConfigForm((current) => ({ ...current, user: event.target.value }))
                  }
                />
              </label>
              <label>
                Password
                <input
                  type="password"
                  value={dbConfigForm.password}
                  onChange={(event) =>
                    setDbConfigForm((current) => ({ ...current, password: event.target.value }))
                  }
                />
              </label>
              <label className="checkbox-row modal-span">
                <input
                  type="checkbox"
                  checked={dbConfigForm.ssl}
                  onChange={(event) =>
                    setDbConfigForm((current) => ({ ...current, ssl: event.target.checked }))
                  }
                />
                <span>Use SSL for the connection</span>
              </label>
            </div>
            <div className="modal-actions">
              <button className="ghost" onClick={() => setDbConfigModalOpen(false)} disabled={dbConfigSaving}>
                Cancel
              </button>
              <button className="primary-save" onClick={() => void handleSaveDbConfig()} disabled={dbConfigSaving}>
                {dbConfigSaving ? 'Saving...' : 'Save settings'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {jiraModalOpen && jiraForm ? (
        <div className="modal-backdrop" onClick={() => setJiraModalOpen(false)}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="panel-header">
              <h2>Draft Jira</h2>
              <button className="ghost" onClick={() => setJiraModalOpen(false)}>
                Close
              </button>
            </div>

            <div className="modal-grid">
              <label>
                Summary
                <input
                  value={jiraForm.summary}
                  onChange={(event) =>
                    setJiraForm((current) => (current ? { ...current, summary: event.target.value } : current))
                  }
                />
              </label>
              <label>
                Issue Type
                <input
                  value={jiraForm.issueType}
                  onChange={(event) =>
                    setJiraForm((current) => (current ? { ...current, issueType: event.target.value } : current))
                  }
                />
              </label>
              <label>
                Assignee Account ID
                <input
                  value={jiraForm.assigneeAccountId}
                  onChange={(event) =>
                    setJiraForm((current) =>
                      current ? { ...current, assigneeAccountId: event.target.value } : current,
                    )
                  }
                />
              </label>
              <label>
                Fix Version
                <input
                  value={jiraForm.fixVersionName}
                  onChange={(event) =>
                    setJiraForm((current) =>
                      current ? { ...current, fixVersionName: event.target.value } : current,
                    )
                  }
                />
              </label>
              <label>
                Labels
                <input
                  value={jiraForm.labels}
                  onChange={(event) =>
                    setJiraForm((current) => (current ? { ...current, labels: event.target.value } : current))
                  }
                />
              </label>
              <label className="modal-span">
                Description
                <textarea
                  rows={12}
                  value={jiraForm.description}
                  onChange={(event) =>
                    setJiraForm((current) =>
                      current ? { ...current, description: event.target.value } : current,
                    )
                  }
                />
              </label>
            </div>

            {jiraCreateStatus ? (
              <div className="panel modal-subpanel">
                <p><strong>Status:</strong> {jiraCreateStatus}</p>
                {jiraCreateError ? <p><strong>Error:</strong> {jiraCreateError}</p> : null}
                {jiraResults.length > 0 ? (
                  <ul className="plain-list">
                    {jiraResults.map((result) => (
                      <li key={result.key}>
                        {result.browseUrl ? (
                          <a href={result.browseUrl} target="_blank" rel="noreferrer">
                            {result.key}
                          </a>
                        ) : (
                          result.key
                        )}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}

            {dbCheck?.missing.length ? (
              <div className="panel modal-subpanel">
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={createMissingEventJira}
                    onChange={(event) => setCreateMissingEventJira(event.target.checked)}
                  />
                  <span>Create a separate Jira for missing event names</span>
                </label>
                <ul className="plain-list">
                  {dbCheck.missing.map((item) => (
                    <li key={`${item.eventNumber}-${item.eventName}`}>
                      Event {item.eventNumber}: {item.eventName} {'->'} {item.englishLabel}
                    </li>
                  ))}
                </ul>
                {createMissingEventJira && missingJiraForm ? (
                  <div className="modal-grid">
                    <label className="modal-span">
                      Missing Event Jira Summary
                      <input
                        value={missingJiraForm.summary}
                        onChange={(event) =>
                          setMissingJiraForm((current) =>
                            current ? { ...current, summary: event.target.value } : current,
                          )
                        }
                      />
                    </label>
                    <label className="modal-span">
                      Missing Event Jira Description
                      <textarea
                        rows={8}
                        value={missingJiraForm.description}
                        onChange={(event) =>
                          setMissingJiraForm((current) =>
                            current ? { ...current, description: event.target.value } : current,
                          )
                        }
                      />
                    </label>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="modal-actions">
              <button className="ghost" onClick={() => setJiraModalOpen(false)}>
                Cancel
              </button>
              <button className="primary-save" disabled={busy} onClick={() => void handleCreateJira()}>
                Create Jira
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {readyModalOpen ? (
        <div className="modal-backdrop" onClick={() => setReadyModalOpen(false)}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="panel-header">
              <h2>Ready for Engineering</h2>
              <button className="ghost" onClick={() => setReadyModalOpen(false)}>
                Close
              </button>
            </div>
            <p>
              Enter the existing Jira key that should be linked to the coordinator handoff package.
              This will not update the codebase yet. It creates a bundle with `agent-handoff.json`
              and `READY_FOR_ENGINEERING.md`.
            </p>
            <label>
              Jira Key
              <input
                placeholder="HIX-222050"
                value={readyJiraKey}
                onChange={(event) => setReadyJiraKey(event.target.value.toUpperCase())}
              />
            </label>
            <div className="modal-actions">
              <button className="ghost" onClick={() => setReadyModalOpen(false)}>
                Cancel
              </button>
              <button className="primary-save" disabled={busy} onClick={() => void handleReadyForEngineering()}>
                Create Handoff Package
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
