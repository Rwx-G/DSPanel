import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { SearchBar } from "@/components/common/SearchBar";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import { EmptyState } from "@/components/common/EmptyState";
import { VirtualizedList } from "@/components/data/VirtualizedList";
import {
  PropertyGrid,
  type PropertyGroup,
} from "@/components/data/PropertyGrid";
import {
  ContextMenu,
  type ContextMenuItem,
} from "@/components/common/ContextMenu";
import {
  MoveObjectDialog,
  type MoveTarget,
} from "@/components/dialogs/MoveObjectDialog";
import { usePermissions } from "@/hooks/usePermissions";
import { useErrorHandler } from "@/hooks/useErrorHandler";
import { useNotifications } from "@/contexts/NotificationContext";
import { useDialog } from "@/contexts/DialogContext";
import { useBrowse } from "@/hooks/useBrowse";
import { useModifyAttribute } from "@/hooks/useModifyAttribute";
import { type ContactInfo, mapEntryToContact } from "@/types/contact";
import {
  Contact,
  AlertCircle,
  UserX,
  Trash2,
  FolderInput,
} from "lucide-react";
import { useTranslation } from "react-i18next";

function useContactBrowse() {
  return useBrowse<ContactInfo>({
    browseCommand: "browse_contacts",
    searchCommand: "search_contacts",
    mapEntry: mapEntryToContact,
    clientFilter: (c, lower) =>
      c.displayName.toLowerCase().includes(lower) ||
      c.email.toLowerCase().includes(lower) ||
      c.company.toLowerCase().includes(lower) ||
      c.firstName.toLowerCase().includes(lower) ||
      c.lastName.toLowerCase().includes(lower),
    itemKey: (c) => c.dn,
    preloadAll: true,
  });
}

