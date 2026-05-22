import type { ChangeEvent } from 'react';
import type {
  DbEventCheckResult,
  DeveloperFlowStatus,
  DeveloperStageResult,
  DiffSummary,
  QleWorkbookModel,
} from '../../../../shared/types';
import type { ValidationIssue } from '../../../../shared/validation';
import {
  ChevronDownIcon,
  ChevronUpIcon,
  ClipboardIcon,
  CodeIcon,
  CopyIcon,
  DownloadIcon,
  GearIcon,
  PlusIcon,
  SpinnerIcon,
} from './AppIcons';

type FlowMode = 'pm' | 'developer' | 'agent';

type DeveloperExecutionItem = {
  key?: string;
  label: string;
  state: string;
  detail: string;
};

type SidebarRailProps = {
  activeFlow: FlowMode;
  sidebarExpanded: boolean;
  hasWorkbook: boolean;
  busy: boolean;
  hasUnsavedChanges: boolean;
  theme: 'classic' | 'soft';
  onToggleSidebar: () => void;
  onSelectFlow: (flow: 'pm' | 'developer') => void;
  onDownload: () => void;
  onToggleTheme: () => void;
};

type WorkbookUploadCardProps = {
  title: string;
  copy?: string;
  className?: string;
  disabled: boolean;
  onFileSelected: (file: File) => void;
};

type PmEmptyStateProps = {
  busy: boolean;
  dbConnectionSummary: string;
  dbSettingsTooltip: string;
  stagedFormattedModel: QleWorkbookModel | null;
  onOpenDbSettings: () => void;
  onUploadFormatted: (file: File) => void;
  onUploadUnformatted: (file: File) => void;
  onOpenFormattedWorkbook: () => void;
};

type EventGroupsPanelProps = {
  events: QleWorkbookModel['events'];
  selectedEventId: string | null;
  eventLabelById: Map<string, string>;
  busy: boolean;
  onSelectEvent: (eventId: string) => void;
  onAddGroup: () => void;
};

type PmWorkspaceIntroProps = {
  busy: boolean;
  collapsed: boolean;
  dbConnectionSummary: string;
  dbSettingsTooltip: string;
  events: QleWorkbookModel['events'];
  selectedEventId: string | null;
  eventLabelById: Map<string, string>;
  onOpenDbSettings: () => void;
  onToggleCollapsed: () => void;
  onUploadFormatted: (file: File) => void;
  onUploadUnformatted: (file: File) => void;
  onAddGroup: () => void;
  onSelectEvent: (eventId: string) => void;
};

type WorkflowInsightsProps = {
  diff: DiffSummary | null;
  validationIssues: ValidationIssue[];
  dbCheck: DbEventCheckResult | null;
  onSelectValidationIssue?: (issue: ValidationIssue) => void;
};

type SaveBannerProps = {
  hasUnsavedChanges: boolean;
  busy: boolean;
  lastAutosavedAt: string | null;
  onDownload: () => void;
};

type PmActionStripProps = {
  busy: boolean;
  hasUnsavedChanges: boolean;
  lastAutosavedAt: string | null;
  onReviewChanges: () => void;
  onUseAsBaseDocument: () => void;
  onClearDraft: () => void;
};

type DeveloperDashboardProps = {
  busy: boolean;
  collapsed: boolean;
  developerJiraKey: string;
  developerWorkbookName: string;
  developerWorkbookFile: File | null;
  developerPendingAction: 'run' | 'approve' | 'createPr' | null;
  developerStageResult: DeveloperStageResult | null;
  developerRunId: string | null;
  developerRunStatus: DeveloperFlowStatus | null;
  developerExecutionItems: DeveloperExecutionItem[];
  developerReviewChangesCollapsed: boolean;
  developerUiCodeReviewCollapsed: boolean;
  developerPrSummaryCollapsed: boolean;
  onToggleCollapsed: () => void;
  onDeveloperJiraKeyChange: (value: string) => void;
  onDeveloperWorkbookSelect: (file: File | null) => void;
  onRunImplementationFlow: () => void;
  onApproveAndPush: () => void;
  onCreatePr: () => void;
  onToggleReviewChanges: () => void;
  onToggleUiCodeReview: () => void;
  onTogglePrSummary: () => void;
  onCopyText: (value: string, successMessage: string) => Promise<void>;
};

