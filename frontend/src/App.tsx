import { useEffect, useMemo, useRef, useState } from 'react';
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
  IntegrationStatusResponse,
  JiraCreateResult,
  JiraDraftForm,
  JiraDraft,
  OAuthProvider,
  QleCategory,
  QleDocument,
  QleEnumRow,
  QleEvent,
  QleFieldState,
  QleFieldStateMap,
  QleValidationItem,
  QleWorkbookModel,
  ReadyForEngineeringResult,
} from '../../shared/types';
import {
  isUnsupportedUiOnlyWorkbookEvent,
  type ValidationIssue,
  validateWorkbookModel,
} from '../../shared/validation';
import {
  DbConfigModal,
  JiraDraftModal,
  ReadyForEngineeringModal,
  RebaseWorkbookModal,
  RenameWorkbookModal,
  ReviewChangesModal,
} from './components/app/AppModals';
import {
  DeveloperDashboard,
  PmActionStrip,
  PmEmptyState,
  PmWorkspaceIntro,
  SaveBanner,
  SidebarRail,
  WorkflowInsights,
} from './components/app/AppSections';
import {
  NewBadgeIcon,
  PlusIcon,
  RemoveFileIcon,
  TrashIcon,
  UndoIcon,
} from './components/app/AppIcons';

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

const PILOT_ALLOW_DOWNLOAD_WITH_VALIDATION_WARNINGS = true;

