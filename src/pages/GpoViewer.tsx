import { useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import { EmptyState } from "@/components/common/EmptyState";
import { ExportToolbar, type ExportColumn } from "@/components/common/ExportToolbar";
import { extractErrorMessage } from "@/utils/errorMapping";
import {
  Search,
  Shield,
  ShieldAlert,
  ShieldOff,
  CheckCircle,
  XCircle,
  ArrowRight,
  FolderTree,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GpoLink {
  gpoDn: string;
  gpoName: string;
  linkOrder: number;
  isEnforced: boolean;
  isDisabled: boolean;
  linkedAt: string;
  isInherited: boolean;
  wmiFilter: string | null;
}

interface GpoInfo {
  dn: string;
  displayName: string;
  wmiFilter: string | null;
}

interface GpoLinksResult {
  objectDn: string;
  links: GpoLink[];
  blocksInheritance: boolean;
}

type ViewMode = "links" | "scope" | "whatif";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EXPORT_COLUMNS: ExportColumn[] = [
  { key: "gpoName", header: "GPO Name" },
  { key: "linkOrder", header: "Link Order" },
  { key: "linkedAt", header: "Linked At" },
  { key: "enforced", header: "Enforced" },
  { key: "inherited", header: "Inherited" },
  { key: "wmiFilter", header: "WMI Filter" },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDn(dn: string): string {
  return dn
    .split(",")
    .filter((p) => p.startsWith("OU=") || p.startsWith("DC="))
    .map((p) => p.split("=")[1])
    .join("/");
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function GpoViewer() {
  const [viewMode, setViewMode] = useState<ViewMode>("links");

  // Links view state
  const [objectDn, setObjectDn] = useState("");
  const [linksResult, setLinksResult] = useState<GpoLinksResult | null>(null);
  const [linksLoading, setLinksLoading] = useState(false);
  const [linksError, setLinksError] = useState<string | null>(null);

  // Scope view state
  const [scopeGpoDn, setScopeGpoDn] = useState("");
  const [scopeLinks, setScopeLinks] = useState<GpoLink[]>([]);
  const [scopeLoading, setScopeLoading] = useState(false);
  const [scopeError, setScopeError] = useState<string | null>(null);

  // GPO list for autocomplete
  const [gpoList, setGpoList] = useState<GpoInfo[]>([]);

  // What-if state
  const [whatIfUserDn, setWhatIfUserDn] = useState("");
  const [whatIfOuDn, setWhatIfOuDn] = useState("");
  const [whatIfResult, setWhatIfResult] = useState<GpoLinksResult | null>(null);
  const [whatIfLoading, setWhatIfLoading] = useState(false);
  const [whatIfError, setWhatIfError] = useState<string | null>(null);

  // Load GPO list on mount
  useEffect(() => {
    invoke<GpoInfo[]>("get_gpo_list")
      .then(setGpoList)
      .catch(() => {});
  }, []);

  const fetchGpoLinks = useCallback(async () => {
    if (!objectDn.trim()) return;
    setLinksLoading(true);
    setLinksError(null);
    try {
      const result = await invoke<GpoLinksResult>("get_gpo_links", {
        objectDn: objectDn.trim(),
      });
      setLinksResult(result);
    } catch (err) {
      setLinksError(extractErrorMessage(err));
    } finally {
      setLinksLoading(false);
    }
  }, [objectDn]);

  const fetchScope = useCallback(async () => {
    if (!scopeGpoDn.trim()) return;
    setScopeLoading(true);
    setScopeError(null);
    try {
      const result = await invoke<GpoLink[]>("get_gpo_scope", {
        gpoDn: scopeGpoDn.trim(),
      });
      setScopeLinks(result);
    } catch (err) {
      setScopeError(extractErrorMessage(err));
    } finally {
      setScopeLoading(false);
    }
  }, [scopeGpoDn]);

  const fetchWhatIf = useCallback(async () => {
    if (!whatIfOuDn.trim()) return;
    setWhatIfLoading(true);
    setWhatIfError(null);
    try {
      // Simulate by querying GPOs for the target OU
      const targetDn = whatIfUserDn.trim()
        ? `CN=SimulatedUser,${whatIfOuDn.trim()}`
        : whatIfOuDn.trim();
      const result = await invoke<GpoLinksResult>("get_gpo_links", {
        objectDn: targetDn,
      });
      setWhatIfResult(result);
    } catch (err) {
      setWhatIfError(extractErrorMessage(err));
    } finally {
      setWhatIfLoading(false);
    }
  }, [whatIfUserDn, whatIfOuDn]);

  const handleKeyDown = (e: React.KeyboardEvent, action: () => void) => {
    if (e.key === "Enter") action();
  };

  const currentLinks =
    viewMode === "links"
      ? linksResult?.links ?? []
      : viewMode === "whatif"
        ? whatIfResult?.links ?? []
        : scopeLinks;

  return (
    <div className="flex h-full flex-col gap-4 p-4" data-testid="gpo-viewer-page">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-heading font-semibold text-[var(--color-text-primary)]">
            GPO Viewer
          </h1>
          <p className="text-caption text-[var(--color-text-secondary)]">
            View Group Policy Objects linked to users, computers, and OUs -
            read-only
          </p>
        </div>
        <ExportToolbar
          columns={EXPORT_COLUMNS}
          data={currentLinks}
          rowMapper={(l) => [
            l.gpoName,
            String(l.linkOrder),
            l.linkedAt,
            l.isEnforced ? "Yes" : "No",
            l.isInherited ? "Yes" : "No",
            l.wmiFilter ?? "",
          ]}
          title="GPO Links Report"
          filenameBase="gpo_links"
        />
      </div>

      {/* View mode tabs */}
      <div className="flex gap-1 border-b border-[var(--color-border-default)]" data-testid="view-mode-tabs">
        {(
          [
            { id: "links", label: "GPO Links", icon: <Shield size={14} /> },
            { id: "scope", label: "Scope Report", icon: <FolderTree size={14} /> },
            { id: "whatif", label: "What-If", icon: <ArrowRight size={14} /> },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            className={`flex items-center gap-1.5 px-3 py-2 text-caption font-medium transition-colors ${
              viewMode === tab.id
                ? "border-b-2 border-[var(--color-primary)] text-[var(--color-primary)]"
                : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
            }`}
            onClick={() => setViewMode(tab.id)}
            data-testid={`tab-${tab.id}`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Links View */}
      {viewMode === "links" && (
        <div className="flex flex-col gap-4">
          <div className="flex items-end gap-3">
            <div className="flex flex-1 flex-col gap-1">
              <label className="text-[11px] font-medium text-[var(--color-text-secondary)]">
                Object DN (user, computer, or OU)
              </label>
              <input
                type="text"
                value={objectDn}
                onChange={(e) => setObjectDn(e.target.value)}
                onKeyDown={(e) => handleKeyDown(e, fetchGpoLinks)}
                placeholder="CN=John Doe,OU=Users,DC=contoso,DC=com"
                className="h-8 rounded border border-[var(--color-border-default)] bg-[var(--color-surface-default)] px-2 text-caption text-[var(--color-text-primary)] placeholder:text-[var(--color-text-secondary)]"
                data-testid="links-object-dn"
              />
            </div>
            <button
              className="btn btn-sm btn-primary flex items-center gap-1"
              onClick={fetchGpoLinks}
              disabled={linksLoading || !objectDn.trim()}
              data-testid="links-search-button"
            >
              <Search size={14} />
              Load GPOs
            </button>
          </div>

          {linksError && <ErrorBanner message={linksError} />}
          {linksLoading && <LoadingSpinner />}
          {linksResult && !linksLoading && (
            <GpoLinksTable
              links={linksResult.links}
              blocksInheritance={linksResult.blocksInheritance}
            />
          )}
        </div>
      )}

      {/* Scope View */}
      {viewMode === "scope" && (
        <div className="flex flex-col gap-4">
          <div className="flex items-end gap-3">
            <div className="flex flex-1 flex-col gap-1">
              <label className="text-[11px] font-medium text-[var(--color-text-secondary)]">
                Select GPO
              </label>
              {gpoList.length > 0 ? (
                <select
                  value={scopeGpoDn}
                  onChange={(e) => {
                    setScopeGpoDn(e.target.value);
                    // Auto-fetch on selection
                    if (e.target.value) {
                      setScopeLoading(true);
                      setScopeError(null);
                      invoke<GpoLink[]>("get_gpo_scope", { gpoDn: e.target.value })
                        .then(setScopeLinks)
                        .catch((err) => setScopeError(extractErrorMessage(err)))
                        .finally(() => setScopeLoading(false));
                    } else {
                      setScopeLinks([]);
                    }
                  }}
                  className="h-8 rounded border border-[var(--color-border-default)] bg-[var(--color-surface-default)] px-2 text-caption text-[var(--color-text-primary)]"
                  data-testid="scope-gpo-dn"
                >
                  <option value="">Choose a GPO...</option>
                  {gpoList.map((gpo) => (
                    <option key={gpo.dn} value={gpo.dn}>
                      {gpo.displayName}{gpo.wmiFilter ? ` [WMI: ${gpo.wmiFilter}]` : ""}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={scopeGpoDn}
                    onChange={(e) => setScopeGpoDn(e.target.value)}
                    onKeyDown={(e) => handleKeyDown(e, fetchScope)}
                    placeholder="CN={GUID},CN=Policies,CN=System,DC=contoso,DC=com"
                    className="h-8 flex-1 rounded border border-[var(--color-border-default)] bg-[var(--color-surface-default)] px-2 text-caption text-[var(--color-text-primary)] placeholder:text-[var(--color-text-secondary)]"
                    data-testid="scope-gpo-dn"
                  />
                  <button
                    className="btn btn-sm btn-primary flex items-center gap-1"
                    onClick={fetchScope}
                    disabled={scopeLoading || !scopeGpoDn.trim()}
                    data-testid="scope-search-button"
                  >
                    <Search size={14} />
                    Find Links
                  </button>
                </div>
              )}
            </div>
          </div>

          {scopeError && <ErrorBanner message={scopeError} />}
          {scopeLoading && <LoadingSpinner />}
          {!scopeLoading && scopeLinks.length > 0 && (
            <ScopeTable links={scopeLinks} />
          )}
          {!scopeLoading && scopeLinks.length === 0 && scopeGpoDn && !scopeError && (
            <EmptyState
              icon={<FolderTree size={40} />}
              title="No links found"
              description="This GPO is not linked to any OU or domain."
            />
          )}
        </div>
      )}

      {/* What-If View */}
      {viewMode === "whatif" && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-1 flex-col gap-1">
              <label className="text-[11px] font-medium text-[var(--color-text-secondary)]">
                Target OU
              </label>
              <input
                type="text"
                value={whatIfOuDn}
                onChange={(e) => setWhatIfOuDn(e.target.value)}
                onKeyDown={(e) => handleKeyDown(e, fetchWhatIf)}
                placeholder="OU=Sales,DC=contoso,DC=com"
                className="h-8 rounded border border-[var(--color-border-default)] bg-[var(--color-surface-default)] px-2 text-caption text-[var(--color-text-primary)] placeholder:text-[var(--color-text-secondary)]"
                data-testid="whatif-ou-dn"
              />
            </div>
            <div className="flex w-64 flex-col gap-1">
              <label className="text-[11px] font-medium text-[var(--color-text-secondary)]">
                User DN (optional)
              </label>
              <input
                type="text"
                value={whatIfUserDn}
                onChange={(e) => setWhatIfUserDn(e.target.value)}
                onKeyDown={(e) => handleKeyDown(e, fetchWhatIf)}
                placeholder="CN=User,OU=..."
                className="h-8 rounded border border-[var(--color-border-default)] bg-[var(--color-surface-default)] px-2 text-caption text-[var(--color-text-primary)] placeholder:text-[var(--color-text-secondary)]"
                data-testid="whatif-user-dn"
              />
            </div>
            <button
              className="btn btn-sm btn-primary flex items-center gap-1"
              onClick={fetchWhatIf}
              disabled={whatIfLoading || !whatIfOuDn.trim()}
              data-testid="whatif-simulate-button"
            >
              <ArrowRight size={14} />
              Simulate
            </button>
          </div>

          {whatIfError && <ErrorBanner message={whatIfError} />}
          {whatIfLoading && <LoadingSpinner />}
          {whatIfResult && !whatIfLoading && (
            <GpoLinksTable
              links={whatIfResult.links}
              blocksInheritance={whatIfResult.blocksInheritance}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      className="rounded-lg border border-[var(--color-error)] bg-[var(--color-error)]/10 px-4 py-3 text-caption text-[var(--color-error)]"
      data-testid="error-message"
    >
      {message}
    </div>
  );
}

function GpoLinksTable({
  links,
  blocksInheritance,
}: {
  links: GpoLink[];
  blocksInheritance: boolean;
}) {
  if (links.length === 0) {
    return (
      <EmptyState
        icon={<Shield size={40} />}
        title="No GPOs linked"
        description="No Group Policy Objects apply to this object."
      />
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {blocksInheritance && (
        <div className="flex items-center gap-2 rounded-md border border-[var(--color-warning)] bg-[var(--color-warning)]/10 px-3 py-2 text-caption text-[var(--color-text-primary)]">
          <ShieldOff size={14} className="text-[var(--color-warning)]" />
          This container blocks Group Policy inheritance
        </div>
      )}

      <div className="text-caption text-[var(--color-text-secondary)]">
        {links.length} GPO(s) in effective order
      </div>

      <div className="overflow-auto rounded-lg border border-[var(--color-border-default)]">
        <table className="w-full text-caption" data-testid="gpo-table">
          <thead>
            <tr className="bg-[var(--color-surface-card)] text-left text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">
              <th className="px-3 py-2">#</th>
              <th className="px-3 py-2">GPO Name</th>
              <th className="px-3 py-2">Linked At</th>
              <th className="px-3 py-2 text-center">Enforced</th>
              <th className="px-3 py-2 text-center">Inherited</th>
              <th className="px-3 py-2">WMI Filter</th>
            </tr>
          </thead>
          <tbody>
            {links.map((link, idx) => (
              <tr
                key={`${link.gpoDn}-${idx}`}
                className="border-t border-[var(--color-border-subtle)] hover:bg-[var(--color-surface-hover)] transition-colors"
                data-testid="gpo-row"
              >
                <td className="px-3 py-2 text-[var(--color-text-secondary)]">
                  {idx + 1}
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1.5">
                    {link.isEnforced ? (
                      <ShieldAlert
                        size={14}
                        className="text-[var(--color-warning)]"
                      />
                    ) : (
                      <Shield
                        size={14}
                        className="text-[var(--color-text-secondary)]"
                      />
                    )}
                    <span
                      className={`font-medium ${
                        link.isEnforced
                          ? "text-[var(--color-warning)]"
                          : "text-[var(--color-text-primary)]"
                      }`}
                    >
                      {link.gpoName || formatDn(link.gpoDn)}
                    </span>
                  </div>
                </td>
                <td
                  className="px-3 py-2 text-[var(--color-text-secondary)] truncate max-w-[300px]"
                  title={link.linkedAt}
                >
                  {formatDn(link.linkedAt)}
                </td>
                <td className="px-3 py-2 text-center">
                  {link.isEnforced ? (
                    <CheckCircle
                      size={14}
                      className="inline-block text-[var(--color-warning)]"
                    />
                  ) : (
                    <span className="text-[var(--color-text-secondary)]">-</span>
                  )}
                </td>
                <td className="px-3 py-2 text-center">
                  {link.isInherited ? (
                    <span className="inline-flex rounded-full bg-[var(--color-primary)]/10 px-2 py-0.5 text-[10px] font-medium text-[var(--color-primary)]">
                      Inherited
                    </span>
                  ) : (
                    <span className="inline-flex rounded-full bg-[var(--color-success)]/10 px-2 py-0.5 text-[10px] font-medium text-[var(--color-success)]">
                      Direct
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-caption text-[var(--color-text-secondary)]">
                  {link.wmiFilter ?? "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ScopeTable({ links }: { links: GpoLink[] }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="text-caption text-[var(--color-text-secondary)]">
        Linked to {links.length} container(s)
      </div>
      <div className="overflow-auto rounded-lg border border-[var(--color-border-default)]">
        <table className="w-full text-caption" data-testid="scope-table">
          <thead>
            <tr className="bg-[var(--color-surface-card)] text-left text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">
              <th className="px-3 py-2">Container</th>
              <th className="px-3 py-2 text-center">Enforced</th>
              <th className="px-3 py-2 text-center">Disabled</th>
            </tr>
          </thead>
          <tbody>
            {links.map((link, idx) => (
              <tr
                key={`${link.linkedAt}-${idx}`}
                className="border-t border-[var(--color-border-subtle)] hover:bg-[var(--color-surface-hover)] transition-colors"
                data-testid="scope-row"
              >
                <td
                  className="px-3 py-2 font-medium text-[var(--color-text-primary)] truncate max-w-[400px]"
                  title={link.linkedAt}
                >
                  {formatDn(link.linkedAt) || link.linkedAt}
                </td>
                <td className="px-3 py-2 text-center">
                  {link.isEnforced ? (
                    <CheckCircle
                      size={14}
                      className="inline-block text-[var(--color-warning)]"
                    />
                  ) : (
                    <XCircle
                      size={14}
                      className="inline-block text-[var(--color-text-secondary)]"
                    />
                  )}
                </td>
                <td className="px-3 py-2 text-center">
                  {link.isDisabled ? (
                    <XCircle
                      size={14}
                      className="inline-block text-[var(--color-error)]"
                    />
                  ) : (
                    <CheckCircle
                      size={14}
                      className="inline-block text-[var(--color-success)]"
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