function renderStatusDetail(item: DeveloperExecutionItem, runStatus: DeveloperFlowStatus | null) {
  if (
    item.key === 'approvalAndPush' &&
    runStatus?.branchBrowseUrl &&
    item.detail.includes(runStatus.branchName)
  ) {
    return (
      <span>
        {item.detail.split(runStatus.branchName)[0]}
        <a href={runStatus.branchBrowseUrl} target="_blank" rel="noreferrer">
          {runStatus.branchName}
        </a>
        {item.detail.split(runStatus.branchName).slice(1).join(runStatus.branchName)}
      </span>
    );
  }

  if (
    item.key === 'previewServer' &&
    runStatus?.previewUrl &&
    item.detail.includes(runStatus.previewUrl)
  ) {
    return (
      <span>
        {item.detail.split(runStatus.previewUrl)[0]}
        <a href={runStatus.previewUrl} target="_blank" rel="noreferrer">
          {runStatus.previewUrl}
        </a>
        {item.detail.split(runStatus.previewUrl).slice(1).join(runStatus.previewUrl)}
      </span>
    );
  }

  return <span>{item.detail}</span>;
}

function handleWorkbookSelection(
  event: ChangeEvent<HTMLInputElement>,
  onFileSelected: (file: File) => void,
) {
  const file = event.target.files?.[0];
  event.currentTarget.value = '';
  if (file) {
    onFileSelected(file);
  }
}

function WorkbookUploadCard({
  title,
  copy,
  className = 'upload-card',
  disabled,
  onFileSelected,
}: WorkbookUploadCardProps) {
  return (
    <label className={className}>
      <span className={copy ? 'intake-title' : undefined}>{title}</span>
      {copy ? <span className="intake-copy">{copy}</span> : null}
      <input
        type="file"
        accept=".xlsx"
        disabled={disabled}
        onChange={(event) => handleWorkbookSelection(event, onFileSelected)}
      />
    </label>
  );
}