export function ContactLookup() {
  const { t } = useTranslation(["contactLookup", "common"]);
  const {
    items: contacts,
    loading,
    loadingMore,
    error,
    hasMore,
    filterText,
    setFilterText,
    loadMore,
    selectedItem: selectedContact,
    setSelectedItem: setSelectedContact,
    refresh,
  } = useContactBrowse();

  const { hasPermission } = usePermissions();
  const canEdit = hasPermission("AccountOperator");
  const { handleError } = useErrorHandler();
  const { notify } = useNotifications();
  const { showConfirmation } = useDialog();
  const { pendingChanges, saving, stageChange, clearChanges, submitChanges } =
    useModifyAttribute();

  const [contextMenuPos, setContextMenuPos] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [contextMenuItems, setContextMenuItems] = useState<ContextMenuItem[]>(
    [],
  );
  const [moveTargets, setMoveTargets] = useState<MoveTarget[] | null>(null);

  const handleDelete = useCallback(
    async (contact: ContactInfo) => {
      const confirmed = await showConfirmation(
        t("deleteContact"),
        t("deleteConfirmation", { name: contact.displayName || contact.dn }),
        t("common:cannotBeUndone"),
      );
      if (!confirmed) return;
      try {
        await invoke("delete_contact", { dn: contact.dn });
        notify(t("deleteSuccess"), "success");
        refresh();
        if (selectedContact?.dn === contact.dn) {
          setSelectedContact(null);
        }
      } catch (err) {
        handleError(err, "deleting contact");
      }
    },
    [selectedContact, setSelectedContact, handleError, notify, refresh, showConfirmation],
  );

  const handleEdit = useCallback(
    (attributeName: string, oldValue: string, newValue: string) => {
      stageChange(attributeName, oldValue, newValue);
    },
    [stageChange],
  );

  const handleSaveChanges = useCallback(async () => {
    if (!selectedContact) return;
    const confirmed = await showConfirmation(
      t("common:save"),
      t("common:pendingChanges", { count: pendingChanges.length, name: selectedContact.displayName || selectedContact.dn }),
      pendingChanges.map((c) => `${c.attributeName}: ${c.newValue}`).join("\n"),
    );
    if (!confirmed) return;
    const success = await submitChanges(selectedContact.dn);
    if (success) {
      notify("Contact updated successfully", "success");
      refresh();
    }
  }, [selectedContact, pendingChanges, showConfirmation, submitChanges, notify, refresh]);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, contact: ContactInfo) => {
      e.preventDefault();
      const items: ContextMenuItem[] = [];
      if (canEdit) {
        items.push({
          label: t("common:moveToOu"),
          icon: <FolderInput size={14} />,
          onClick: () => {
            setMoveTargets([
              {
                distinguishedName: contact.dn,
                displayName: contact.displayName || contact.dn,
              },
            ]);
          },
        });
      }
      if (items.length > 0) {
        setContextMenuItems(items);
        setContextMenuPos({ x: e.clientX, y: e.clientY });
      }
    },
    [canEdit],
  );

  const buildPropertyGroups = useCallback(
    (contact: ContactInfo): PropertyGroup[] => {
      const isEditable = canEdit;
      return [
        {
          category: t("common:identity"),
          items: [
            { label: t("common:displayName"), value: contact.displayName, editable: isEditable, attributeName: "displayName" },
            { label: t("common:firstName"), value: contact.firstName, editable: isEditable, attributeName: "givenName" },
            { label: t("common:lastName"), value: contact.lastName, editable: isEditable, attributeName: "sn" },
            { label: t("common:distinguishedName"), value: contact.dn },
          ],
        },
        {
          category: t("contactInfo"),
          items: [
            { label: t("common:email"), value: contact.email, editable: isEditable, attributeName: "mail" },
            { label: t("common:phone"), value: contact.phone, editable: isEditable, attributeName: "telephoneNumber" },
            { label: t("common:mobile"), value: contact.mobile, editable: isEditable, attributeName: "mobile" },
          ],
        },
        {
          category: t("organization"),
          items: [
            { label: t("common:company"), value: contact.company, editable: isEditable, attributeName: "company" },
            { label: t("common:department"), value: contact.department, editable: isEditable, attributeName: "department" },
            { label: t("common:description"), value: contact.description, editable: isEditable, attributeName: "description" },
          ],
        },
      ];
    },
    [canEdit],
  );

  const renderContactItem = useCallback(
    (contact: ContactInfo) => (
      <button
        className={`flex w-full items-center gap-2 border-b border-[var(--color-border-subtle)] px-3 py-2 text-left transition-colors hover:bg-[var(--color-surface-hover)] ${
          selectedContact?.dn === contact.dn
            ? "bg-[var(--color-surface-selected)]"
            : ""
        }`}
        onClick={() => setSelectedContact(contact)}
        onContextMenu={(e) => handleContextMenu(e, contact)}
        data-testid={`contact-result-${contact.dn}`}
      >
        <Contact
          size={16}
          className="shrink-0 text-[var(--color-text-secondary)]"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-body font-medium text-[var(--color-text-primary)]">
            {contact.displayName || `${contact.firstName} ${contact.lastName}`.trim() || contact.dn}
          </p>
          <p className="truncate text-caption text-[var(--color-text-secondary)]">
            {contact.email || contact.company || t("noEmail")}
          </p>
        </div>
      </button>
    ),
    [selectedContact, setSelectedContact, handleContextMenu],
  );

  return (
    <div className="flex h-full flex-col" data-testid="contact-lookup">
      <div className="flex items-center gap-2 border-b border-[var(--color-border-subtle)] px-3 py-2">
        <div className="flex-1">
          <SearchBar
            value={filterText}
            onChange={setFilterText}
            onSearch={setFilterText}
            placeholder={t("searchPlaceholder")}
            debounceMs={300}
          />
        </div>
      </div>

      <div
        className="sr-only"
        aria-live="polite"
        data-testid="contact-lookup-status"
      >
        {loading && t("loadingContacts")}
        {!loading &&
          contacts.length > 0 &&
          t("found", { count: contacts.length })}
        {!loading && contacts.length === 0 && !error && t("noContactsFound")}
        {error && `${t("common:error")}: ${error}`}
      </div>

      <div className="flex flex-1 overflow-hidden">
        {loading && (
          <div
            className="flex flex-1 items-center justify-center"
            data-testid="contact-lookup-loading"
          >
            <LoadingSpinner message={t("loadingContacts")} />
          </div>
        )}

        {!loading && error && (
          <div
            className="flex flex-1 items-center justify-center"
            data-testid="contact-lookup-error"
          >
            <EmptyState
              icon={<AlertCircle size={48} />}
              title={t("failedToLoad")}
              description={error}
              action={{ label: t("common:retry"), onClick: refresh }}
            />
          </div>
        )}

        {!loading && !error && contacts.length === 0 && (
          <div className="flex flex-1 items-center justify-center">
            <EmptyState
              icon={<UserX size={48} />}
              title={t("noContactsFound")}
              description={
                filterText
                  ? t("noContactsMatch", { query: filterText })
                  : t("noContactsFound")
              }
            />
          </div>
        )}

        {!loading && !error && contacts.length > 0 && (
          <>
            <div
              className="w-64 shrink-0 border-r border-[var(--color-border-subtle)]"
              data-testid="contact-results-list"
            >
              <VirtualizedList
                items={contacts}
                renderItem={renderContactItem}
                estimateSize={52}
                itemKey={(contact) => contact.dn}
                loadingMore={loadingMore}
                onEndReached={hasMore ? loadMore : undefined}
                className="h-full"
              />
            </div>

            <div
              className="flex-1 overflow-auto p-4"
              data-testid="contact-detail-panel"
            >
              {selectedContact ? (
                <div data-testid="contact-detail">
                  <div className="mb-4">
                    <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
                      {selectedContact.displayName ||
                        `${selectedContact.firstName} ${selectedContact.lastName}`.trim()}
                    </h2>
                  </div>

                  <div className="mb-4 flex flex-wrap items-center gap-2">
                    {canEdit && (
                      <button
                        className="btn btn-sm flex items-center gap-1"
                        style={{ color: "var(--color-error)", borderColor: "var(--color-error)" }}
                        onClick={() => handleDelete(selectedContact)}
                        data-testid="contact-delete-btn"
                      >
                        <Trash2 size={14} />
                        {t("common:delete")}
                      </button>
                    )}

                    {pendingChanges.length > 0 && (
                      <>
                        <div className="mx-1 h-6 w-px bg-[var(--color-border-default)]" />
                        <div
                          className="flex items-center gap-2 rounded-lg border border-[var(--color-primary)] bg-[var(--color-primary-subtle)] px-3 py-1"
                          data-testid="pending-changes-bar"
                        >
                          <span className="text-caption text-[var(--color-text-primary)]">
                            {t("common:change", { count: pendingChanges.length })}
                            {pendingChanges.map((c) => (
                              <span
                                key={c.attributeName}
                                className="ml-1.5 inline-block rounded bg-[var(--color-surface-card)] px-1.5 py-0.5 text-[10px] font-mono"
                              >
                                {c.attributeName}
                              </span>
                            ))}
                          </span>
                          <button
                            onClick={clearChanges}
                            className="btn btn-sm btn-ghost"
                            data-testid="discard-changes-btn"
                          >
                            {t("common:discard")}
                          </button>
                          <button
                            onClick={handleSaveChanges}
                            disabled={saving}
                            className="btn btn-sm btn-primary"
                            data-testid="save-changes-btn"
                          >
                            {saving ? t("common:saving") : t("common:save")}
                          </button>
                        </div>
                      </>
                    )}
                  </div>

                  <PropertyGrid
                    groups={buildPropertyGroups(selectedContact)}
                    onEdit={canEdit ? handleEdit : undefined}
                  />
                </div>
              ) : (
                <div className="flex h-full items-center justify-center">
                  <p className="text-body text-[var(--color-text-secondary)]">
                    {t("selectContact")}
                  </p>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <ContextMenu
        items={contextMenuItems}
        position={contextMenuPos}
        onClose={() => setContextMenuPos(null)}
      />

      {moveTargets && (
        <MoveObjectDialog
          targets={moveTargets}
          onClose={() => setMoveTargets(null)}
          onMoved={refresh}
        />
      )}
    </div>
  );
}
