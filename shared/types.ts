export type QleEnumRow = {
  id: string;
  enum: string;
  en: string;
  es: string;
  isNew?: boolean;
  manualIsNew?: boolean | null;
  isRemoved?: boolean;
};

export type QleDocument = {
  id: string;
  enum: string;
  en: string;
  es: string;
  sort?: number | null;
  isNew?: boolean;
  manualIsNew?: boolean | null;
  isRemoved?: boolean;
};

export type QleCategory = {
  id: string;
  enum: string;
  en: string;
  es: string;
  validation: string;
  isNew?: boolean;
  manualIsNew?: boolean | null;
  isRemoved?: boolean;
  documents: QleDocument[];
};

export type QleEvent = {
  id: string;
  eventNumber: number;
  enumRows: QleEnumRow[];
  instructionsEn: string;
  instructionsEs: string;
  isNew?: boolean;
  manualIsNew?: boolean | null;
  isRemoved?: boolean;
  categories: QleCategory[];
};

export type QleWorkbookModel = {
  id: string;
  fileName: string;
  sourceSheet: string;
  importedAt: string;
  events: QleEvent[];
};

export type DiffEntry = {
  kind: 'added' | 'removed' | 'changed';
  entity: 'event' | 'enum' | 'category' | 'document';
  path: string;
  detail: string;
};

export type DiffSummary = {
  counts: {
    events: number;
    enums: number;
    categories: number;
    documents: number;
    changes: number;
  };
  entries: DiffEntry[];
};

export type JiraDraft = {
  summary: string;
  description: string;
  attachmentName: string;
};

export type DbEventLookup = {
  eventName: string;
  eventLabel: string;
  id: number | string;
};

export type DbEventOption = {
  eventName: string;
  eventLabel: string;
};

export type MissingDbEvent = {
  eventNumber: number;
  eventName: string;
  englishLabel: string;
};

export type DbEventCheckResult = {
  configured: boolean;
  found: DbEventLookup[];
  missing: MissingDbEvent[];
  errors: string[];
};

export type DbConfig = {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  schema: string;
  ssl: boolean;
};

export type DbConfigResponse = {
  configured: boolean;
  config: DbConfig;
};

export type JiraDraftForm = {
  summary: string;
  description: string;
  issueType: string;
  assigneeAccountId: string;
  fixVersionName: string;
  labels: string;
};

export type JiraCreateResult = {
  key: string;
  self?: string;
  browseUrl?: string;
};

export type AgentStep = {
  id: string;
  name: string;
  role: 'coordinator' | 'implementation' | 'review' | 'git';
  objective: string;
  inputs: string[];
  outputs: string[];
};

export type AgentTrigger = {
  mode: 'manual' | 'after_jira';
  jiraKey?: string;
  bundleId?: string;
};

export type AgentHandoff = {
  schemaVersion: '1.0';
  bundleId: string;
  bundleDir: string;
  sourceWorkbook: string;
  workbookFile: string;
  sourceSheet: string;
  versionNumber: number;
  recommendedSkill: string;
  coordinatorPrompt: string;
  trigger: AgentTrigger;
  artifacts: {
    workbook: string;
    updateJson: string;
    diffSummary: string;
    jiraPayload: string;
  };
  subagents: AgentStep[];
};

export type ReadyForEngineeringResult = {
  bundleId: string;
  bundleDir: string;
  workbookName: string;
  handoffFile: string;
  jiraKey: string;
  launchGuide: string;
  launchPrompt: string;
};

export type DeveloperStageResult = {
  bundleId: string;
  bundleDir: string;
  jiraKey: string;
  workbookName: string;
  workbookPath: string;
  previewStateCode: string | null;
  branchName: string;
  worktreePath: string;
  handoffFile: string;
  launchGuide: string;
  cursorOutputLog: string;
  cursorErrorLog: string;
  previewOutputLog: string;
  previewErrorLog: string;
  uiCodeReviewOutputLog: string;
  uiCodeReviewErrorLog: string;
  prSummaryOutputLog: string;
  prSummaryErrorLog: string;
};

export type DeveloperFlowStepKey =
  | 'requestIntake'
  | 'jiraAndWorkbook'
  | 'createBranch'
  | 'skillRun'
  | 'previewServer'
  | 'approvalAndPush'
  | 'createPr';

export type DeveloperFlowStepState =
  | 'Idle'
  | 'Ready'
  | 'In progress'
  | 'Prepared'
  | 'Queued'
  | 'Running'
  | 'Ready for review'
  | 'Awaiting approval'
  | 'Approved'
  | 'Completed'
  | 'Failed';

export type DeveloperFlowExecutionStep = {
  key: DeveloperFlowStepKey;
  label: string;
  state: DeveloperFlowStepState;
  detail: string;
};

export type DeveloperFlowRunResult = {
  runId: string;
  stage: DeveloperStageResult;
};

export type DeveloperFlowStatus = {
  runId: string;
  jiraKey: string;
  branchName: string;
  branchBrowseUrl?: string;
  overallState: 'idle' | 'running' | 'awaiting_approval' | 'completed' | 'failed';
  steps: DeveloperFlowExecutionStep[];
  changedFiles: string[];
  changeRequestSummary: string;
  diffSummary: string;
  detailedDiff: string;
  previewUrl: string;
  prCreateUrl?: string;
  prTitle?: string;
  uiCodeReviewSummary?: string;
  prSummaryText?: string;
  error?: string;
  lastUpdatedAt: string;
};

export type DeveloperFlowApproveResult = {
  runId: string;
  branchName: string;
  branchBrowseUrl?: string;
  commitSha?: string;
  pushed: boolean;
  prTitle?: string;
  prCreateUrl?: string;
  uiCodeReviewSummary?: string;
  prSummaryText?: string;
};

export type DeveloperFlowCreatePrResult = {
  runId: string;
  branchName: string;
  prTitle?: string;
  prCreateUrl: string;
  uiCodeReviewSummary?: string;
  prSummaryText?: string;
};