export function SidebarRail({
  activeFlow,
  sidebarExpanded,
  hasWorkbook,
  busy,
  hasUnsavedChanges,
  theme,
  onToggleSidebar,
  onSelectFlow,
  onDownload,
  onToggleTheme,
}: SidebarRailProps) {
  return (
    <aside className="sidebar-shell">
      <nav className="nav-rail" aria-label="Flow navigation">
        <button
          type="button"
          className="rail-badge rail-toggle"
          title={sidebarExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
          onClick={onToggleSidebar}
        >
          {sidebarExpanded ? 'QLE Document' : 'Q'}
        </button>
        <button
          type="button"
          className={`rail-nav ${activeFlow === 'pm' ? 'active' : ''}`}
          onClick={() => onSelectFlow('pm')}
          title="PM Dashboard"
        >
          <ClipboardIcon />
          {sidebarExpanded ? <span>PM Dashboard</span> : null}
        </button>
        <button
          type="button"
          className={`rail-nav ${activeFlow === 'developer' ? 'active' : ''}`}
          onClick={() => onSelectFlow('developer')}
          title="Developer Dashboard"
        >
          <CodeIcon />
          {sidebarExpanded ? <span>Developer Dashboard</span> : null}
        </button>
        {hasWorkbook ? (
          <button
            type="button"
            className="rail-nav rail-download"
            disabled={busy || !hasUnsavedChanges}
            onClick={onDownload}
            title="Download the latest formatted workbook"
          >
            <DownloadIcon />
            {sidebarExpanded ? <span>Download</span> : null}
          </button>
        ) : null}
        <button
          type="button"
          className="rail-nav rail-theme"
          onClick={onToggleTheme}
          title="Switch theme"
        >
          <PlusIcon />
          {sidebarExpanded ? <span>{theme === 'classic' ? 'Soft Theme' : 'Classic Theme'}</span> : null}
        </button>
      </nav>
    </aside>
  );
}

export function PmEmptyState({
  busy,
  dbConnectionSummary,
  dbSettingsTooltip,
  stagedFormattedModel,
  onOpenDbSettings,
  onUploadFormatted,
  onUploadUnformatted,
  onOpenFormattedWorkbook,
}: PmEmptyStateProps) {
  return (
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
            onClick={onOpenDbSettings}
          >
            <GearIcon />
          </button>
        </div>
      </div>
      <div className="workflow-grid">
        <WorkbookUploadCard
          title="Open formatted workbook for editing"
          disabled={busy}
          onFileSelected={onUploadFormatted}
        />
        <WorkbookUploadCard
          title="Format unformatted workbook"
          disabled={busy}
          onFileSelected={onUploadUnformatted}
        />
      </div>
      {stagedFormattedModel ? (
        <div className="panel">
          <h3>Formatted Review Ready</h3>
          <p>
            Downloaded a formatted workbook for <strong>{stagedFormattedModel.fileName}</strong>.
            Review it first, then open that formatted version in the editor.
          </p>
          <button disabled={busy} onClick={onOpenFormattedWorkbook}>
            Open formatted workbook in editor
          </button>
        </div>
      ) : null}
    </section>
  );
}

export function EventGroupsPanel({
  events,
  selectedEventId,
  eventLabelById,
  busy,
  onSelectEvent,
  onAddGroup,
}: EventGroupsPanelProps) {
  return (
    <div className="panel events-panel">
      <div className="panel-header">
        <h3>Event Groups</h3>
        <button
          className="ghost"
          disabled={busy}
          title="Add a new event after the existing events"
          onClick={onAddGroup}
        >
          Add Group
        </button>
      </div>
      <div className="event-list event-list-readable">
        {events.map((event) => (
          <button
            key={event.id}
            className={[
              'event-pill',
              event.id === selectedEventId ? 'active' : '',
              event.isRemoved ? 'removed-row' : '',
            ].filter(Boolean).join(' ')}
            title={`Open ${eventLabelById.get(event.id) ?? `Event ${event.eventNumber}`}${event.isRemoved ? ' (removed)' : ''}`}
            onClick={() => onSelectEvent(event.id)}
          >
            {eventLabelById.get(event.id) ?? `Event ${event.eventNumber}`}
            {event.isRemoved ? ' - Removed' : ''}
          </button>
        ))}
      </div>
    </div>
  );
}

export function PmWorkspaceIntro({
  busy,
  collapsed,
  dbConnectionSummary,
  dbSettingsTooltip,
  events,
  selectedEventId,
  eventLabelById,
  onOpenDbSettings,
  onToggleCollapsed,
  onUploadFormatted,
  onUploadUnformatted,
  onAddGroup,
  onSelectEvent,
}: PmWorkspaceIntroProps) {
  return (
    <section className={`pm-workspace ${collapsed ? 'collapsed' : ''}`}>
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
            onClick={onOpenDbSettings}
          >
            <GearIcon />
          </button>
          <button
            className="ghost icon-only-button"
            type="button"
            title={collapsed ? 'Expand PM Dashboard' : 'Collapse PM Dashboard'}
            onClick={onToggleCollapsed}
          >
            {collapsed ? <ChevronDownIcon /> : <ChevronUpIcon />}
          </button>
        </div>
      </div>

      {!collapsed ? (
        <>
          <div className="pm-intake-grid">
            <WorkbookUploadCard
              title="Open formatted workbook"
              copy="Continue editing a workbook that is already in the formatted dashboard structure."
              className="upload-card intake-card"
              disabled={busy}
              onFileSelected={onUploadFormatted}
            />
            <WorkbookUploadCard
              title="Format unformatted workbook"
              copy="Convert the source workbook first, review it, then reopen the formatted result for editing."
              className="upload-card intake-card"
              disabled={busy}
              onFileSelected={onUploadUnformatted}
            />
          </div>

          <EventGroupsPanel
            events={events}
            selectedEventId={selectedEventId}
            eventLabelById={eventLabelById}
            busy={busy}
            onSelectEvent={onSelectEvent}
            onAddGroup={onAddGroup}
          />
        </>
      ) : null}
    </section>
  );
}

export function WorkflowInsights({
  diff,
  validationIssues,
  dbCheck,
  onSelectValidationIssue,
}: WorkflowInsightsProps) {
  if (!diff && validationIssues.length === 0 && !dbCheck) {
    return null;
  }

  return (
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
            <p>Complete these before bundling or creating Jira. Download remains available.</p>
          </div>
          <ul className="plain-list required-fields-list">
            {validationIssues.slice(0, 12).map((issue) => (
              <li key={issue.path}>
                {onSelectValidationIssue ? (
                  <button
                    type="button"
                    className="validation-issue-button"
                    onClick={() => onSelectValidationIssue(issue)}
                  >
                    {issue.message}
                  </button>
                ) : (
                  issue.message
                )}
              </li>
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
  );
}

export function SaveBanner({
  hasUnsavedChanges,
  busy,
  lastAutosavedAt,
  onDownload,
}: SaveBannerProps) {
  return (
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
        onClick={onDownload}
      >
        <DownloadIcon />
        <span>Download</span>
      </button>
    </div>
  );
}

export function PmActionStrip({
  busy,
  hasUnsavedChanges,
  lastAutosavedAt,
  onReviewChanges,
  onUseAsBaseDocument,
  onClearDraft,
}: PmActionStripProps) {
  return (
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
          onClick={onReviewChanges}
        >
          Review Changes
        </button>
        <button
          className="ghost action-secondary"
          disabled={busy}
          title="Clear existing new highlights and use this workbook as the new baseline"
          onClick={onUseAsBaseDocument}
        >
          Use As Base Document
        </button>
        <button
          className="ghost action-secondary"
          disabled={busy}
          title="Clear the current local draft and start over"
          onClick={onClearDraft}
        >
          Clear Draft
        </button>
      </div>
    </div>
  );
}

export function DeveloperDashboard({
  busy,
  collapsed,
  developerJiraKey,
  developerWorkbookName,
  developerWorkbookFile,
  developerPendingAction,
  developerStageResult,
  developerRunId,
  developerRunStatus,
  developerExecutionItems,
  developerReviewChangesCollapsed,
  developerUiCodeReviewCollapsed,
  developerPrSummaryCollapsed,
  onToggleCollapsed,
  onDeveloperJiraKeyChange,
  onDeveloperWorkbookSelect,
  onRunImplementationFlow,
  onApproveAndPush,
  onCreatePr,
  onToggleReviewChanges,
  onToggleUiCodeReview,
  onTogglePrSummary,
  onCopyText,
}: DeveloperDashboardProps) {
  return (
    <section className="editor">
      <section className={`pm-workspace developer-workspace ${collapsed ? 'collapsed' : ''}`}>
        <div className="pm-workspace-header">
          <div className="flow-hero">
            <div className="sidebar-brow">Developer Dashboard</div>
            <h2>Implementation Intake</h2>
            <p>Start from the Jira and workbook, then hand the request into the QLE skill workflow for code changes and review.</p>
          </div>
          <button
            className="icon-only-button developer-collapse-button"
            type="button"
            title={collapsed ? 'Expand Developer Dashboard' : 'Collapse Developer Dashboard'}
            onClick={onToggleCollapsed}
          >
            {collapsed ? <ChevronDownIcon /> : <ChevronUpIcon />}
          </button>
        </div>

        {!collapsed ? (
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
                    onChange={(event) => onDeveloperJiraKeyChange(event.target.value)}
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
                    onChange={(event) => onDeveloperWorkbookSelect(event.target.files?.[0] ?? null)}
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
                  onClick={onRunImplementationFlow}
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
                        {renderStatusDetail(item, developerRunStatus)}
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
                    onClick={onApproveAndPush}
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
                    onClick={onCreatePr}
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
                    onClick={onToggleReviewChanges}
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
                            void onCopyText(
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
                          onClick={onToggleUiCodeReview}
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
                            void onCopyText(
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
                          onClick={onTogglePrSummary}
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
                          void onCopyText(
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
                            void onCopyText(
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
  );
}
