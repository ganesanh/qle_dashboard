import type { ChangeEvent, MouseEvent } from 'react';
import type {
  DbConfig,
  DbEventCheckResult,
  JiraCreateResult,
  JiraDraftForm,
} from '../../../../shared/types';
import { CloseIcon, CopyIcon } from './AppIcons';

type ReviewSummaryGroupLike = {
  title: string;
  items: string[];
};

type PendingUploadLike = {
  originalFile: File;
  stateCode: string;
  versionText: string;
  dateText: string;
  customName: string;
  suggestedNames: string[];
  error: string;
};

type ReviewChangesModalProps = {
  open: boolean;
  busy: boolean;
  reviewJiraTitle: string;
  fallbackJiraTitle: string;
  reviewSummary: ReviewSummaryGroupLike[];
  reviewDownloadUrl: string;
  reviewDownloadName: string;
  jiraCreateStatus: string;
  jiraCreateError: string;
  jiraResults: JiraCreateResult[];
  onClose: () => void;
  onReviewJiraTitleChange: (value: string) => void;
  onCopyJiraTitle: () => void;
  onCopyChanges: () => void;
  onCreateJira: () => void;
  shouldRenderReviewItem: (item: string) => boolean;
};

type RebaseWorkbookModalProps = {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
};

type RenameWorkbookModalProps = {
  pendingUpload: PendingUploadLike | null;
  onClose: () => void;
  onStateCodeChange: (value: string) => void;
  onSelectSuggestedName: (name: string) => void;
  onCustomNameChange: (value: string) => void;
  onSave: () => void;
};

type DbConfigModalProps = {
  open: boolean;
  form: DbConfig;
  saving: boolean;
  onClose: () => void;
  onChange: (next: DbConfig) => void;
  onSave: () => void;
};

type JiraDraftModalProps = {
  open: boolean;
  busy: boolean;
  jiraForm: JiraDraftForm | null;
  missingJiraForm: JiraDraftForm | null;
  dbCheck: DbEventCheckResult | null;
  createMissingEventJira: boolean;
  jiraCreateStatus: string;
  jiraCreateError: string;
  jiraResults: JiraCreateResult[];
  onClose: () => void;
  onJiraFormChange: (next: JiraDraftForm | null) => void;
  onMissingJiraFormChange: (next: JiraDraftForm | null) => void;
  onCreateMissingEventJiraChange: (checked: boolean) => void;
  onCreateJira: () => void;
};

type ReadyForEngineeringModalProps = {
  open: boolean;
  busy: boolean;
  jiraKey: string;
  onClose: () => void;
  onJiraKeyChange: (value: string) => void;
  onConfirm: () => void;
};

function stopModalClose(event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement> | MouseEvent) {
  event.stopPropagation();
}

export function ReviewChangesModal({
  open,
  busy,
  reviewJiraTitle,
  fallbackJiraTitle,
  reviewSummary,
  reviewDownloadUrl,
  reviewDownloadName,
  jiraCreateStatus,
  jiraCreateError,
  jiraResults,
  onClose,
  onReviewJiraTitleChange,
  onCopyJiraTitle,
  onCopyChanges,
  onCreateJira,
  shouldRenderReviewItem,
}: ReviewChangesModalProps) {
  if (!open) return null;

  return (
    <div className="modal-backdrop">
      <div className="modal-card" onClick={stopModalClose}>
        <div className="panel-header">
          <h2>Review Changes</h2>
          <button
            className="modal-close-button icon-only-button"
            title="Close review modal"
            onClick={onClose}
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
                onClick={onCopyJiraTitle}
              >
                <CopyIcon />
              </button>
            </div>
            <input
              value={reviewJiraTitle}
              placeholder={fallbackJiraTitle}
              onChange={(event) => onReviewJiraTitleChange(event.target.value)}
            />
          </label>
          <div className="modal-span panel modal-subpanel">
            <div className="panel-header">
              <h3>Changes To Implement</h3>
              <button
                className="ghost icon-only-button"
                type="button"
                title="Copy changes to implement"
                onClick={onCopyChanges}
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
          <button className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="ghost modal-link-button" disabled={busy} onClick={onCreateJira}>
            Create Jira
          </button>
        </div>
      </div>
    </div>
  );
}

