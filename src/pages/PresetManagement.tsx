import { useState, useCallback } from "react";
import { Plus, Save, Trash2, AlertTriangle, FolderOpen } from "lucide-react";
import { usePresets } from "@/hooks/usePresets";
import { usePresetPath } from "@/hooks/usePresetPath";
import { useGroupSearch } from "@/hooks/useGroupSearch";
import { useOUTree } from "@/hooks/useOUTree";
import { useDialog } from "@/contexts/DialogContext";
import { useNavigation } from "@/contexts/NavigationContext";
import { PermissionGate } from "@/components/common/PermissionGate";
import { GroupPicker, type GroupOption } from "@/components/form/GroupPicker";
import { OUPicker } from "@/components/form/OUPicker";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import { EmptyState } from "@/components/common/EmptyState";
import type { Preset, PresetType } from "@/types/preset";
import { useTranslation } from "react-i18next";

const EMPTY_PRESET: Preset = {
  name: "",
  description: "",
  type: "Onboarding",
  targetOu: "",
  groups: [],
  attributes: {},
};

function parseCnFromDn(dn: string): string {
  const match = dn.match(/^CN=([^,]+)/i);
  return match ? match[1] : dn;
}

function PresetEditorWrapper() {
  const { t } = useTranslation(["presetManagement", "common"]);
  const { path: presetPath } = usePresetPath();
  const { openTab } = useNavigation();

  const handleOpenSettings = useCallback(() => {
    openTab("Settings", "settings", undefined, { tab: "presets" });
  }, [openTab]);

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      {presetPath && (
        <div
          className="flex items-center gap-1.5 self-start text-caption text-[var(--color-text-secondary)]"
          data-testid="preset-show-settings"
        >
          <FolderOpen size={12} />
          Storage: {presetPath}
        </div>
      )}
      {presetPath ? (
        <PresetEditor />
      ) : (
        <EmptyState
          icon={<FolderOpen size={40} />}
          title={t("storageNotConfigured")}
          description={t("storageNotConfiguredDescription")}
          action={{ label: t("openSettings"), onClick: handleOpenSettings }}
        />
      )}
    </div>
  );
}