function shouldBlockDownloadForValidation(issues: ValidationIssue[]): boolean {
  return !PILOT_ALLOW_DOWNLOAD_WITH_VALIDATION_WARNINGS && issues.length > 0;
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

function unmarkEventRemoved(event: QleEvent) {
  event.isRemoved = false;
  event.enumRows.forEach((row) => {
    row.isRemoved = false;
  });
  event.categories.forEach((category) => {
    category.isRemoved = false;
    category.documents.forEach((document) => {
      document.isRemoved = false;
    });
  });
}

function markCategoryRemoved(category: QleCategory) {
  category.isRemoved = true;
  category.documents.forEach((document) => {
    document.isRemoved = true;
  });
}

function unmarkCategoryRemoved(category: QleCategory) {
  category.isRemoved = false;
  category.documents.forEach((document) => {
    document.isRemoved = false;
  });
}

function createEmptyCategory(): QleCategory {
  return {
    id: crypto.randomUUID(),
    enum: '',
    en: '',
    es: '',
    validation: '',
    validationItems: [],
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

function createValidationItem(
  key = '',
  value = '',
  overrides: Partial<QleValidationItem> = {},
): QleValidationItem {
  return {
    id: crypto.randomUUID(),
    key,
    value,
    manualIsNew: null,
    ...overrides,
  };
}

function splitValidationLines(value: string): string[] {
  return value
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseValidationItemsFromText(value: string): QleValidationItem[] {
  return splitValidationLines(value).map((line) => {
    const separatorIndex = line.indexOf(':');
    if (separatorIndex < 0) {
      return createValidationItem(line.trim(), '');
    }
    return createValidationItem(
      line.slice(0, separatorIndex).trim(),
      line.slice(separatorIndex + 1).trim(),
    );
  });
}

function serializeValidationItems(items: QleValidationItem[]): string {
  return items
    .filter((item) => item.key.trim())
    .map((item) => `${item.key.trim()}: ${item.value.trim()}`.trim())
    .join('\n');
}

function ensureCategoryValidationItems(category: QleCategory): QleValidationItem[] {
  if (category.validationItems && category.validationItems.length > 0) {
    return category.validationItems;
  }
  const parsed = parseValidationItemsFromText(category.validation);
  category.validationItems = parsed;
  if (parsed.length > 0) {
    category.validation = serializeValidationItems(parsed);
  }
  return category.validationItems;
}

function syncCategoryValidation(category: QleCategory) {
  const items = ensureCategoryValidationItems(category);
  category.validation = serializeValidationItems(items);
}

type FieldStateHolder = {
  fieldStates?: QleFieldStateMap;
};

function ensureFieldState(holder: FieldStateHolder, key: string): QleFieldState {
  holder.fieldStates ??= {};
  holder.fieldStates[key] ??= { manualIsNew: null, isNew: false, isRemoved: false };
  return holder.fieldStates[key]!;
}

function getFieldState(holder: FieldStateHolder | null | undefined, key: string): QleFieldState | undefined {
  return holder?.fieldStates?.[key];
}

function fieldStateHasChanges(fieldState: QleFieldState | undefined): boolean {
  return Boolean(fieldState?.isNew) || Boolean(fieldState?.isRemoved);
}

function validationItemHasFieldStateChanges(item: QleValidationItem): boolean {
  return Object.values(item.fieldStates ?? {}).some((fieldState) => fieldStateHasChanges(fieldState));
}

function isFixedValidationRuleKey(key: string): boolean {
  return ['documentsqty', 'mandatorydocuments'].includes(key.trim().toLowerCase());
}

function validationItemHasNewState(item: QleValidationItem): boolean {
  return Boolean(item.isNew) || Boolean(getFieldState(item, 'key')?.isNew) || Boolean(getFieldState(item, 'value')?.isNew);
}

function validationItemHasRemovedState(item: QleValidationItem): boolean {
  return (
    Boolean(item.isRemoved) ||
    Boolean(getFieldState(item, 'key')?.isRemoved) ||
    Boolean(getFieldState(item, 'value')?.isRemoved)
  );
}

function getValidationItemLabel(item: QleValidationItem, fallbackIndex?: number): string {
  return item.key.trim() || (fallbackIndex != null ? `Rule ${fallbackIndex + 1}` : 'Validation rule');
}

function applyFieldDelete(holder: FieldStateHolder, key: string) {
  const state = ensureFieldState(holder, key);
  state.isNew = false;
  state.manualIsNew = null;
  state.isRemoved = false;
}

function normaliseComparableText(value: string | null | undefined): string {
  return (value ?? '').replace(/\r\n/g, '\n').trim();
}

function hasComparableTextChanged(
  currentValue: string | number | null | undefined,
  baselineValue: string | number | null | undefined,
): boolean {
  return normaliseComparableText(String(currentValue ?? '')) !== normaliseComparableText(String(baselineValue ?? ''));
}

function formatChangedReviewValueLine(
  label: string,
  beforeValue: string | number | null | undefined,
  afterValue: string | number | null | undefined,
): string {
  return `  ${label}: "${normaliseComparableText(String(afterValue ?? ''))}" (was "${normaliseComparableText(String(beforeValue ?? ''))}")`;
}

function escapeAttributeSelectorValue(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function buildModelIndex(model: QleWorkbookModel | null) {
  const events = new Map<string, QleEvent>();
  const enumRows = new Map<string, QleEnumRow>();
  const categories = new Map<string, QleCategory>();
  const documents = new Map<string, QleDocument>();
  const validationItems = new Map<string, QleValidationItem>();

  if (!model) {
    return { events, enumRows, categories, documents, validationItems };
  }

  model.events.forEach((event) => {
    events.set(event.id, event);
    event.enumRows.forEach((row) => enumRows.set(row.id, row));
    event.categories.forEach((category) => {
      categories.set(category.id, category);
      (category.validationItems ?? []).forEach((item) => validationItems.set(item.id, item));
      category.documents.forEach((document) => documents.set(document.id, document));
    });
  });

  return { events, enumRows, categories, documents, validationItems };
}

function syncScalarFieldState(
  holder: FieldStateHolder,
  key: string,
  currentValue: string | number | null | undefined,
  baselineValue: string | number | null | undefined,
  addedByDefault: boolean,
) {
  const fieldState = ensureFieldState(holder, key);
  const derivedIsNew =
    addedByDefault ||
    normaliseComparableText(String(currentValue ?? '')) !== normaliseComparableText(String(baselineValue ?? ''));
  fieldState.isNew = fieldState.isRemoved ? false : fieldState.manualIsNew ?? derivedIsNew;
}

function syncDerivedNewFlags(model: QleWorkbookModel, baseline: QleWorkbookModel | null) {
  const baselineIndex = buildModelIndex(baseline);

  model.events.forEach((event, eventIndex) => {
    event.eventNumber = eventIndex + 1;
    const baselineEvent = baselineIndex.events.get(event.id);
    const eventAdded = !baselineEvent || Boolean(baselineEvent.isNew);
    event.isNew = event.manualIsNew ?? eventAdded;
    syncScalarFieldState(
      event,
      'instructionsEn',
      event.instructionsEn,
      baselineEvent?.instructionsEn,
      eventAdded,
    );
    syncScalarFieldState(
      event,
      'instructionsEs',
      event.instructionsEs,
      baselineEvent?.instructionsEs,
      eventAdded,
    );

    event.enumRows.forEach((row) => {
      const baselineRow = baselineIndex.enumRows.get(row.id);
      const rowAdded = !baselineRow || Boolean(baselineRow.isNew);
      row.isNew = row.manualIsNew ?? rowAdded;
      const rowIsNew = Boolean(row.isNew);
      syncScalarFieldState(row, 'enum', row.enum, baselineRow?.enum, rowIsNew);
      syncScalarFieldState(row, 'en', row.en, baselineRow?.en, rowIsNew);
      syncScalarFieldState(row, 'es', row.es, baselineRow?.es, rowIsNew);
    });

    event.categories.forEach((category) => {
      const validationItems = ensureCategoryValidationItems(category);
      const baselineCategory = baselineIndex.categories.get(category.id);
      const categoryAdded = !baselineCategory || Boolean(baselineCategory.isNew);
      const baselineValidationItems = baselineCategory
        ? ensureCategoryValidationItems(baselineCategory)
        : [];

      validationItems.forEach((item) => {
        const baselineItem = baselineValidationItems.find((candidate) => candidate.id === item.id);
        const itemAdded = !baselineItem || Boolean(baselineItem.isNew);
        item.isNew = item.isRemoved ? false : item.manualIsNew ?? itemAdded;
        syncScalarFieldState(item, 'key', item.key, baselineItem?.key, itemAdded);
        syncScalarFieldState(item, 'value', item.value, baselineItem?.value, itemAdded);
      });

      syncCategoryValidation(category);
      category.isNew = category.manualIsNew ?? categoryAdded;
      syncScalarFieldState(category, 'enum', category.enum, baselineCategory?.enum, categoryAdded);
      syncScalarFieldState(category, 'en', category.en, baselineCategory?.en, categoryAdded);
      syncScalarFieldState(category, 'es', category.es, baselineCategory?.es, categoryAdded);
      syncScalarFieldState(
        category,
        'validation',
        category.validation,
        baselineCategory?.validation,
        categoryAdded,
      );

      category.documents.forEach((document, documentIndex) => {
        document.sort = documentIndex + 1;
        const baselineDocument = baselineIndex.documents.get(document.id);
        const documentAdded = !baselineDocument || Boolean(baselineDocument.isNew);
        document.isNew = document.manualIsNew ?? documentAdded;
        // Use document.isNew (which respects manualIsNew) so that manually marking a
        // document as new also highlights its individual fields.
        const documentIsNew = Boolean(document.isNew);
        syncScalarFieldState(document, 'enum', document.enum, baselineDocument?.enum, documentIsNew);
        syncScalarFieldState(document, 'en', document.en, baselineDocument?.en, documentIsNew);
        syncScalarFieldState(document, 'es', document.es, baselineDocument?.es, documentIsNew);
      });
    });
  });
}

function clearWorkbookHighlights(model: QleWorkbookModel): QleWorkbookModel {
  const next = cloneModel(model);

  next.events.forEach((event, eventIndex) => {
    event.eventNumber = eventIndex + 1;
    event.isNew = false;
    event.isRemoved = false;
    event.manualIsNew = null;
    Object.values(event.fieldStates ?? {}).forEach((fieldState) => {
      if (!fieldState) return;
      fieldState.isNew = false;
      fieldState.manualIsNew = null;
      fieldState.isRemoved = false;
    });

    event.enumRows.forEach((row) => {
      row.isNew = false;
      row.isRemoved = false;
      row.manualIsNew = null;
      Object.values(row.fieldStates ?? {}).forEach((fieldState) => {
        if (!fieldState) return;
        fieldState.isNew = false;
        fieldState.manualIsNew = null;
        fieldState.isRemoved = false;
      });
    });

    event.categories.forEach((category) => {
      category.isNew = false;
      category.isRemoved = false;
      category.manualIsNew = null;
      Object.values(category.fieldStates ?? {}).forEach((fieldState) => {
        if (!fieldState) return;
        fieldState.isNew = false;
        fieldState.manualIsNew = null;
        fieldState.isRemoved = false;
      });
      ensureCategoryValidationItems(category).forEach((item) => {
        item.isNew = false;
        item.manualIsNew = null;
        item.isRemoved = false;
        Object.values(item.fieldStates ?? {}).forEach((fieldState) => {
          if (!fieldState) return;
          fieldState.isNew = false;
          fieldState.manualIsNew = null;
          fieldState.isRemoved = false;
        });
      });
      syncCategoryValidation(category);

      category.documents.forEach((document, documentIndex) => {
        document.sort = documentIndex + 1;
        document.isNew = false;
        document.isRemoved = false;
        document.manualIsNew = null;
        Object.values(document.fieldStates ?? {}).forEach((fieldState) => {
          if (!fieldState) return;
          fieldState.isNew = false;
          fieldState.manualIsNew = null;
          fieldState.isRemoved = false;
        });
      });
    });
  });

  return next;
}

function preserveImportedWorkbookHighlights(model: QleWorkbookModel): QleWorkbookModel {
  model.events.forEach((event, eventIndex) => {
    event.eventNumber = eventIndex + 1;
    if (event.isNew) {
      event.manualIsNew = true;
    }
    Object.values(event.fieldStates ?? {}).forEach((fieldState) => {
      if (fieldState?.isNew) {
        fieldState.manualIsNew = true;
      }
    });

    event.enumRows.forEach((row) => {
      if (row.isNew) {
        row.manualIsNew = true;
      }
      Object.values(row.fieldStates ?? {}).forEach((fieldState) => {
        if (fieldState?.isNew) {
          fieldState.manualIsNew = true;
        }
      });
    });

    event.categories.forEach((category) => {
      if (category.isNew) {
        category.manualIsNew = true;
      }
      Object.values(category.fieldStates ?? {}).forEach((fieldState) => {
        if (fieldState?.isNew) {
          fieldState.manualIsNew = true;
        }
      });

      ensureCategoryValidationItems(category).forEach((item) => {
        if (item.isNew) {
          item.manualIsNew = true;
        }
        Object.values(item.fieldStates ?? {}).forEach((fieldState) => {
          if (fieldState?.isNew) {
            fieldState.manualIsNew = true;
          }
        });
      });

      category.documents.forEach((document, documentIndex) => {
        document.sort = documentIndex + 1;
        if (document.isNew) {
          document.manualIsNew = true;
        }
        Object.values(document.fieldStates ?? {}).forEach((fieldState) => {
          if (fieldState?.isNew) {
            fieldState.manualIsNew = true;
          }
        });
      });
    });
  });

  return model;
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

const EVENT_TITLE_TOKEN_ALIASES: Record<string, string> = {
  ADDRESSES: 'ADDRESS',
  ADOPTED: 'ADOPTION',
  ADOPTING: 'ADOPTION',
  CHANGED: 'CHANGE',
  CHANGES: 'CHANGE',
  CHILDREN: 'CHILD',
  CITIZEN: 'CITIZENSHIP',
  CITIZENSHIP: 'CITIZENSHIP',
  COVERED: 'COVERAGE',
  COV: 'COVERAGE',
  DEPENDENTS: 'DEPENDENT',
  DIVORCED: 'DIVORCE',
  DIVORCING: 'DIVORCE',
  FMLA: 'FMLA',
  GAINED: 'GAIN',
  GAINING: 'GAIN',
  IMMIGRANT: 'IMMIGRATION',
  IMMIGRANTS: 'IMMIGRATION',
  INCARCERATED: 'INCARCERATION',
  INCOMES: 'INCOME',
  LOST: 'LOSS',
  LOSING: 'LOSS',
  MARRIED: 'MARRIAGE',
  MOVED: 'MOVE',
  MOVES: 'MOVE',
  MOVING: 'MOVE',
  PARTNERSHIP: 'PARTNER',
  PARTNERS: 'PARTNER',
  RELEASED: 'RELEASE',
  RESIDENCY: 'RESIDENCE',
  SPOUSES: 'SPOUSE',
  STATUSES: 'STATUS',
};

const EVENT_TITLE_NOISE_TOKENS = new Set([
  'A',
  'AN',
  'AND',
  'AS',
  'AT',
  'BE',
  'BY',
  'DATE',
  'FOR',
  'FROM',
  'IN',
  'INTO',
  'IS',
  'NOW',
  'OF',
  'ON',
  'OR',
  'OUTSIDE',
  'THE',
  'TO',
  'WITH',
  'WITHIN',
]);

const EVENT_TITLE_FALLBACK_NOISE_TOKENS = new Set([
  ...EVENT_TITLE_NOISE_TOKENS,
  'CHANGE',
  'CURRENT',
  'ELIGIBLE',
  'FUTURE',
  'NEW',
  'PROOF',
]);

const EVENT_TITLE_DISPLAY_TOKENS: Record<string, string> = {
  COBRA: 'COBRA',
  FMLA: 'FMLA',
  SEP: 'SEP',
  UI: 'UI',
  US: 'US',
};

function canonicalizeEventTitleToken(token: string): string {
  return EVENT_TITLE_TOKEN_ALIASES[token] ?? token;
}

function tokenizeEventEnum(enumValue: string): string[] {
  return enumValue
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean)
    .map(canonicalizeEventTitleToken)
    .filter((token) => !EVENT_TITLE_NOISE_TOKENS.has(token));
}

function hasAnyEventTitleToken(tokens: Set<string>, matches: string[]): boolean {
  return matches.some((match) => tokens.has(match));
}

function hasAllEventTitleTokens(tokens: Set<string>, matches: string[]): boolean {
  return matches.every((match) => tokens.has(match));
}

function formatEventTitleToken(token: string): string {
  return EVENT_TITLE_DISPLAY_TOKENS[token] ?? `${token.slice(0, 1)}${token.slice(1).toLowerCase()}`;
}

function normaliseEventTitleWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function simplifyEventLabelForTitle(value: string): string {
  return normaliseEventTitleWhitespace(value)
    .replace(/^change in\s+/i, '')
    .replace(/^gain eligible\s+/i, '')
    .replace(/^gain of\s+/i, '')
    .replace(/^loss of\s+/i, '')
    .replace(/^new\s+/i, '')
    .replace(/[.:;,\s]+$/g, '');
}

function isUsefulEventLabelTitle(value: string): boolean {
  if (!value) return false;
  if (value.length > 32) return false;
  if ((value.match(/\b\w+\b/g) ?? []).length > 4) return false;
  return true;
}

function buildEventTitleFromLabels(event: QleEvent): string | null {
  const simplifiedLabels = event.enumRows
    .map((row) => simplifyEventLabelForTitle(row.en))
    .filter(Boolean);

  if (simplifiedLabels.length === 0) {
    return null;
  }

  const uniqueLabels = Array.from(new Set(simplifiedLabels));

  if (uniqueLabels.length === 1 && isUsefulEventLabelTitle(uniqueLabels[0])) {
    return uniqueLabels[0];
  }

  if (event.enumRows.length === 1 && isUsefulEventLabelTitle(uniqueLabels[0])) {
    return uniqueLabels[0];
  }

  return null;
}

function buildFallbackEventTitle(event: QleEvent): string {
  const counts = new Map<string, { count: number; firstSeen: number }>();
  let order = 0;

  event.enumRows.forEach((row) => {
    tokenizeEventEnum(row.enum).forEach((token) => {
      if (EVENT_TITLE_FALLBACK_NOISE_TOKENS.has(token)) return;
      const current = counts.get(token);
      if (current) {
        current.count += 1;
        return;
      }
      counts.set(token, { count: 1, firstSeen: order });
      order += 1;
    });
  });

  const rankedTokens = Array.from(counts.entries())
    .sort((left, right) => {
      if (right[1].count !== left[1].count) {
        return right[1].count - left[1].count;
      }
      return left[1].firstSeen - right[1].firstSeen;
    })
    .slice(0, 3)
    .map(([token]) => token);

  if (rankedTokens.length === 0) {
    return 'New Event';
  }

  return rankedTokens.map(formatEventTitleToken).join(' / ');
}

function deriveEventShortName(event: QleEvent): string {
  if (isUnsupportedUiOnlyWorkbookEvent(event)) {
    return 'Unsupported Event';
  }

  const labelTitle = buildEventTitleFromLabels(event);
  if (labelTitle) {
    return labelTitle;
  }

  const tokens = new Set(event.enumRows.flatMap((row) => tokenizeEventEnum(row.enum)));

  if (hasAnyEventTitleToken(tokens, ['DEATH'])) {
    return 'Death';
  }
  if (tokens.has('MARRIAGE') && !hasAnyEventTitleToken(tokens, ['DIVORCE', 'DOMESTIC', 'PARTNER'])) {
    return 'Marriage';
  }
  if (tokens.has('DIVORCE') && !hasAnyEventTitleToken(tokens, ['MARRIAGE', 'DOMESTIC', 'PARTNER'])) {
    return 'Divorce';
  }
  if (tokens.has('BIRTH') && !tokens.has('ADOPTION')) {
    return 'Birth';
  }
  if (tokens.has('ADOPTION') && !tokens.has('BIRTH')) {
    return 'Adoption';
  }
  if (hasAnyEventTitleToken(tokens, ['TRIBAL', 'INDIAN', 'ALASKA', 'NATIVE', 'AI', 'AN'])) {
    return 'Tribal Status';
  }
  if (hasAnyEventTitleToken(tokens, ['IMMIGRATION', 'PRESENCE', 'LEGAL', 'CITIZENSHIP'])) {
    return 'Immigration Status';
  }
  if (hasAnyEventTitleToken(tokens, ['MARRIAGE', 'DIVORCE', 'DOMESTIC', 'PARTNER'])) {
    return 'Marriage / Divorce';
  }
  if (hasAnyEventTitleToken(tokens, ['BIRTH', 'ADOPTION', 'FOSTER'])) {
    return 'Birth / Adoption';
  }
  if (hasAnyEventTitleToken(tokens, ['ADDRESS', 'MOVE', 'RESIDENCE', 'STATE'])) {
    return 'Address Change';
  }
  if (
    hasAllEventTitleTokens(tokens, ['LOSS', 'COVERAGE']) ||
    (tokens.has('COBRA') && tokens.has('COVERAGE'))
  ) {
    return 'Loss of Coverage';
  }
  if (hasAllEventTitleTokens(tokens, ['GAIN', 'COVERAGE'])) {
    return 'Gain of Coverage';
  }
  if (hasAnyEventTitleToken(tokens, ['INCOME'])) {
    return 'Income Change';
  }
  if (hasAnyEventTitleToken(tokens, ['DEPENDENT', 'CHILD', 'SPOUSE'])) {
    return 'Dependent Change';
  }
  if (hasAnyEventTitleToken(tokens, ['INCARCERATION', 'RELEASE'])) {
    return 'Incarceration';
  }

  return buildFallbackEventTitle(event);
}

function formatEventGroupLabel(event: QleEvent): string {
  return `${deriveEventShortName(event)} (${event.eventNumber})`;
}

function formatReviewGroupTitle(event: QleEvent): string {
  return `Event ${event.eventNumber} - ${deriveEventShortName(event)}`;
}

function buildReviewEventKey(eventNumber: number | null): string {
  return `event:${eventNumber ?? 'other'}`;
}

function buildReviewEnumKey(eventNumber: number | null, enumName: string): string {
  return `enum:${eventNumber ?? 'other'}:${enumName.trim().toUpperCase()}`;
}

function buildReviewCategoryKey(eventNumber: number | null, categoryEnum: string): string {
  return `category:${eventNumber ?? 'other'}:${categoryEnum.trim().toUpperCase()}`;
}

function buildReviewDocumentKey(
  eventNumber: number | null,
  categoryEnum: string,
  documentEnum: string,
): string {
  return `document:${eventNumber ?? 'other'}:${categoryEnum.trim().toUpperCase()}:${documentEnum.trim().toUpperCase()}`;
}

function applyEventTitlesToReviewGroups(
  groups: ReviewSummaryGroup[],
  model: QleWorkbookModel | null,
): ReviewSummaryGroup[] {
  if (!model) return groups;

  const titleByEventNumber = new Map<number, string>(
    model.events.map((event) => [event.eventNumber, formatReviewGroupTitle(event)]),
  );

  return groups.map((group) =>
    group.eventNumber == null
      ? group
      : {
          ...group,
          title: titleByEventNumber.get(group.eventNumber) ?? group.title,
        },
  );
}

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

function buildReviewEntryKey(entry: DiffEntry): string | null {
  if (entry.entity === 'event') {
    const match = entry.path.match(/^Event\s+(\d+)/i);
    return buildReviewEventKey(match ? Number(match[1]) : null);
  }

  if (entry.entity === 'enum') {
    const parsed = parseEventEnumPath(entry.path);
    return buildReviewEnumKey(parsed.eventNumber, parsed.enumName);
  }

  if (entry.entity === 'category') {
    const parsed = parseCategoryPath(entry.path);
    return buildReviewCategoryKey(parsed.eventNumber, parsed.categoryEnum);
  }

  if (entry.entity === 'document') {
    const parsed = parseDocumentPath(entry.path);
    return buildReviewDocumentKey(parsed.eventNumber, parsed.categoryEnum, parsed.documentEnum);
  }

  return null;
}

function buildMarkedNewReviewGroups(
  model: QleWorkbookModel | null,
  reviewEntries: DiffEntry[],
  originalModel: QleWorkbookModel | null = null,
): ReviewSummaryGroup[] {
  if (!model) return [];
  const groups = new Map<string, ReviewSummaryGroup>();
  const originalIndex = buildModelIndex(originalModel);
  const existingReviewKeys = new Set(
    reviewEntries
      .map((entry) => buildReviewEntryKey(entry))
      .filter((key): key is string => Boolean(key)),
  );

  model.events.forEach((event) => {
    const activeEnumRows = event.enumRows.filter((row) => !row.isRemoved);
    const eventLikelyRepresentsInstructions =
      event.isNew && (activeEnumRows.length === 0 || activeEnumRows.some((row) => !row.isNew));

    if (
      eventLikelyRepresentsInstructions &&
      !event.isRemoved &&
      !existingReviewKeys.has(buildReviewEventKey(event.eventNumber))
    ) {
      pushReviewGroupItem(
        groups,
        event.eventNumber,
        [
          'Update event instructions:',
          `  Event: Event ${event.eventNumber}`,
          `  English instructions: "${event.instructionsEn}"`,
          `  Spanish instructions: "${event.instructionsEs}"`,
        ].join('\n'),
      );
    }

    if (!event.isRemoved && !existingReviewKeys.has(buildReviewEventKey(event.eventNumber))) {
      if (getFieldState(event, 'instructionsEn')?.isNew) {
        pushReviewGroupItem(
          groups,
          event.eventNumber,
          formatFieldStateReviewItem(
            'Mark field as new',
            [{ label: 'Event', value: `Event ${event.eventNumber}` }],
            'English instructions',
            event.instructionsEn,
          ),
        );
      }
      if (getFieldState(event, 'instructionsEs')?.isNew) {
        pushReviewGroupItem(
          groups,
          event.eventNumber,
          formatFieldStateReviewItem(
            'Mark field as new',
            [{ label: 'Event', value: `Event ${event.eventNumber}` }],
            'Spanish instructions',
            event.instructionsEs,
          ),
        );
      }
    }

    event.enumRows.forEach((row) => {
      const rowKey = buildReviewEnumKey(event.eventNumber, row.enum);
      if (
        row.isNew &&
        !row.isRemoved &&
        row.enum.trim() &&
        !existingReviewKeys.has(rowKey)
      ) {
        pushReviewGroupItem(
          groups,
          event.eventNumber,
          formatReviewItemWithLabels('Add enum', [{ label: 'Enum', value: row.enum }], row.en, row.es),
        );
      }

      if (!row.isRemoved && !row.isNew && !existingReviewKeys.has(rowKey)) {
        if (getFieldState(row, 'enum')?.isNew) {
          pushReviewGroupItem(
            groups,
            event.eventNumber,
            formatFieldStateReviewItem(
              'Mark field as new',
              [{ label: 'Event', value: `Event ${event.eventNumber}` }],
              'Enum',
              row.enum,
            ),
          );
        }
        if (getFieldState(row, 'en')?.isNew) {
          pushReviewGroupItem(
            groups,
            event.eventNumber,
            formatFieldStateReviewItem(
              'Mark field as new',
              [{ label: 'Enum', value: row.enum }],
              'English label',
              row.en,
            ),
          );
        }
        if (getFieldState(row, 'es')?.isNew) {
          pushReviewGroupItem(
            groups,
            event.eventNumber,
            formatFieldStateReviewItem(
              'Mark field as new',
              [{ label: 'Enum', value: row.enum }],
              'Spanish label',
              row.es,
            ),
          );
        }
      }
    });

    event.categories.forEach((category) => {
      const originalCategory = originalIndex.categories.get(category.id);
      const originalValidationItems = originalCategory
        ? ensureCategoryValidationItems(originalCategory)
        : [];
      const categoryKey = buildReviewCategoryKey(event.eventNumber, category.enum);
      if (
        category.isNew &&
        !category.isRemoved &&
        category.enum.trim() &&
        !existingReviewKeys.has(categoryKey)
      ) {
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

      if (!category.isRemoved && !category.isNew && !existingReviewKeys.has(categoryKey)) {
        if (getFieldState(category, 'enum')?.isNew) {
          pushReviewGroupItem(
            groups,
            event.eventNumber,
            formatFieldStateReviewItem(
              'Mark field as new',
              [{ label: 'Event', value: `Event ${event.eventNumber}` }],
              'Category enum',
              category.enum,
            ),
          );
        }
        if (getFieldState(category, 'en')?.isNew) {
          pushReviewGroupItem(
            groups,
            event.eventNumber,
            formatFieldStateReviewItem(
              'Mark field as new',
              [{ label: 'Category', value: category.enum }],
              'English label',
              category.en,
            ),
          );
        }
        if (getFieldState(category, 'es')?.isNew) {
          pushReviewGroupItem(
            groups,
            event.eventNumber,
            formatFieldStateReviewItem(
              'Mark field as new',
              [{ label: 'Category', value: category.enum }],
              'Spanish label',
              category.es,
            ),
          );
        }
        if (getFieldState(category, 'validation')?.isNew && (category.validationItems ?? []).length === 0) {
          pushReviewGroupItem(
            groups,
            event.eventNumber,
            [
              'Update validation rules:',
              `  Category: ${category.enum}`,
              `  Validation rules: ${category.validation}`,
            ].join('\n'),
          );
        }
      }

      (category.validationItems ?? []).forEach((item, itemIndex) => {
        const originalItem =
          originalValidationItems.find((candidate) => candidate.id === item.id) ?? null;
        const keyFieldIsNew = Boolean(getFieldState(item, 'key')?.isNew);
        const valueFieldIsNew = Boolean(getFieldState(item, 'value')?.isNew);
        if (!category.isRemoved && item.isNew && !item.isRemoved && item.key.trim()) {
          pushReviewGroupItem(
            groups,
            event.eventNumber,
            formatValidationRuleUpdateReviewItem(category.enum, item, itemIndex),
          );
          return;
        }

        if (category.isRemoved || item.isRemoved) {
          return;
        }

        if (originalItem && hasComparableTextChanged(item.key, originalItem.key)) {
          pushReviewGroupItem(
            groups,
            event.eventNumber,
            formatValidationRuleUpdateReviewItem(category.enum, item, itemIndex, originalItem),
          );
          return;
        }

        if (originalItem && hasComparableTextChanged(item.value, originalItem.value)) {
          pushReviewGroupItem(
            groups,
            event.eventNumber,
            formatValidationRuleUpdateReviewItem(category.enum, item, itemIndex, originalItem),
          );
          return;
        }

        if (!item.isRemoved && valueFieldIsNew && (!keyFieldIsNew || isFixedValidationRuleKey(item.key))) {
          pushReviewGroupItem(
            groups,
            event.eventNumber,
            formatValidationRuleUpdateReviewItem(category.enum, item, itemIndex, originalItem),
          );
          return;
        }

        if (item.isNew || !validationItemHasFieldStateChanges(item)) {
          return;
        }

        if (getFieldState(item, 'key')?.isNew) {
          pushReviewGroupItem(
            groups,
            event.eventNumber,
            formatValidationItemFieldReviewItem(
              'Mark field as new',
              category.enum,
              item,
              itemIndex,
              'Rule key',
              item.key,
            ),
          );
        }

        if (getFieldState(item, 'value')?.isNew) {
          pushReviewGroupItem(
            groups,
            event.eventNumber,
            formatValidationItemFieldReviewItem(
              'Mark field as new',
              category.enum,
              item,
              itemIndex,
              'Rule value',
              item.value,
            ),
          );
        }
      });

      category.documents.forEach((document) => {
        const documentKey = buildReviewDocumentKey(event.eventNumber, category.enum, document.enum);
        if (
          document.isNew &&
          !document.isRemoved &&
          !category.isRemoved &&
          document.enum.trim() &&
          !existingReviewKeys.has(documentKey)
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

        if (!document.isRemoved && !document.isNew && !category.isRemoved && !existingReviewKeys.has(documentKey)) {
          if (getFieldState(document, 'enum')?.isNew) {
            pushReviewGroupItem(
              groups,
              event.eventNumber,
              formatFieldStateReviewItem(
                'Mark field as new',
                [{ label: 'Category', value: category.enum }],
                'Document enum',
                document.enum,
              ),
            );
          }
          if (getFieldState(document, 'en')?.isNew) {
            pushReviewGroupItem(
              groups,
              event.eventNumber,
              formatFieldStateReviewItem(
                'Mark field as new',
                [
                  { label: 'Category', value: category.enum },
                  { label: 'Document', value: document.enum },
                ],
                'English label',
                document.en,
              ),
            );
          }
          if (getFieldState(document, 'es')?.isNew) {
            pushReviewGroupItem(
              groups,
              event.eventNumber,
              formatFieldStateReviewItem(
                'Mark field as new',
                [
                  { label: 'Category', value: category.enum },
                  { label: 'Document', value: document.enum },
                ],
                'Spanish label',
                document.es,
              ),
            );
          }
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
    if (getFieldState(event, 'instructionsEn')?.isRemoved) {
      pushReviewGroupItem(
        groups,
        event.eventNumber,
        formatFieldStateReviewItem(
          'Remove field',
          [{ label: 'Event', value: `Event ${event.eventNumber}` }],
          'English instructions',
          event.instructionsEn,
        ),
      );
    }
    if (getFieldState(event, 'instructionsEs')?.isRemoved) {
      pushReviewGroupItem(
        groups,
        event.eventNumber,
        formatFieldStateReviewItem(
          'Remove field',
          [{ label: 'Event', value: `Event ${event.eventNumber}` }],
          'Spanish instructions',
          event.instructionsEs,
        ),
      );
    }

    if (event.isRemoved) {
      pushReviewGroupItem(groups, event.eventNumber, `Remove event: Event ${event.eventNumber}`);
    }

    event.enumRows.forEach((row) => {
      if (getFieldState(row, 'enum')?.isRemoved) {
        pushReviewGroupItem(
          groups,
          event.eventNumber,
          formatFieldStateReviewItem(
            'Remove field',
            [{ label: 'Event', value: `Event ${event.eventNumber}` }],
            'Enum',
            row.enum,
          ),
        );
      }
      if (getFieldState(row, 'en')?.isRemoved) {
        pushReviewGroupItem(
          groups,
          event.eventNumber,
          formatFieldStateReviewItem(
            'Remove field',
            [{ label: 'Enum', value: row.enum }],
            'English label',
            row.en,
          ),
        );
      }
      if (getFieldState(row, 'es')?.isRemoved) {
        pushReviewGroupItem(
          groups,
          event.eventNumber,
          formatFieldStateReviewItem(
            'Remove field',
            [{ label: 'Enum', value: row.enum }],
            'Spanish label',
            row.es,
          ),
        );
      }
      if (row.isRemoved) {
        pushReviewGroupItem(groups, event.eventNumber, `Remove enum: ${row.enum}`);
      }
    });

    event.categories.forEach((category) => {
      if (getFieldState(category, 'enum')?.isRemoved) {
        pushReviewGroupItem(
          groups,
          event.eventNumber,
          formatFieldStateReviewItem(
            'Remove field',
            [{ label: 'Event', value: `Event ${event.eventNumber}` }],
            'Category enum',
            category.enum,
          ),
        );
      }
      if (getFieldState(category, 'en')?.isRemoved) {
        pushReviewGroupItem(
          groups,
          event.eventNumber,
          formatFieldStateReviewItem(
            'Remove field',
            [{ label: 'Category', value: category.enum }],
            'English label',
            category.en,
          ),
        );
      }
      if (getFieldState(category, 'es')?.isRemoved) {
        pushReviewGroupItem(
          groups,
          event.eventNumber,
          formatFieldStateReviewItem(
            'Remove field',
            [{ label: 'Category', value: category.enum }],
            'Spanish label',
            category.es,
          ),
        );
      }
      if (
        getFieldState(category, 'validation')?.isRemoved &&
        !category.isRemoved &&
        (category.validationItems ?? []).length === 0
      ) {
        pushReviewGroupItem(
          groups,
          event.eventNumber,
          [
            'Remove field:',
            `  Category: ${category.enum}`,
            `  Validation rules: ${category.validation}`,
          ].join('\n'),
        );
      }
      const removedDocuments = category.documents.filter(
        (document) => (document.isRemoved || category.isRemoved) && document.enum.trim(),
      );
      const removedValidationItems = (category.validationItems ?? []).filter((item) => item.isRemoved);

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

      removedValidationItems.forEach((item, itemIndex) => {
        if (item.key.trim()) {
          pushReviewGroupItem(
            groups,
            event.eventNumber,
            [
              'Remove validation rule:',
              `  Category: ${category.enum}`,
              `  ${item.key.trim()}: ${item.value.trim()}`,
            ].join('\n'),
          );
          return;
        }

        if (getFieldState(item, 'key')?.isRemoved) {
          pushReviewGroupItem(
            groups,
            event.eventNumber,
            formatValidationItemFieldReviewItem(
              'Remove field',
              category.enum,
              item,
              itemIndex,
              'Rule key',
              item.key,
            ),
          );
        }
        if (getFieldState(item, 'value')?.isRemoved) {
          pushReviewGroupItem(
            groups,
            event.eventNumber,
            formatValidationItemFieldReviewItem(
              'Remove field',
              category.enum,
              item,
              itemIndex,
              'Rule value',
              item.value,
            ),
          );
        }
      });

      (category.validationItems ?? []).forEach((item, itemIndex) => {
        if (item.isRemoved || !validationItemHasFieldStateChanges(item)) {
          return;
        }

        if (getFieldState(item, 'key')?.isRemoved) {
          pushReviewGroupItem(
            groups,
            event.eventNumber,
            formatValidationItemFieldReviewItem(
              'Remove field',
              category.enum,
              item,
              itemIndex,
              'Rule key',
              item.key,
            ),
          );
        }
        if (getFieldState(item, 'value')?.isRemoved) {
          pushReviewGroupItem(
            groups,
            event.eventNumber,
            formatValidationItemFieldReviewItem(
              'Remove field',
              category.enum,
              item,
              itemIndex,
              'Rule value',
              item.value,
            ),
          );
        }
      });

      removedDocuments.forEach((document) => {
        if (getFieldState(document, 'enum')?.isRemoved) {
          pushReviewGroupItem(
            groups,
            event.eventNumber,
            formatFieldStateReviewItem(
              'Remove field',
              [{ label: 'Category', value: category.enum }],
              'Document enum',
              document.enum,
            ),
          );
        }
        if (getFieldState(document, 'en')?.isRemoved) {
          pushReviewGroupItem(
            groups,
            event.eventNumber,
            formatFieldStateReviewItem(
              'Remove field',
              [
                { label: 'Category', value: category.enum },
                { label: 'Document', value: document.enum },
              ],
              'English label',
              document.en,
            ),
          );
        }
        if (getFieldState(document, 'es')?.isRemoved) {
          pushReviewGroupItem(
            groups,
            event.eventNumber,
            formatFieldStateReviewItem(
              'Remove field',
              [
                { label: 'Category', value: category.enum },
                { label: 'Document', value: document.enum },
              ],
              'Spanish label',
              document.es,
            ),
          );
        }
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

function formatFieldStateReviewItem(
  prefix: string,
  lines: { label: string; value: string }[],
  fieldLabel: string,
  value: string,
) {
  return [
    `${prefix}:`,
    ...lines.map((line) => `  ${line.label}: ${line.value}`),
    `  ${fieldLabel}: "${value}"`,
  ].join('\n');
}

function formatValidationItemFieldReviewItem(
  prefix: string,
  categoryEnum: string,
  item: QleValidationItem,
  itemIndex: number,
  fieldLabel: string,
  value: string,
) {
  return formatFieldStateReviewItem(
    prefix,
    [
      { label: 'Category', value: categoryEnum },
      { label: 'Validation rule', value: getValidationItemLabel(item, itemIndex) },
    ],
    fieldLabel,
    value,
  );
}

function formatValidationRuleUpdateReviewItem(
  categoryEnum: string,
  item: QleValidationItem,
  itemIndex: number,
  originalItem?: QleValidationItem | null,
) {
  const ruleLabel =
    normaliseComparableText(item.key) ||
    normaliseComparableText(originalItem?.key) ||
    getValidationItemLabel(item, itemIndex);
  const lines = [
    'Update validation rule:',
    `  Category: ${categoryEnum}`,
    `  Validation rule: ${ruleLabel}`,
  ];
  let hasDetailLine = false;
  const keyChanged = originalItem ? hasComparableTextChanged(item.key, originalItem.key) : false;
  const valueChanged = originalItem ? hasComparableTextChanged(item.value, originalItem.value) : false;

  if (keyChanged) {
    lines.push(formatChangedReviewValueLine('Rule key', originalItem?.key, item.key));
    hasDetailLine = true;
  }

  if (valueChanged) {
    lines.push(formatChangedReviewValueLine('Rule value', originalItem?.value, item.value));
    hasDetailLine = true;
  } else if (!originalItem) {
    lines.push(`  Rule value: "${normaliseComparableText(item.value)}"`);
    hasDetailLine = true;
  }

  if (!hasDetailLine) {
    lines.push(`  Rule value: "${normaliseComparableText(item.value)}"`);
  }

  return lines.join('\n');
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
  const originalIndex = buildModelIndex(originalModel ?? null);
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
        entry.kind === 'added' || entry.kind === 'changed'
          ? findCategoryForReview(model ?? null, parsed.eventNumber, parsed.categoryEnum)
          : null;
      const originalCategory =
        entry.kind === 'changed' && category
          ? originalIndex.categories.get(category.id) ?? null
          : null;
      const validationOnlyChange =
        entry.kind === 'changed' &&
        category != null &&
        originalCategory != null &&
        !hasComparableTextChanged(category.enum, originalCategory.enum) &&
        !hasComparableTextChanged(category.en, originalCategory.en) &&
        !hasComparableTextChanged(category.es, originalCategory.es) &&
        hasComparableTextChanged(category.validation, originalCategory.validation);

      if (validationOnlyChange) {
        return;
      }

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
  const markedNewGroups = buildMarkedNewReviewGroups(model ?? null, reviewEntries, originalModel ?? null);
  const summary = mergeReviewGroups(mergeReviewGroups(diffSummary, markedRemovedGroups), markedNewGroups);

  if (summary.length === 0) {
    return [{ eventNumber: null, title: 'Changes', items: ['No structural changes were detected yet.'] }];
  }
  return applyEventTitlesToReviewGroups(summary, model ?? originalModel ?? null);
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

const UPLOAD_FILE_NAME_PATTERN = /^uploadDoc_[A-Z0-9]+(?:_[A-Z0-9]+)*_v?\d+(?:\.\d+)*_\d{2}-\d{2}-\d{4}\.xlsx$/;

type PendingUploadAction = 'import' | 'format';

type PendingUploadState = {
  action: PendingUploadAction;
  originalFile: File;
  stateCode: string;
  versionText: string;
  dateText: string;
  customName: string;
  suggestedNames: string[];
  error: string;
};

function formatUploadDate(date = new Date()): string {
  return [
    String(date.getDate()).padStart(2, '0'),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getFullYear()),
  ].join('-');
}

function isValidUploadFileName(fileName: string): boolean {
  return UPLOAD_FILE_NAME_PATTERN.test(fileName.trim());
}

function sanitiseStateTokenInput(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function normaliseStateToken(value: string): string {
  const cleaned = sanitiseStateTokenInput(value);
  return cleaned || 'STATE';
}

function extractUploadStateSeed(fileName: string): string {
  const extracted = extractStateFromFileName(fileName);
  return extracted === 'State' ? '' : normaliseStateToken(extracted);
}

function extractVersionFromFileName(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '');
  const uploadMatch = base.match(/uploadDoc_[A-Z0-9]+(?:_[A-Z0-9]+)*_v?(\d+(?:\.\d+)*)_/i);
  if (uploadMatch) return uploadMatch[1];

  const versions = base.match(/\d+(?:\.\d+)+/g) ?? [];
  return versions[0] ?? '1.0';
}

function extractDateFromFileName(fileName: string, fallback = new Date()): string {
  const base = fileName.replace(/\.[^.]+$/, '');
  const match =
    base.match(/(\d{2})[.-](\d{2})[.-](\d{4})/) ??
    base.match(/(\d{4})-(\d{2})-(\d{2})/);

  if (!match) {
    return formatUploadDate(fallback);
  }

  if (match[1].length === 4) {
    return `${match[3]}-${match[2]}-${match[1]}`;
  }

  return `${match[1]}-${match[2]}-${match[3]}`;
}

function buildUploadFileName(state: string, version: string, dateText: string): string {
  const normalisedVersion = version.trim().replace(/^v/i, '') || '1.0';
  return `uploadDoc_${normaliseStateToken(state)}_v${normalisedVersion}_${dateText}.xlsx`;
}

function buildUploadFileNameSuggestions(stateCode: string, version: string, detectedDate: string): string[] {
  const state = stateCode.trim();
  if (!state) return [];
  const currentDate = formatUploadDate();

  return [
    buildUploadFileName(state, version, detectedDate),
    buildUploadFileName(state, version, currentDate),
    buildUploadFileName(state, '1.0', currentDate),
  ].filter((value, index, values) => values.indexOf(value) === index);
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

function buildReviewDescription(
  summary: ReviewSummaryGroup[],
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
  const [rebaseModalOpen, setRebaseModalOpen] = useState(false);
  const [readyModalOpen, setReadyModalOpen] = useState(false);
  const [readyJiraKey, setReadyJiraKey] = useState('');
  const [readyResult, setReadyResult] = useState<ReadyForEngineeringResult | null>(null);
  const [jiraCreateStatus, setJiraCreateStatus] = useState<string>('');
  const [jiraCreateError, setJiraCreateError] = useState<string>('');
  const [pendingUpload, setPendingUpload] = useState<PendingUploadState | null>(null);
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
  const [integrationStatus, setIntegrationStatus] = useState<IntegrationStatusResponse | null>(null);
  const [status, setStatus] = useState<string>('Upload a workbook to get started.');
  const [busy, setBusy] = useState(false);
  const [lastAutosavedAt, setLastAutosavedAt] = useState<string | null>(null);
  const [pendingValidationFocusPath, setPendingValidationFocusPath] = useState<string | null>(null);
  const lastScrollYRef = useRef(0);
  const scrollFrameRef = useRef<number | null>(null);
  const collapseAnchorRef = useRef(0);
  const expandAnchorRef = useRef(0);

  const selectedEvent = useMemo(
    () => edited?.events.find((event) => event.id === selectedEventId) ?? null,
    [edited, selectedEventId],
  );
  const selectedEventIndex = useMemo(
    () => edited?.events.findIndex((event) => event.id === selectedEventId) ?? -1,
    [edited, selectedEventId],
  );
  const selectedEventPathPrefix = selectedEventIndex >= 0 ? `events.${selectedEventIndex}` : 'events.0';
  const eventLabelById = useMemo(
    () =>
      new Map(
        (edited?.events ?? []).map((event) => [event.id, formatEventGroupLabel(event)]),
      ),
    [edited],
  );
  const validationIssueByPath = useMemo(
    () => new Map(validationIssues.map((issue) => [issue.path, issue])),
    [validationIssues],
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

  useEffect(() => {
    if (!pendingValidationFocusPath) {
      return;
    }

    const escapedPath = escapeAttributeSelectorValue(pendingValidationFocusPath);
    const target = document.querySelector<HTMLElement>(`[data-field-path="${escapedPath}"]`);
    if (!target) {
      return;
    }

    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.focus();
    setPendingValidationFocusPath(null);
  }, [edited, pendingValidationFocusPath, selectedEventId]);
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

  async function refreshIntegrationStatus() {
    const payload = await fetchJson<IntegrationStatusResponse>('/api/integrations/status');
    setIntegrationStatus(payload);
    return payload;
  }

  useEffect(() => {
    void refreshIntegrationStatus().catch(() => {
      // Integration setup is optional until OAuth env vars are configured.
    });
  }, []);

  function handleConnectIntegration(provider: OAuthProvider) {
    window.location.href = `/api/oauth/${provider}/connect`;
  }

  async function handleDisconnectIntegration(provider: OAuthProvider) {
    const payload = await fetchJson<IntegrationStatusResponse>(`/api/oauth/${provider}`, {
      method: 'DELETE',
    });
    setIntegrationStatus(payload);
    setStatus('Integration disconnected.');
  }

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
          if (delta > 8 && currentY > 60) {
            if (collapseAnchorRef.current === 0) collapseAnchorRef.current = currentY;
            if (currentY - collapseAnchorRef.current > 40) {
              setPmWorkspaceCollapsed(true);
              expandAnchorRef.current = currentY;
              collapseAnchorRef.current = 0;
            }
          } else {
            collapseAnchorRef.current = 0;
          }
        } else {
          if (currentY < 40) {
            setPmWorkspaceCollapsed(false);
            collapseAnchorRef.current = currentY;
            expandAnchorRef.current = 0;
          } else if (delta < -8) {
            if (expandAnchorRef.current === 0) expandAnchorRef.current = currentY;
            if (expandAnchorRef.current - currentY > 60) {
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

  function buildFieldValidationProps(path: string) {
    const issue = validationIssueByPath.get(path);
    return {
      'data-field-path': path,
      'aria-invalid': issue ? true : undefined,
      className: issue ? 'field-error' : undefined,
      title: issue?.message,
    };
  }

  function buildManagedFieldProps(holder: FieldStateHolder, fieldKey: string, path: string) {
    const issue = validationIssueByPath.get(path);
    const fieldState = getFieldState(holder, fieldKey);
    const className = [
      issue ? 'field-error' : '',
      fieldState?.isRemoved ? 'field-removed' : '',
      fieldState?.isNew && !fieldState?.isRemoved ? 'field-new' : '',
    ]
      .filter(Boolean)
      .join(' ');

    return {
      'data-field-path': path,
      'aria-invalid': issue ? true : undefined,
      className: className || undefined,
      title: issue?.message,
    };
  }

  function renderFieldActionRow(
    target: FieldStateHolder,
    fieldKey: string,
    onToggleNew: (checked: boolean) => void,
    onToggleRemove: () => void,
    onDelete: () => void,
    options: FieldActionRowOptions = {},
  ) {
    const fieldState = getFieldState(target, fieldKey);
    const scopeLabel = options.scopeLabel ?? 'field';
    const isIconOnly = options.iconOnly ?? true;
    const revealOnHover = options.revealOnHover ?? true;
    const className = [
      'field-action-row',
      isIconOnly ? 'icon-only' : '',
      revealOnHover ? 'reveal-on-hover' : '',
      fieldStateHasChanges(fieldState) ? 'is-active' : '',
    ]
      .filter(Boolean)
      .join(' ');

    if (isIconOnly) {
      return (
        <div className={className}>
          <button
            type="button"
            className={`ghost icon-only-button field-action-icon new-action-icon${fieldState?.isNew ? ' is-active' : ''}`}
            title={fieldState?.isNew ? `Unmark ${scopeLabel} as new` : `Mark ${scopeLabel} as new`}
            aria-label={fieldState?.isNew ? `Unmark ${scopeLabel} as new` : `Mark ${scopeLabel} as new`}
            aria-pressed={Boolean(fieldState?.isNew)}
            disabled={Boolean(fieldState?.isRemoved)}
            onClick={() => onToggleNew(!Boolean(fieldState?.isNew))}
          >
            <NewBadgeIcon />
          </button>
          <button
            type="button"
            className={`${
              fieldState?.isRemoved ? 'ghost' : 'ghost danger'
            } icon-only-button field-action-icon${fieldState?.isRemoved ? ' is-active' : ''}`}
            title={fieldState?.isRemoved ? `Restore ${scopeLabel}` : `Mark ${scopeLabel} as removed`}
            aria-label={fieldState?.isRemoved ? `Restore ${scopeLabel}` : `Mark ${scopeLabel} as removed`}
            aria-pressed={Boolean(fieldState?.isRemoved)}
            onClick={onToggleRemove}
          >
            {fieldState?.isRemoved ? <UndoIcon /> : <RemoveFileIcon />}
          </button>
          <button
            type="button"
            className="ghost danger icon-only-button field-action-icon"
            title={`Delete ${scopeLabel}`}
            aria-label={`Delete ${scopeLabel}`}
            onClick={onDelete}
          >
            <TrashIcon />
          </button>
        </div>
      );
    }

    return (
      <div className={className}>
        <label className="checkbox-row field-action-toggle">
          <input
            type="checkbox"
            checked={Boolean(fieldState?.isNew)}
            disabled={Boolean(fieldState?.isRemoved)}
            onBlur={noteAutosave}
            onChange={(event) => onToggleNew(event.target.checked)}
          />
          New
        </label>
        <button
          type="button"
          className={fieldState?.isRemoved ? 'ghost icon-button' : 'ghost danger icon-button'}
          onClick={onToggleRemove}
          title={fieldState?.isRemoved ? 'Restore this field' : 'Mark this field as removed'}
        >
          {fieldState?.isRemoved ? <UndoIcon /> : <RemoveFileIcon />}
          <span>{fieldState?.isRemoved ? 'Restore' : 'Remove'}</span>
        </button>
        <button type="button" className="ghost danger" onClick={onDelete}>
          Delete
        </button>
      </div>
    );
  }

  function handleSelectValidationIssue(issue: ValidationIssue) {
    if (!edited) return;

    const eventMatch = issue.path.match(/^events\.(\d+)/);
    if (eventMatch) {
      const targetEvent = edited.events[Number(eventMatch[1])];
      if (targetEvent) {
        setSelectedEventId(targetEvent.id);
      }
    }

    setPendingValidationFocusPath(issue.path);
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

  async function handleWorkbookUpload(action: PendingUploadAction, file: File) {
    if (action === 'import') {
      await handleImport(file);
      return;
    }
    await handleFormatFirst(file);
  }

  function beginWorkbookUpload(action: PendingUploadAction, file: File) {
    if (isValidUploadFileName(file.name)) {
      void handleWorkbookUpload(action, file);
      return;
    }

    const stateCode =
      extractUploadStateSeed(file.name) ||
      extractUploadStateSeed(edited?.fileName ?? '') ||
      extractUploadStateSeed(original?.fileName ?? '') ||
      extractUploadStateSeed(stagedFormattedModel?.fileName ?? '');
    const versionText = extractVersionFromFileName(file.name);
    const dateText = extractDateFromFileName(file.name);
    const suggestions = buildUploadFileNameSuggestions(stateCode, versionText, dateText);
    setPendingUpload({
      action,
      originalFile: file,
      stateCode,
      versionText,
      dateText,
      customName: suggestions[0] ?? '',
      suggestedNames: suggestions,
      error: '',
    });
  }

  async function handleSavePendingUploadName() {
    if (!pendingUpload) return;
    const nextName = pendingUpload.customName.trim();
    if (!isValidUploadFileName(nextName)) {
      setPendingUpload((current) =>
        current
          ? {
              ...current,
              error: 'Use uploadDoc_<state>_<version>_<date>.xlsx. Example: uploadDoc_PA_1.4_26-05-2026.xlsx',
            }
          : current,
      );
      return;
    }

    const renamedFile = new File([pendingUpload.originalFile], nextName, {
      type: pendingUpload.originalFile.type,
      lastModified: pendingUpload.originalFile.lastModified,
    });
    const action = pendingUpload.action;
    setPendingUpload(null);
    await handleWorkbookUpload(action, renamedFile);
  }

  function handlePendingUploadStateCodeChange(value: string) {
    setPendingUpload((current) => {
      if (!current) return current;
      const nextStateCode = sanitiseStateTokenInput(value);
      const nextSuggestions = buildUploadFileNameSuggestions(
        nextStateCode,
        current.versionText,
        current.dateText,
      );
      const shouldReplaceCustomName =
        !current.customName.trim() || current.suggestedNames.includes(current.customName);
      return {
        ...current,
        stateCode: nextStateCode,
        suggestedNames: nextSuggestions,
        customName: shouldReplaceCustomName
          ? nextSuggestions[0] ?? current.customName
          : current.customName,
        error: '',
      };
    });
  }

  function handlePendingUploadSuggestedNameSelect(name: string) {
    setPendingUpload((current) =>
      current ? { ...current, customName: name, error: '' } : current,
    );
  }

  function handlePendingUploadCustomNameChange(value: string) {
    setPendingUpload((current) =>
      current ? { ...current, customName: value, error: '' } : current,
    );
  }

  async function handleImport(file: File) {
    setBusy(true);
    setStatus(`Importing ${file.name}...`);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const importedModel = await fetchJson<QleWorkbookModel>('/api/import-workbook', {
        method: 'POST',
        body: formData,
      });
      const model = preserveImportedWorkbookHighlights(importedModel);
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
      const formattedModel = preserveImportedWorkbookHighlights(payload.model);
      setStagedFormattedModel(formattedModel);
      setOriginal(cloneModel(formattedModel));
      setDownloadedModel(cloneModel(formattedModel));
      setEdited(cloneModel(formattedModel));
      setSelectedEventId(formattedModel.events[0]?.id ?? null);
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
        formattedModel,
        `Formatted ${file.name}, saved ${payload.fileName} to ${payload.savedPath}, and loaded ${formattedModel.events.length} events into the dashboard.`,
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
    const model = preserveImportedWorkbookHighlights(cloneModel(stagedFormattedModel));
    setOriginal(cloneModel(model));
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
      applyValidationState(
      model,
      `Loaded formatted workbook for editing: ${model.fileName}`,
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
    if (shouldBlockDownloadForValidation(issues)) {
      setStatus('Download blocked. Complete all required fields first.');
      return;
    }
    setBusy(true);
    setStatus(
      issues.length > 0
        ? 'Saving updates and generating the formatted workbook with validation warnings still present...'
        : 'Saving updates and generating the formatted workbook...',
    );
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

  function handleRebaseWorkbook() {
    if (!edited) return;

    const rebased = clearWorkbookHighlights(edited);
    setOriginal(cloneModel(rebased));
    setDownloadedModel(cloneModel(rebased));
    setEdited(cloneModel(rebased));
    setSelectedEventId(rebased.events.find((event) => event.id === selectedEventId)?.id ?? rebased.events[0]?.id ?? null);
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
    setLastAutosavedAt(null);
    setRebaseModalOpen(false);
    applyValidationState(
      rebased,
      'Current workbook is now the base document. Existing new highlights were cleared and future edits will be tracked from this version.',
    );
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
    const description = buildReviewDescription(reviewSummary);
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

  function handleDeveloperJiraKeyChange(value: string) {
    setDeveloperJiraKey(value.toUpperCase());
    setDeveloperStageResult(null);
    setDeveloperApprovalCaptured(false);
  }

  async function handleReviewChanges() {
    if (!original || !edited) return;
    const snapshot = buildCurrentWorkbookSnapshot();
    if (!snapshot) return;
    const issues = validateWorkbookModel(snapshot);
    setValidationIssues(issues);
    if (shouldBlockDownloadForValidation(issues)) {
      setStatus('Review download blocked. Complete all required fields first.');
      return;
    }
    setBusy(true);
    setStatus(
      issues.length > 0
        ? 'Preparing review with validation warnings still present...'
        : 'Preparing review changes...',
    );
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
      setStatus(
        issues.length > 0
          ? 'Review is ready. Validation warnings are still present, but you can continue reviewing and download the latest workbook.'
          : 'Review is ready.',
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to prepare review changes.';
      setStatus(`Review changes failed. ${message}`);
      throw error;
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
    <div className={`app-shell ${sidebarExpanded ? 'sidebar-expanded' : 'sidebar-collapsed'}`}>
      <SidebarRail
        activeFlow={activeFlow}
        sidebarExpanded={sidebarExpanded}
        hasWorkbook={Boolean(edited)}
        busy={busy}
        hasUnsavedChanges={hasUnsavedChanges}
        onToggleSidebar={() => setSidebarExpanded((current) => !current)}
        onSelectFlow={(flow) => setActiveFlow(flow)}
        onDownload={() => void handleSaveWorkbook()}
      />

      <main className="main-pane">
        <div className="status-bar">{status}</div>
        {activeFlow === 'developer' ? (
          <DeveloperDashboard
            busy={busy}
            collapsed={developerWorkspaceCollapsed}
            developerJiraKey={developerJiraKey}
            developerWorkbookName={developerWorkbookName}
            developerWorkbookFile={developerWorkbookFile}
            developerPendingAction={developerPendingAction}
            developerStageResult={developerStageResult}
            developerRunId={developerRunId}
            developerRunStatus={developerRunStatus}
            developerExecutionItems={developerExecutionItems}
            developerReviewChangesCollapsed={developerReviewChangesCollapsed}
            developerUiCodeReviewCollapsed={developerUiCodeReviewCollapsed}
            developerPrSummaryCollapsed={developerPrSummaryCollapsed}
            integrationStatus={integrationStatus}
            onToggleCollapsed={() => setDeveloperWorkspaceCollapsed((current) => !current)}
            onDeveloperJiraKeyChange={handleDeveloperJiraKeyChange}
            onDeveloperWorkbookSelect={handleDeveloperWorkbookSelect}
            onRunImplementationFlow={() => void handleRunDeveloperFlow()}
            onApproveAndPush={() => void handleApproveDeveloperFlow()}
            onCreatePr={() => void handleCreateDeveloperPr()}
            onConnectIntegration={handleConnectIntegration}
            onDisconnectIntegration={(provider) => void handleDisconnectIntegration(provider)}
            onToggleReviewChanges={() => setDeveloperReviewChangesCollapsed((current) => !current)}
            onToggleUiCodeReview={() => setDeveloperUiCodeReviewCollapsed((current) => !current)}
            onTogglePrSummary={() => setDeveloperPrSummaryCollapsed((current) => !current)}
            onCopyText={copyText}
          />
        ) : !edited || !selectedEvent ? (
          <PmEmptyState
            busy={busy}
            dbConnectionSummary={dbConnectionSummary}
            dbSettingsTooltip={dbSettingsTooltip}
            stagedFormattedModel={stagedFormattedModel}
            onOpenDbSettings={() => setDbConfigModalOpen(true)}
            onUploadFormatted={(file) => beginWorkbookUpload('import', file)}
            onUploadUnformatted={(file) => beginWorkbookUpload('format', file)}
            onOpenFormattedWorkbook={loadStagedFormattedModel}
          />
        ) : (
          <section className="editor">
            <PmWorkspaceIntro
              busy={busy}
              collapsed={pmWorkspaceCollapsed}
              dbConnectionSummary={dbConnectionSummary}
              dbSettingsTooltip={dbSettingsTooltip}
              events={edited.events}
              selectedEventId={selectedEventId}
              eventLabelById={eventLabelById}
              onOpenDbSettings={() => setDbConfigModalOpen(true)}
              onToggleCollapsed={() => setPmWorkspaceCollapsed((current) => !current)}
              onUploadFormatted={(file) => beginWorkbookUpload('import', file)}
              onUploadUnformatted={(file) => beginWorkbookUpload('format', file)}
              onAddGroup={() =>
                mutateEdited((draft) => {
                  const event = createEmptyEvent(draft.events.length + 1);
                  draft.events.push(event);
                  setSelectedEventId(event.id);
                })
              }
              onSelectEvent={setSelectedEventId}
            />

            <WorkflowInsights
              diff={diff}
              validationIssues={validationIssues}
              dbCheck={dbCheck}
              onSelectValidationIssue={handleSelectValidationIssue}
              onCopyText={copyText}
            />

            <SaveBanner
              hasUnsavedChanges={hasUnsavedChanges}
              busy={busy}
              lastAutosavedAt={lastAutosavedAt}
              onDownload={() => void handleSaveWorkbook()}
            />

            <PmActionStrip
              busy={busy}
              hasUnsavedChanges={hasUnsavedChanges}
              lastAutosavedAt={lastAutosavedAt}
              onReviewChanges={() => void handleReviewChanges()}
              onUseAsBaseDocument={() => setRebaseModalOpen(true)}
              onClearDraft={clearDraft}
            />

            <div className="editor-header">
              <h2>{eventLabelById.get(selectedEvent.id) ?? `Event ${selectedEvent.eventNumber}`}</h2>
              <div className="action-row">
                <button
                  className={selectedEvent.isRemoved ? 'ghost icon-button' : 'ghost danger icon-button'}
                  title={selectedEvent.isRemoved ? 'Restore this event (unmark as removed)' : 'Mark this event as removed in the workbook'}
                  aria-label={selectedEvent.isRemoved ? 'Restore this event' : 'Mark this event as removed'}
                  aria-pressed={Boolean(selectedEvent.isRemoved)}
                  onClick={() =>
                    mutateEdited((draft) => {
                      const event = draft.events.find((item) => item.id === selectedEvent.id);
                      if (!event) return;
                      if (event.isRemoved) {
                        unmarkEventRemoved(event);
                      } else {
                        markEventRemoved(event);
                      }
                    })
                  }
                >
                  {selectedEvent.isRemoved ? <UndoIcon /> : <RemoveFileIcon />}
                  <span>{selectedEvent.isRemoved ? 'Restore Event' : 'Remove Event'}</span>
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
                  className="ghost icon-only-button"
                  title="Add another enum row under this event"
                  onClick={() =>
                    mutateEdited((draft) => {
                      const event = draft.events.find((item) => item.id === selectedEvent.id);
                      event?.enumRows.push({ id: crypto.randomUUID(), enum: '', en: '', es: '' });
                    })
                  }
                >
                  <PlusIcon />
                </button>
              </div>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Enum</th>
                    <th>English</th>
                    <th>Spanish</th>
                    <th className="table-col-row-actions">Row</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedEvent.enumRows.map((row, rowIndex) => {
                    const rowBasePath = `${selectedEventPathPrefix}.enumRows.${rowIndex}`;

                    return (
                      <tr key={row.id} className={row.isRemoved ? 'removed-row' : ''}>
                        <td>
                          <div className="table-managed-field">
                            <div className="autocomplete-field">
                              <input
                                {...buildManagedFieldProps(row, 'enum', `${rowBasePath}.enum`)}
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
                            {renderFieldActionRow(
                              row,
                              'enum',
                              (checked) =>
                                mutateEdited((draft) => {
                                  const target = draft.events
                                    .find((item) => item.id === selectedEvent.id)
                                    ?.enumRows.find((item) => item.id === row.id);
                                  if (!target) return;
                                  const state = ensureFieldState(target, 'enum');
                                  state.isRemoved = false;
                                  state.manualIsNew = checked;
                                  state.isNew = checked;
                                }),
                              () =>
                                mutateEdited((draft) => {
                                  const target = draft.events
                                    .find((item) => item.id === selectedEvent.id)
                                    ?.enumRows.find((item) => item.id === row.id);
                                  if (!target) return;
                                  const state = ensureFieldState(target, 'enum');
                                  state.isRemoved = !state.isRemoved;
                                  if (state.isRemoved) {
                                    state.manualIsNew = null;
                                    state.isNew = false;
                                  }
                                }),
                              () =>
                                mutateEdited((draft) => {
                                  const target = draft.events
                                    .find((item) => item.id === selectedEvent.id)
                                    ?.enumRows.find((item) => item.id === row.id);
                                  if (!target) return;
                                  target.enum = '';
                                  applyFieldDelete(target, 'enum');
                                }),
                              { iconOnly: true, revealOnHover: true, scopeLabel: 'enum field' },
                            )}
                          </div>
                        </td>
                        <td>
                          <div className="table-managed-field">
                            <input
                              {...buildManagedFieldProps(row, 'en', `${rowBasePath}.en`)}
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
                            {renderFieldActionRow(
                              row,
                              'en',
                              (checked) =>
                                mutateEdited((draft) => {
                                  const target = draft.events
                                    .find((item) => item.id === selectedEvent.id)
                                    ?.enumRows.find((item) => item.id === row.id);
                                  if (!target) return;
                                  const state = ensureFieldState(target, 'en');
                                  state.isRemoved = false;
                                  state.manualIsNew = checked;
                                  state.isNew = checked;
                                }),
                              () =>
                                mutateEdited((draft) => {
                                  const target = draft.events
                                    .find((item) => item.id === selectedEvent.id)
                                    ?.enumRows.find((item) => item.id === row.id);
                                  if (!target) return;
                                  const state = ensureFieldState(target, 'en');
                                  state.isRemoved = !state.isRemoved;
                                  if (state.isRemoved) {
                                    state.manualIsNew = null;
                                    state.isNew = false;
                                  }
                                }),
                              () =>
                                mutateEdited((draft) => {
                                  const target = draft.events
                                    .find((item) => item.id === selectedEvent.id)
                                    ?.enumRows.find((item) => item.id === row.id);
                                  if (!target) return;
                                  target.en = '';
                                  applyFieldDelete(target, 'en');
                                }),
                              { iconOnly: true, revealOnHover: true, scopeLabel: 'English label' },
                            )}
                          </div>
                        </td>
                        <td>
                          <div className="table-managed-field">
                            <input
                              {...buildManagedFieldProps(row, 'es', `${rowBasePath}.es`)}
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
                            {renderFieldActionRow(
                              row,
                              'es',
                              (checked) =>
                                mutateEdited((draft) => {
                                  const target = draft.events
                                    .find((item) => item.id === selectedEvent.id)
                                    ?.enumRows.find((item) => item.id === row.id);
                                  if (!target) return;
                                  const state = ensureFieldState(target, 'es');
                                  state.isRemoved = false;
                                  state.manualIsNew = checked;
                                  state.isNew = checked;
                                }),
                              () =>
                                mutateEdited((draft) => {
                                  const target = draft.events
                                    .find((item) => item.id === selectedEvent.id)
                                    ?.enumRows.find((item) => item.id === row.id);
                                  if (!target) return;
                                  const state = ensureFieldState(target, 'es');
                                  state.isRemoved = !state.isRemoved;
                                  if (state.isRemoved) {
                                    state.manualIsNew = null;
                                    state.isNew = false;
                                  }
                                }),
                              () =>
                                mutateEdited((draft) => {
                                  const target = draft.events
                                    .find((item) => item.id === selectedEvent.id)
                                    ?.enumRows.find((item) => item.id === row.id);
                                  if (!target) return;
                                  target.es = '';
                                  applyFieldDelete(target, 'es');
                                }),
                              { iconOnly: true, revealOnHover: true, scopeLabel: 'Spanish label' },
                            )}
                          </div>
                        </td>
                        <td className="table-cell-row-actions">
                          <div className="enum-row-actions">
                            <button
                              type="button"
                              className={`ghost icon-only-button field-action-icon new-action-icon${row.isNew ? ' is-active' : ''}`}
                              title={row.isNew ? 'Unmark this row as new' : 'Mark this row as new'}
                              aria-label={row.isNew ? 'Unmark this row as new' : 'Mark this row as new'}
                              aria-pressed={Boolean(row.isNew)}
                              onClick={() =>
                                mutateEdited((draft) => {
                                  const target = draft.events
                                    .find((item) => item.id === selectedEvent.id)
                                    ?.enumRows.find((item) => item.id === row.id);
                                  if (target) {
                                    const nextChecked = !Boolean(target.isNew);
                                    target.manualIsNew = nextChecked;
                                    target.isNew = nextChecked;
                                  }
                                })
                              }
                            >
                              <NewBadgeIcon />
                            </button>
                            <button
                              className={row.isRemoved ? 'ghost icon-only-button' : 'ghost danger icon-only-button'}
                              title={row.isRemoved ? 'Restore this enum row' : 'Mark this enum row as removed'}
                              aria-label={row.isRemoved ? 'Restore this enum row' : 'Mark this enum row as removed'}
                              aria-pressed={Boolean(row.isRemoved)}
                              onClick={() =>
                                mutateEdited((draft) => {
                                  const event = draft.events.find((item) => item.id === selectedEvent.id);
                                  const target = event?.enumRows.find((item) => item.id === row.id);
                                  if (target) target.isRemoved = !target.isRemoved;
                                })
                              }
                            >
                              {row.isRemoved ? <UndoIcon /> : <TrashIcon />}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="field-hint">{eventOptionsHelp || 'Start typing to search existing event names.'}</p>
            </div>

            <div className="panel">
              <h3>Instructions</h3>
              <div className="two-up">
                <label>
                  English
                  {renderFieldActionRow(
                    selectedEvent,
                    'instructionsEn',
                    (checked) =>
                      mutateEdited((draft) => {
                        const target = draft.events.find((item) => item.id === selectedEvent.id);
                        if (!target) return;
                        const state = ensureFieldState(target, 'instructionsEn');
                        state.isRemoved = false;
                        state.manualIsNew = checked;
                        state.isNew = checked;
                      }),
                    () =>
                      mutateEdited((draft) => {
                        const target = draft.events.find((item) => item.id === selectedEvent.id);
                        if (!target) return;
                        const state = ensureFieldState(target, 'instructionsEn');
                        state.isRemoved = !state.isRemoved;
                        if (state.isRemoved) {
                          state.manualIsNew = null;
                          state.isNew = false;
                        }
                      }),
                    () =>
                      mutateEdited((draft) => {
                        const target = draft.events.find((item) => item.id === selectedEvent.id);
                        if (!target) return;
                        target.instructionsEn = '';
                        applyFieldDelete(target, 'instructionsEn');
                      }),
                  )}
                  <textarea
                    {...buildManagedFieldProps(selectedEvent, 'instructionsEn', `${selectedEventPathPrefix}.instructionsEn`)}
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
                  {renderFieldActionRow(
                    selectedEvent,
                    'instructionsEs',
                    (checked) =>
                      mutateEdited((draft) => {
                        const target = draft.events.find((item) => item.id === selectedEvent.id);
                        if (!target) return;
                        const state = ensureFieldState(target, 'instructionsEs');
                        state.isRemoved = false;
                        state.manualIsNew = checked;
                        state.isNew = checked;
                      }),
                    () =>
                      mutateEdited((draft) => {
                        const target = draft.events.find((item) => item.id === selectedEvent.id);
                        if (!target) return;
                        const state = ensureFieldState(target, 'instructionsEs');
                        state.isRemoved = !state.isRemoved;
                        if (state.isRemoved) {
                          state.manualIsNew = null;
                          state.isNew = false;
                        }
                      }),
                    () =>
                      mutateEdited((draft) => {
                        const target = draft.events.find((item) => item.id === selectedEvent.id);
                        if (!target) return;
                        target.instructionsEs = '';
                        applyFieldDelete(target, 'instructionsEs');
                      }),
                  )}
                  <textarea
                    {...buildManagedFieldProps(selectedEvent, 'instructionsEs', `${selectedEventPathPrefix}.instructionsEs`)}
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
                {selectedEvent.categories.map((category, categoryIndex) => {
                  const categoryBasePath = `${selectedEventPathPrefix}.categories.${categoryIndex}`;

                  return (
                    <div key={category.id} className={category.isRemoved ? 'category-card removed-row' : 'category-card'}>
                      <div className="panel-header">
                        <strong>{category.enum || 'New category'}{category.isRemoved ? ' - Removed' : ''}</strong>
                        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                          <button
                            className={category.isRemoved ? 'ghost icon-button' : 'ghost danger icon-button'}
                            title={category.isRemoved ? 'Restore this category and its documents' : 'Mark this category and its documents as removed'}
                            aria-pressed={Boolean(category.isRemoved)}
                            onClick={() =>
                              mutateEdited((draft) => {
                                const event = draft.events.find((item) => item.id === selectedEvent.id);
                                const target = event?.categories.find((item) => item.id === category.id);
                                if (!target) return;
                                if (target.isRemoved) {
                                  unmarkCategoryRemoved(target);
                                } else {
                                  markCategoryRemoved(target);
                                }
                              })
                            }
                          >
                            {category.isRemoved ? <UndoIcon /> : <RemoveFileIcon />}
                            <span>{category.isRemoved ? 'Restore' : 'Remove'}</span>
                          </button>
                          <button
                            className="ghost danger icon-button"
                            title="Permanently delete this entire category — enum, labels, validation rules, all documents and their labels"
                            onClick={() =>
                              mutateEdited((draft) => {
                                const event = draft.events.find((item) => item.id === selectedEvent.id);
                                if (event) {
                                  event.categories = event.categories.filter((item) => item.id !== category.id);
                                }
                              })
                            }
                          >
                            <TrashIcon />
                            <span>Delete Category</span>
                          </button>
                        </div>
                      </div>

                      <div className="category-field-stack">
                        <label>
                          Category Enum
                          {renderFieldActionRow(
                            category,
                            'enum',
                            (checked) =>
                              mutateEdited((draft) => {
                                const target = draft.events
                                  .find((item) => item.id === selectedEvent.id)
                                  ?.categories.find((item) => item.id === category.id);
                                if (!target) return;
                                const state = ensureFieldState(target, 'enum');
                                state.isRemoved = false;
                                state.manualIsNew = checked;
                                state.isNew = checked;
                              }),
                            () =>
                              mutateEdited((draft) => {
                                const target = draft.events
                                  .find((item) => item.id === selectedEvent.id)
                                  ?.categories.find((item) => item.id === category.id);
                                if (!target) return;
                                const state = ensureFieldState(target, 'enum');
                                state.isRemoved = !state.isRemoved;
                                if (state.isRemoved) {
                                  state.manualIsNew = null;
                                  state.isNew = false;
                                }
                              }),
                            () =>
                              mutateEdited((draft) => {
                                const target = draft.events
                                  .find((item) => item.id === selectedEvent.id)
                                  ?.categories.find((item) => item.id === category.id);
                                if (!target) return;
                                target.enum = '';
                                applyFieldDelete(target, 'enum');
                              }),
                          )}
                          <input
                            {...buildManagedFieldProps(category, 'enum', `${categoryBasePath}.enum`)}
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
                        <div className="two-up">
                        <label>
                          English
                          {renderFieldActionRow(
                            category,
                            'en',
                            (checked) =>
                              mutateEdited((draft) => {
                                const target = draft.events
                                  .find((item) => item.id === selectedEvent.id)
                                  ?.categories.find((item) => item.id === category.id);
                                if (!target) return;
                                const state = ensureFieldState(target, 'en');
                                state.isRemoved = false;
                                state.manualIsNew = checked;
                                state.isNew = checked;
                              }),
                            () =>
                              mutateEdited((draft) => {
                                const target = draft.events
                                  .find((item) => item.id === selectedEvent.id)
                                  ?.categories.find((item) => item.id === category.id);
                                if (!target) return;
                                const state = ensureFieldState(target, 'en');
                                state.isRemoved = !state.isRemoved;
                                if (state.isRemoved) {
                                  state.manualIsNew = null;
                                  state.isNew = false;
                                }
                              }),
                            () =>
                              mutateEdited((draft) => {
                                const target = draft.events
                                  .find((item) => item.id === selectedEvent.id)
                                  ?.categories.find((item) => item.id === category.id);
                                if (!target) return;
                                target.en = '';
                                applyFieldDelete(target, 'en');
                              }),
                          )}
                          <input
                            {...buildManagedFieldProps(category, 'en', `${categoryBasePath}.en`)}
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
                          {renderFieldActionRow(
                            category,
                            'es',
                            (checked) =>
                              mutateEdited((draft) => {
                                const target = draft.events
                                  .find((item) => item.id === selectedEvent.id)
                                  ?.categories.find((item) => item.id === category.id);
                                if (!target) return;
                                const state = ensureFieldState(target, 'es');
                                state.isRemoved = false;
                                state.manualIsNew = checked;
                                state.isNew = checked;
                              }),
                            () =>
                              mutateEdited((draft) => {
                                const target = draft.events
                                  .find((item) => item.id === selectedEvent.id)
                                  ?.categories.find((item) => item.id === category.id);
                                if (!target) return;
                                const state = ensureFieldState(target, 'es');
                                state.isRemoved = !state.isRemoved;
                                if (state.isRemoved) {
                                  state.manualIsNew = null;
                                  state.isNew = false;
                                }
                              }),
                            () =>
                              mutateEdited((draft) => {
                                const target = draft.events
                                  .find((item) => item.id === selectedEvent.id)
                                  ?.categories.find((item) => item.id === category.id);
                                if (!target) return;
                                target.es = '';
                                applyFieldDelete(target, 'es');
                              }),
                          )}
                          <input
                            {...buildManagedFieldProps(category, 'es', `${categoryBasePath}.es`)}
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
                        <div className="category-validation-section">
                          <div className="category-validation-heading">
                            <span className="category-validation-title">Validation Rules</span>
                            <span className="category-validation-note">
                              Category-level rule values used for document requirements.
                            </span>
                          </div>
                          <div
                            className={`validation-rule-list${
                              validationIssueByPath.get(`${categoryBasePath}.validation`) ? ' field-error' : ''
                            }${getFieldState(category, 'validation')?.isRemoved ? ' field-removed' : ''}${
                              getFieldState(category, 'validation')?.isNew &&
                              !getFieldState(category, 'validation')?.isRemoved
                                ? ' field-new'
                                : ''
                            }`}
                            data-field-path={`${categoryBasePath}.validation`}
                            aria-invalid={
                              validationIssueByPath.get(`${categoryBasePath}.validation`) ? true : undefined
                            }
                            title={validationIssueByPath.get(`${categoryBasePath}.validation`)?.message}
                          >
                            {(category.validationItems ?? parseValidationItemsFromText(category.validation)).map(
                              (item, itemIndex) => {
                                const itemBasePath = `${categoryBasePath}.validationItems.${itemIndex}`;
                                const keyPath = `${itemBasePath}.key`;
                                const valuePath = `${itemBasePath}.value`;
                              const keyFieldProps = buildManagedFieldProps(item, 'key', keyPath);
                              const valueFieldProps = buildManagedFieldProps(item, 'value', valuePath);
                              const validationKeyLocked = isFixedValidationRuleKey(item.key);
                              const itemRowClass = `validation-rule-item${
                                validationItemHasNewState(item) ? ' is-new' : ''
                              }${validationItemHasRemovedState(item) ? ' is-removed' : ''}${
                                validationKeyLocked ? ' is-fixed' : ''
                              }`;
                                const mutateValidationItem = (
                                  mutator: (validationItem: QleValidationItem, target: QleCategory) => void,
                                ) =>
                                  mutateEdited((draft) => {
                                    const target = draft.events
                                      .find((entry) => entry.id === selectedEvent.id)
                                      ?.categories.find((entry) => entry.id === category.id);
                                    if (!target) return;
                                    const items = ensureCategoryValidationItems(target);
                                    const validationItem = items.find((entry) => entry.id === item.id);
                                    if (!validationItem) return;
                                    mutator(validationItem, target);
                                    syncCategoryValidation(target);
                                  });

                                return (
                                  <div key={item.id} className={itemRowClass}>
                                    <div className="validation-rule-field">
                                      <input
                                        {...keyFieldProps}
                                        className={[keyFieldProps.className, 'validation-rule-key'].filter(Boolean).join(' ')}
                                        value={item.key}
                                        placeholder="Rule key"
                                        readOnly={validationKeyLocked}
                                        title={validationKeyLocked ? 'Validation rule key is fixed' : keyFieldProps.title}
                                        onBlur={noteAutosave}
                                        onChange={(event) =>
                                          mutateValidationItem((validationItem) => {
                                            validationItem.key = event.target.value;
                                          })
                                        }
                                      />
                                    </div>
                                    <div className="validation-rule-field">
                                      <input
                                        {...valueFieldProps}
                                        className={[valueFieldProps.className, 'validation-rule-value'].filter(Boolean).join(' ')}
                                        value={item.value}
                                        placeholder="Rule value"
                                        onBlur={noteAutosave}
                                        onChange={(event) =>
                                          mutateValidationItem((validationItem) => {
                                            validationItem.value = event.target.value;
                                          })
                                        }
                                      />
                                    </div>
                                  </div>
                                );
                              },
                            )}
                          </div>
                        </div>
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
                            <th className="table-col-row-actions">Row</th>
                          </tr>
                        </thead>
                        <tbody>
                          {category.documents.map((document, documentIndex) => {
                            const documentBasePath = `${categoryBasePath}.documents.${documentIndex}`;

                            return (
                              <tr key={document.id} className={document.isRemoved ? 'removed-row' : ''}>
                                <td className="table-cell-index">{documentIndex + 1}</td>
                                <td>
                                  <div className="table-managed-field">
                                    {renderFieldActionRow(
                                      document,
                                      'enum',
                                      (checked) =>
                                        mutateEdited((draft) => {
                                          const target = draft.events
                                            .find((item) => item.id === selectedEvent.id)
                                            ?.categories.find((item) => item.id === category.id)
                                            ?.documents.find((item) => item.id === document.id);
                                          if (!target) return;
                                          const state = ensureFieldState(target, 'enum');
                                          state.isRemoved = false;
                                          state.manualIsNew = checked;
                                          state.isNew = checked;
                                        }),
                                      () =>
                                        mutateEdited((draft) => {
                                          const target = draft.events
                                            .find((item) => item.id === selectedEvent.id)
                                            ?.categories.find((item) => item.id === category.id)
                                            ?.documents.find((item) => item.id === document.id);
                                          if (!target) return;
                                          const state = ensureFieldState(target, 'enum');
                                          state.isRemoved = !state.isRemoved;
                                          if (state.isRemoved) {
                                            state.manualIsNew = null;
                                            state.isNew = false;
                                          }
                                        }),
                                      () =>
                                        mutateEdited((draft) => {
                                          const target = draft.events
                                            .find((item) => item.id === selectedEvent.id)
                                            ?.categories.find((item) => item.id === category.id)
                                            ?.documents.find((item) => item.id === document.id);
                                          if (!target) return;
                                          target.enum = '';
                                          applyFieldDelete(target, 'enum');
                                        }),
                                      { scopeLabel: 'document enum' },
                                    )}
                                    <input
                                      {...buildManagedFieldProps(document, 'enum', `${documentBasePath}.enum`)}
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
                                  </div>
                                </td>
                                <td>
                                  <div className="table-managed-field">
                                    {renderFieldActionRow(
                                      document,
                                      'en',
                                      (checked) =>
                                        mutateEdited((draft) => {
                                          const target = draft.events
                                            .find((item) => item.id === selectedEvent.id)
                                            ?.categories.find((item) => item.id === category.id)
                                            ?.documents.find((item) => item.id === document.id);
                                          if (!target) return;
                                          const state = ensureFieldState(target, 'en');
                                          state.isRemoved = false;
                                          state.manualIsNew = checked;
                                          state.isNew = checked;
                                        }),
                                      () =>
                                        mutateEdited((draft) => {
                                          const target = draft.events
                                            .find((item) => item.id === selectedEvent.id)
                                            ?.categories.find((item) => item.id === category.id)
                                            ?.documents.find((item) => item.id === document.id);
                                          if (!target) return;
                                          const state = ensureFieldState(target, 'en');
                                          state.isRemoved = !state.isRemoved;
                                          if (state.isRemoved) {
                                            state.manualIsNew = null;
                                            state.isNew = false;
                                          }
                                        }),
                                      () =>
                                        mutateEdited((draft) => {
                                          const target = draft.events
                                            .find((item) => item.id === selectedEvent.id)
                                            ?.categories.find((item) => item.id === category.id)
                                            ?.documents.find((item) => item.id === document.id);
                                          if (!target) return;
                                          target.en = '';
                                          applyFieldDelete(target, 'en');
                                        }),
                                      { scopeLabel: 'document English label' },
                                    )}
                                    <input
                                      {...buildManagedFieldProps(document, 'en', `${documentBasePath}.en`)}
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
                                  </div>
                                </td>
                                <td>
                                  <div className="table-managed-field">
                                    {renderFieldActionRow(
                                      document,
                                      'es',
                                      (checked) =>
                                        mutateEdited((draft) => {
                                          const target = draft.events
                                            .find((item) => item.id === selectedEvent.id)
                                            ?.categories.find((item) => item.id === category.id)
                                            ?.documents.find((item) => item.id === document.id);
                                          if (!target) return;
                                          const state = ensureFieldState(target, 'es');
                                          state.isRemoved = false;
                                          state.manualIsNew = checked;
                                          state.isNew = checked;
                                        }),
                                      () =>
                                        mutateEdited((draft) => {
                                          const target = draft.events
                                            .find((item) => item.id === selectedEvent.id)
                                            ?.categories.find((item) => item.id === category.id)
                                            ?.documents.find((item) => item.id === document.id);
                                          if (!target) return;
                                          const state = ensureFieldState(target, 'es');
                                          state.isRemoved = !state.isRemoved;
                                          if (state.isRemoved) {
                                            state.manualIsNew = null;
                                            state.isNew = false;
                                          }
                                        }),
                                      () =>
                                        mutateEdited((draft) => {
                                          const target = draft.events
                                            .find((item) => item.id === selectedEvent.id)
                                            ?.categories.find((item) => item.id === category.id)
                                            ?.documents.find((item) => item.id === document.id);
                                          if (!target) return;
                                          target.es = '';
                                          applyFieldDelete(target, 'es');
                                        }),
                                      { scopeLabel: 'document Spanish label' },
                                    )}
                                    <input
                                      {...buildManagedFieldProps(document, 'es', `${documentBasePath}.es`)}
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
                                  </div>
                                </td>
                                <td className="table-cell-row-actions">
                                  <div className="enum-row-actions">
                                    <button
                                      type="button"
                                      className={`ghost icon-only-button field-action-icon new-action-icon${document.isNew ? ' is-active' : ''}`}
                                      title={document.isNew ? 'Unmark this document row as new' : 'Mark this document row as new'}
                                      aria-label={document.isNew ? 'Unmark this document row as new' : 'Mark this document row as new'}
                                      aria-pressed={Boolean(document.isNew)}
                                      onClick={() =>
                                        mutateEdited((draft) => {
                                          const target = draft.events
                                            .find((item) => item.id === selectedEvent.id)
                                            ?.categories.find((item) => item.id === category.id)
                                            ?.documents.find((item) => item.id === document.id);
                                          if (target) {
                                            const nextChecked = !Boolean(target.isNew);
                                            target.manualIsNew = nextChecked;
                                            target.isNew = nextChecked;
                                          }
                                        })
                                      }
                                    >
                                      <NewBadgeIcon />
                                    </button>
                                    <button
                                      className="ghost danger icon-only-button"
                                      title="Delete this document row"
                                      aria-label="Delete this document row"
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
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        )}
      </main>

      <ReviewChangesModal
        open={reviewModalOpen}
        busy={busy}
        reviewJiraTitle={reviewJiraTitle}
        fallbackJiraTitle={edited ? buildReviewJiraTitle(edited.fileName) : ''}
        reviewSummary={reviewSummary}
        reviewDownloadUrl={reviewDownloadUrl}
        reviewDownloadName={reviewDownloadName}
        jiraCreateStatus={jiraCreateStatus}
        jiraCreateError={jiraCreateError}
        jiraResults={jiraResults}
        onClose={() => setReviewModalOpen(false)}
        onReviewJiraTitleChange={setReviewJiraTitle}
        onCopyJiraTitle={() =>
          void copyText(
            reviewJiraTitle.trim() || (edited ? buildReviewJiraTitle(edited.fileName) : ''),
            'Copied Jira title.',
          )
        }
        onCopyChanges={() =>
          void copyText(
            buildReviewDescription(reviewSummary),
            'Copied changes to implement.',
          )
        }
        onCreateJira={() => void handleOpenReviewJiraForm()}
        shouldRenderReviewItem={shouldRenderReviewItem}
      />

      <RebaseWorkbookModal
        open={rebaseModalOpen}
        onClose={() => setRebaseModalOpen(false)}
        onConfirm={handleRebaseWorkbook}
      />

      <RenameWorkbookModal
        pendingUpload={pendingUpload}
        onClose={() => setPendingUpload(null)}
        onStateCodeChange={handlePendingUploadStateCodeChange}
        onSelectSuggestedName={handlePendingUploadSuggestedNameSelect}
        onCustomNameChange={handlePendingUploadCustomNameChange}
        onSave={() => void handleSavePendingUploadName()}
      />

      <DbConfigModal
        open={dbConfigModalOpen}
        form={dbConfigForm}
        saving={dbConfigSaving}
        onClose={() => setDbConfigModalOpen(false)}
        onChange={setDbConfigForm}
        onSave={() => void handleSaveDbConfig()}
      />

      <JiraDraftModal
        open={jiraModalOpen}
        busy={busy}
        jiraForm={jiraForm}
        missingJiraForm={missingJiraForm}
        dbCheck={dbCheck}
        createMissingEventJira={createMissingEventJira}
        jiraCreateStatus={jiraCreateStatus}
        jiraCreateError={jiraCreateError}
        jiraResults={jiraResults}
        onClose={() => setJiraModalOpen(false)}
        onJiraFormChange={setJiraForm}
        onMissingJiraFormChange={setMissingJiraForm}
        onCreateMissingEventJiraChange={setCreateMissingEventJira}
        onCreateJira={() => void handleCreateJira()}
      />

      <ReadyForEngineeringModal
        open={readyModalOpen}
        busy={busy}
        jiraKey={readyJiraKey}
        onClose={() => setReadyModalOpen(false)}
        onJiraKeyChange={setReadyJiraKey}
        onConfirm={() => void handleReadyForEngineering()}
      />
    </div>
  );
}
type FieldActionRowOptions = {
  iconOnly?: boolean;
  revealOnHover?: boolean;
  scopeLabel?: string;
};