export function RebaseWorkbookModal({
  open,
  onClose,
  onConfirm,
}: RebaseWorkbookModalProps) {
  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={stopModalClose}>
        <div className="panel-header">
          <h2>Use As Base Document</h2>
          <button
            className="modal-close-button icon-only-button"
            title="Close base document modal"
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </div>
        <div className="panel modal-subpanel">
          <p>
            This will keep the current workbook content, remove existing <strong>new</strong> highlights,
            and treat this version as the new baseline for future edits.
          </p>
          <p>
            After this, newly added changes will be tracked from this workbook and downloads will use the
            default color pattern unless you add more updates.
          </p>
        </div>
        <div className="modal-actions">
          <button className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-save" onClick={onConfirm}>
            Clear Highlights And Rebase
          </button>
        </div>
      </div>
    </div>
  );
}

export function RenameWorkbookModal({
  pendingUpload,
  onClose,
  onStateCodeChange,
  onSelectSuggestedName,
  onCustomNameChange,
  onSave,
}: RenameWorkbookModalProps) {
  if (!pendingUpload) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={stopModalClose}>
        <div className="panel-header">
          <h2>Rename Workbook</h2>
          <button
            className="modal-close-button icon-only-button"
            title="Close rename modal"
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </div>
        <p className="modal-note">
          Uploaded workbooks must match <code>uploadDoc_&lt;state&gt;_&lt;version&gt;_&lt;date&gt;.xlsx</code>.
        </p>
        <div className="modal-grid">
          <label>
            State code
            <input
              value={pendingUpload.stateCode}
              placeholder="PA"
              onChange={(event) => onStateCodeChange(event.target.value)}
            />
          </label>
          <label className="modal-span">
            Suggested names
            <div className="panel modal-subpanel">
              {pendingUpload.suggestedNames.length > 0 ? (
                pendingUpload.suggestedNames.map((name) => (
                  <label key={name} className="checkbox-row">
                    <input
                      type="radio"
                      name="upload-file-name"
                      checked={pendingUpload.customName === name}
                      onChange={() => onSelectSuggestedName(name)}
                    />
                    <span>{name}</span>
                  </label>
                ))
              ) : (
                <p>Enter a state code to generate suggested names.</p>
              )}
            </div>
          </label>
          <label className="modal-span">
            Custom file name
            <input
              value={pendingUpload.customName}
              placeholder="uploadDoc_PA_1.4_26-05-2026.xlsx"
              onChange={(event) => onCustomNameChange(event.target.value)}
            />
          </label>
          <div className="modal-span panel modal-subpanel">
            <p><strong>Original:</strong> {pendingUpload.originalFile.name}</p>
            <p><strong>Expected pattern:</strong> uploadDoc_PA_1.4_26-05-2026.xlsx</p>
            <p><strong>Detected version/date:</strong> {pendingUpload.versionText} / {pendingUpload.dateText}</p>
            {pendingUpload.error ? <p><strong>Error:</strong> {pendingUpload.error}</p> : null}
          </div>
        </div>
        <div className="modal-actions">
          <button className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-save" disabled={!pendingUpload.customName.trim()} onClick={onSave}>
            Save and continue
          </button>
        </div>
      </div>
    </div>
  );
}