function PresetEditor() {
  const { t } = useTranslation(["presetManagement", "common"]);
  const { presets, loading, savePreset, deletePreset, acceptChecksum } = usePresets();
  const searchGroups = useGroupSearch();
  const { nodes: ouNodes, loading: ouLoading, error: ouError } = useOUTree({ silent: true });
  const { showConfirmation } = useDialog();

  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [draft, setDraft] = useState<Preset>(EMPTY_PRESET);
  const [isNew, setIsNew] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const selectedGroups: GroupOption[] = draft.groups.map((dn) => ({
    distinguishedName: dn,
    name: parseCnFromDn(dn),
  }));

  const [attrKey, setAttrKey] = useState("");
  const [attrValue, setAttrValue] = useState("");

  const handleSelectPreset = useCallback(
    (index: number) => {
      setSelectedIndex(index);
      setDraft({ ...presets[index] });
      setIsNew(false);
      setErrors([]);
    },
    [presets],
  );

  const handleNew = useCallback(() => {
    setSelectedIndex(null);
    setDraft({ ...EMPTY_PRESET });
    setIsNew(true);
    setErrors([]);
  }, []);

  const validate = useCallback((): string[] => {
    const errs: string[] = [];
    if (!draft.name.trim()) errs.push("Name is required");
    if (!draft.targetOu.trim()) errs.push("Target OU is required");
    if (draft.groups.length === 0 && Object.keys(draft.attributes).length === 0)
      errs.push("At least one group or attribute is required");
    // Check name uniqueness for new presets
    if (
      isNew &&
      presets.some(
        (p) => p.name.toLowerCase() === draft.name.trim().toLowerCase(),
      )
    )
      errs.push("A preset with this name already exists");
    return errs;
  }, [draft, isNew, presets]);

  const handleSave = useCallback(async () => {
    const errs = validate();
    if (errs.length > 0) {
      setErrors(errs);
      return;
    }
    setErrors([]);
    setSaving(true);
    const success = await savePreset(draft);
    setSaving(false);
    if (success) {
      setIsNew(false);
      // Find the saved preset in the refreshed list
      const idx = presets.findIndex(
        (p) => p.name.toLowerCase() === draft.name.toLowerCase(),
      );
      if (idx >= 0) setSelectedIndex(idx);
    }
  }, [validate, draft, savePreset, presets]);

  const handleDelete = useCallback(async () => {
    if (selectedIndex === null || isNew) return;
    const preset = presets[selectedIndex];
    const confirmed = await showConfirmation(
      "Delete Preset",
      `Are you sure you want to delete "${preset.name}"?`,
      "This action cannot be undone.",
    );
    if (!confirmed) return;

    const success = await deletePreset(preset.name);
    if (success) {
      setSelectedIndex(null);
      setDraft({ ...EMPTY_PRESET });
      setIsNew(false);
    }
  }, [selectedIndex, isNew, presets, showConfirmation, deletePreset]);

  const handleGroupChange = useCallback(
    (groups: GroupOption[]) => {
      setDraft({ ...draft, groups: groups.map((g) => g.distinguishedName) });
    },
    [draft],
  );

  const handleAddAttribute = useCallback(() => {
    if (!attrKey.trim()) return;
    setDraft({
      ...draft,
      attributes: { ...draft.attributes, [attrKey.trim()]: attrValue },
    });
    setAttrKey("");
    setAttrValue("");
  }, [draft, attrKey, attrValue]);

  const handleRemoveAttribute = useCallback(
    (key: string) => {
      const attrs = { ...draft.attributes };
      delete attrs[key];
      setDraft({ ...draft, attributes: attrs });
    },
    [draft],
  );

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <LoadingSpinner message={t("common:loading")} />
      </div>
    );
  }

  const hasEditor = selectedIndex !== null || isNew;

  return (
    <div className="flex flex-1 min-h-0 gap-4" data-testid="preset-management">
      {/* Left panel: Preset list */}
      <div className="flex w-72 shrink-0 flex-col rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)]">
        {/* Toolbar */}
        <div className="flex items-center gap-2 border-b border-[var(--color-border-default)] p-2">
          <button
            onClick={handleNew}
            className="btn btn-sm btn-primary"
            data-testid="preset-new-btn"
          >
            <Plus size={14} /> {t("new")}
          </button>
          <button
            onClick={handleSave}
            disabled={!hasEditor || saving}
            className="btn btn-sm btn-secondary"
            data-testid="preset-save-btn"
          >
            <Save size={14} /> {t("common:save")}
          </button>
          <button
            onClick={handleDelete}
            disabled={selectedIndex === null || isNew}
            className="btn btn-sm btn-ghost text-[var(--color-error)] hover:bg-[var(--color-error-bg)]"
            data-testid="preset-delete-btn"
          >
            <Trash2 size={14} /> {t("common:delete")}
          </button>
        </div>

        {/* Preset list */}
        <div className="flex-1 overflow-auto">
          {presets.length === 0 && !isNew ? (
            <EmptyState
              title={t("noPresets")}
              description={t("noPresetsDescription")}
            />
          ) : (
            <div className="divide-y divide-[var(--color-border-default)]">
              {presets.map((preset, index) => (
                <button
                  key={preset.name}
                  onClick={() => handleSelectPreset(index)}
                  className={`w-full px-3 py-2 text-left transition-colors ${
                    selectedIndex === index && !isNew
                      ? "bg-[var(--color-primary-subtle)]"
                      : "hover:bg-[var(--color-surface-hover)]"
                  }`}
                  data-testid={`preset-item-${index}`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-body font-medium text-[var(--color-text-primary)] truncate">
                      {preset.name}
                    </span>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                        preset.type === "Onboarding"
                          ? "bg-[var(--color-success-bg)] text-[var(--color-success)]"
                          : "bg-[var(--color-warning-bg)] text-[var(--color-warning)]"
                      }`}
                    >
                      {preset.type}
                    </span>
                    {preset.integrityWarning && (
                      <AlertTriangle
                        size={14}
                        className="shrink-0 text-[var(--color-warning)]"
                        aria-label={t("presetModifiedAriaLabel")}
                      />
                    )}
                  </div>
                  {preset.description && (
                    <div className="mt-0.5 text-caption text-[var(--color-text-secondary)] truncate">
                      {preset.description}
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right panel: Editor form */}
      <div className="flex-1 rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] p-4 overflow-auto">
        {!hasEditor ? (
          <EmptyState
            title={t("selectPreset")}
            description={t("selectPresetDescription")}
          />
        ) : (
          <div className="space-y-4" data-testid="preset-editor-form">
            {/* Integrity warning */}
            {selectedIndex !== null && !isNew && presets[selectedIndex]?.integrityWarning && (
              <div
                className="flex items-start gap-2 rounded-md border border-[var(--color-warning)] bg-[var(--color-warning-bg)] p-3"
                data-testid="preset-integrity-warning"
              >
                <AlertTriangle size={16} className="shrink-0 mt-0.5 text-[var(--color-warning)]" />
                <div className="flex-1">
                  <div className="text-caption font-semibold text-[var(--color-warning)]">
                    {t("modifiedOutside")}
                  </div>
                  <div className="mt-0.5 text-caption text-[var(--color-text-secondary)]">
                    {t("modifiedOutsideDescription")}
                  </div>
                  <button
                    className="btn btn-sm mt-2"
                    onClick={() => acceptChecksum(presets[selectedIndex].name)}
                    data-testid="preset-accept-checksum"
                  >
                    {t("acceptChanges")}
                  </button>
                </div>
              </div>
            )}

            {/* Validation errors */}
            {errors.length > 0 && (
              <div
                className="rounded-md border border-[var(--color-error)] bg-[var(--color-error-bg)] p-3"
                data-testid="preset-editor-errors"
              >
                {errors.map((err) => (
                  <div
                    key={err}
                    className="text-caption text-[var(--color-error)]"
                  >
                    {err}
                  </div>
                ))}
              </div>
            )}

            {/* Name */}
            <div>
              <label className="mb-1 block text-caption font-semibold text-[var(--color-text-secondary)]">
                {t("nameLabel")}
              </label>
              <input
                type="text"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                className="w-full rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-3 py-1.5 text-body text-[var(--color-text-primary)] focus:border-[var(--color-primary)] focus:outline-none"
                placeholder={t("presetNamePlaceholder")}
                data-testid="preset-name-input"
              />
            </div>

            {/* Description */}
            <div>
              <label className="mb-1 block text-caption font-semibold text-[var(--color-text-secondary)]">
                {t("common:description")}
              </label>
              <textarea
                value={draft.description}
                onChange={(e) =>
                  setDraft({ ...draft, description: e.target.value })
                }
                rows={2}
                className="w-full rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-3 py-1.5 text-body text-[var(--color-text-primary)] focus:border-[var(--color-primary)] focus:outline-none resize-none"
                placeholder={t("descriptionPlaceholder")}
                data-testid="preset-description-input"
              />
            </div>

            {/* Type */}
            <div>
              <label className="mb-1 block text-caption font-semibold text-[var(--color-text-secondary)]">
                {t("typeLabel")}
              </label>
              <select
                value={draft.type}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    type: e.target.value as PresetType,
                  })
                }
                className="w-full rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-3 py-1.5 text-body text-[var(--color-text-primary)] focus:border-[var(--color-primary)] focus:outline-none"
                data-testid="preset-type-select"
              >
                <option value="Onboarding">Onboarding</option>
                <option value="Offboarding">Offboarding</option>
              </select>
            </div>

            {/* Target OU */}
            <div>
              <label className="mb-1 block text-caption font-semibold text-[var(--color-text-secondary)]">
                {t("targetOU")}
              </label>
              <OUPicker
                nodes={ouNodes}
                selectedOU={draft.targetOu}
                onSelect={(dn) => setDraft({ ...draft, targetOu: dn })}
                loading={ouLoading}
                error={ouError}
              />
            </div>

            {/* Groups */}
            <div>
              <label className="mb-1 block text-caption font-semibold text-[var(--color-text-secondary)]">
                {t("groupsLabel")}
              </label>
              <GroupPicker
                selectedGroups={selectedGroups}
                onSelectionChange={handleGroupChange}
                onSearch={searchGroups}
                placeholder={t("searchGroupsPlaceholder")}
              />
            </div>

            {/* Custom Attributes */}
            <div>
              <label className="mb-1 block text-caption font-semibold text-[var(--color-text-secondary)]">
                {t("customAttributes")}
              </label>
              {Object.entries(draft.attributes).length > 0 && (
                <div className="mb-2 space-y-1">
                  {Object.entries(draft.attributes).map(([key, value]) => (
                    <div
                      key={key}
                      className="flex items-center gap-2 rounded-md bg-[var(--color-surface-hover)] px-3 py-1"
                    >
                      <span className="text-caption font-medium text-[var(--color-text-primary)]">
                        {key}
                      </span>
                      <span className="text-caption text-[var(--color-text-secondary)]">
                        = {value}
                      </span>
                      <button
                        onClick={() => handleRemoveAttribute(key)}
                        className="ml-auto text-[var(--color-text-secondary)] hover:text-[var(--color-error)]"
                        data-testid={`attr-remove-${key}`}
                      >
                        &times;
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={attrKey}
                  onChange={(e) => setAttrKey(e.target.value)}
                  placeholder={t("attrNamePlaceholder")}
                  className="flex-1 rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-3 py-1 text-caption text-[var(--color-text-primary)] focus:border-[var(--color-primary)] focus:outline-none"
                  data-testid="attr-key-input"
                />
                <input
                  type="text"
                  value={attrValue}
                  onChange={(e) => setAttrValue(e.target.value)}
                  placeholder={t("valuePlaceholder")}
                  className="flex-1 rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-3 py-1 text-caption text-[var(--color-text-primary)] focus:border-[var(--color-primary)] focus:outline-none"
                  data-testid="attr-value-input"
                />
                <button
                  onClick={handleAddAttribute}
                  disabled={!attrKey.trim()}
                  className="btn btn-sm btn-secondary"
                  data-testid="attr-add-btn"
                >
                  {t("common:add")}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function PresetManagement() {
  const { t } = useTranslation(["presetManagement", "common"]);
  return (
    <PermissionGate
      requiredLevel="AccountOperator"
      fallback={
        <div className="flex h-full items-center justify-center p-8">
          <EmptyState
            title={t("common:accessDenied")}
            description={t("accessDeniedDescription")}
          />
        </div>
      }
    >
      <PresetEditorWrapper />
    </PermissionGate>
  );
}