export function DbConfigModal({
  open,
  form,
  saving,
  onClose,
  onChange,
  onSave,
}: DbConfigModalProps) {
  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card db-config-modal" onClick={stopModalClose}>
        <div className="panel-header">
          <h2>PM Database Settings</h2>
          <button
            className="modal-close-button icon-only-button"
            title="Close database settings"
            onClick={onClose}
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
              value={form.host}
              onChange={(event) => onChange({ ...form, host: event.target.value })}
            />
          </label>
          <label>
            Port
            <input
              type="number"
              min={1}
              value={form.port}
              onChange={(event) =>
                onChange({
                  ...form,
                  port: Number(event.target.value) || 0,
                })
              }
            />
          </label>
          <label>
            Database
            <input
              value={form.database}
              onChange={(event) => onChange({ ...form, database: event.target.value })}
            />
          </label>
          <label>
            Schema
            <input
              value={form.schema}
              onChange={(event) => onChange({ ...form, schema: event.target.value })}
            />
          </label>
          <label>
            User
            <input
              value={form.user}
              onChange={(event) => onChange({ ...form, user: event.target.value })}
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={form.password}
              onChange={(event) => onChange({ ...form, password: event.target.value })}
            />
          </label>
          <label className="checkbox-row modal-span">
            <input
              type="checkbox"
              checked={form.ssl}
              onChange={(event) => onChange({ ...form, ssl: event.target.checked })}
            />
            <span>Use SSL for the connection</span>
          </label>
        </div>
        <div className="modal-actions">
          <button className="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="primary-save" onClick={onSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save settings'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function JiraDraftModal({
  open,
  busy,
  jiraForm,
  missingJiraForm,
  dbCheck,
  createMissingEventJira,
  jiraCreateStatus,
  jiraCreateError,
  jiraResults,
  onClose,
  onJiraFormChange,
  onMissingJiraFormChange,
  onCreateMissingEventJiraChange,
  onCreateJira,
}: JiraDraftModalProps) {
  if (!open || !jiraForm) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={stopModalClose}>
        <div className="panel-header">
          <h2>Draft Jira</h2>
          <button className="ghost" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="modal-grid">
          <label>
            Summary
            <input
              value={jiraForm.summary}
              onChange={(event) =>
                onJiraFormChange({ ...jiraForm, summary: event.target.value })
              }
            />
          </label>
          <label>
            Issue Type
            <input
              value={jiraForm.issueType}
              onChange={(event) =>
                onJiraFormChange({ ...jiraForm, issueType: event.target.value })
              }
            />
          </label>
          <label>
            Assignee Account ID
            <input
              value={jiraForm.assigneeAccountId}
              onChange={(event) =>
                onJiraFormChange({ ...jiraForm, assigneeAccountId: event.target.value })
              }
            />
          </label>
          <label>
            Fix Version
            <input
              value={jiraForm.fixVersionName}
              onChange={(event) =>
                onJiraFormChange({ ...jiraForm, fixVersionName: event.target.value })
              }
            />
          </label>
          <label>
            Labels
            <input
              value={jiraForm.labels}
              onChange={(event) =>
                onJiraFormChange({ ...jiraForm, labels: event.target.value })
              }
            />
          </label>
          <label className="modal-span">
            Description
            <textarea
              rows={12}
              value={jiraForm.description}
              onChange={(event) =>
                onJiraFormChange({ ...jiraForm, description: event.target.value })
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
                onChange={(event) => onCreateMissingEventJiraChange(event.target.checked)}
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
                      onMissingJiraFormChange({
                        ...missingJiraForm,
                        summary: event.target.value,
                      })
                    }
                  />
                </label>
                <label className="modal-span">
                  Missing Event Jira Description
                  <textarea
                    rows={8}
                    value={missingJiraForm.description}
                    onChange={(event) =>
                      onMissingJiraFormChange({
                        ...missingJiraForm,
                        description: event.target.value,
                      })
                    }
                  />
                </label>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="modal-actions">
          <button className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-save" disabled={busy} onClick={onCreateJira}>
            Create Jira
          </button>
        </div>
      </div>
    </div>
  );
}

export function ReadyForEngineeringModal({
  open,
  busy,
  jiraKey,
  onClose,
  onJiraKeyChange,
  onConfirm,
}: ReadyForEngineeringModalProps) {
  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={stopModalClose}>
        <div className="panel-header">
          <h2>Ready for Engineering</h2>
          <button className="ghost" onClick={onClose}>
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
            value={jiraKey}
            onChange={(event) => onJiraKeyChange(event.target.value.toUpperCase())}
          />
        </label>
        <div className="modal-actions">
          <button className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-save" disabled={busy} onClick={onConfirm}>
            Create Handoff Package
          </button>
        </div>
      </div>
    </div>
  );
}
