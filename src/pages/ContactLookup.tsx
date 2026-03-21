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
import type { ContactInfo } from "@/types/contact";
import {
  Contact,
  AlertCircle,
  UserX,
  Trash2,
  Pencil,
  FolderInput,
} from "lucide-react";

export function ContactLookup() {
  const [query, setQuery] = useState("");
  const [contacts, setContacts] = useState<ContactInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedContact, setSelectedContact] = useState<ContactInfo | null>(
    null,
  );
  const [editMode, setEditMode] = useState(false);

  const { hasPermission } = usePermissions();
  const canEdit = hasPermission("AccountOperator");
  const { handleError } = useErrorHandler();
  const { notify } = useNotifications();

  const [contextMenuPos, setContextMenuPos] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [contextMenuItems, setContextMenuItems] = useState<ContextMenuItem[]>(
    [],
  );
  const [moveTargets, setMoveTargets] = useState<MoveTarget[] | null>(null);

  const searchContacts = useCallback(
    async (searchQuery: string) => {
      setQuery(searchQuery);
      if (searchQuery.length < 2) {
        setContacts([]);
        setError(null);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const results = await invoke<ContactInfo[]>("search_contacts", {
          query: searchQuery,
        });
        setContacts(results);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        setContacts([]);
        handleError(err, "searching contacts");
      } finally {
        setLoading(false);
      }
    },
    [handleError],
  );

  const handleDelete = useCallback(
    async (contact: ContactInfo) => {
      if (
        !window.confirm(
          `Are you sure you want to delete contact "${contact.displayName || contact.dn}"?`,
        )
      ) {
        return;
      }
      try {
        await invoke("delete_contact", { dn: contact.dn });
        notify("Contact deleted successfully", "success");
        setContacts((prev) => prev.filter((c) => c.dn !== contact.dn));
        if (selectedContact?.dn === contact.dn) {
          setSelectedContact(null);
        }
      } catch (err) {
        handleError(err, "deleting contact");
      }
    },
    [selectedContact, handleError, notify],
  );

  const handleEdit = useCallback(
    async (attributeName: string, _oldValue: string, newValue: string) => {
      if (!selectedContact) return;
      try {
        await invoke("update_contact", {
          dn: selectedContact.dn,
          attrs: { [attributeName]: newValue },
        });
        const updated = { ...selectedContact, [attributeName]: newValue };
        setSelectedContact(updated);
        setContacts((prev) =>
          prev.map((c) => (c.dn === updated.dn ? updated : c)),
        );
        notify("Contact updated successfully", "success");
      } catch (err) {
        handleError(err, "updating contact");
      }
    },
    [selectedContact, handleError, notify],
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, contact: ContactInfo) => {
      e.preventDefault();
      const items: ContextMenuItem[] = [];
      if (canEdit) {
        items.push({
          label: "Move to OU",
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
      const isEditable = editMode && canEdit;
      return [
        {
          category: "Identity",
          items: [
            {
              label: "Display Name",
              value: contact.displayName,
              editable: isEditable,
              attributeName: "displayName",
            },
            {
              label: "First Name",
              value: contact.firstName,
              editable: isEditable,
              attributeName: "firstName",
            },
            {
              label: "Last Name",
              value: contact.lastName,
              editable: isEditable,
              attributeName: "lastName",
            },
            { label: "Distinguished Name", value: contact.dn },
          ],
        },
        {
          category: "Contact Info",
          items: [
            {
              label: "Email",
              value: contact.email,
              editable: isEditable,
              attributeName: "email",
            },
            {
              label: "Phone",
              value: contact.phone,
              editable: isEditable,
              attributeName: "phone",
            },
            {
              label: "Mobile",
              value: contact.mobile,
              editable: isEditable,
              attributeName: "mobile",
            },
          ],
        },
        {
          category: "Organization",
          items: [
            {
              label: "Company",
              value: contact.company,
              editable: isEditable,
              attributeName: "company",
            },
            {
              label: "Department",
              value: contact.department,
              editable: isEditable,
              attributeName: "department",
            },
            {
              label: "Description",
              value: contact.description,
              editable: isEditable,
              attributeName: "description",
            },
          ],
        },
      ];
    },
    [editMode, canEdit],
  );

  const renderContactItem = useCallback(
    (contact: ContactInfo) => (
      <button
        className={`flex w-full items-center gap-2 border-b border-[var(--color-border-subtle)] px-3 py-2 text-left transition-colors hover:bg-[var(--color-surface-hover)] ${
          selectedContact?.dn === contact.dn
            ? "bg-[var(--color-surface-selected)]"
            : ""
        }`}
        onClick={() => {
          setSelectedContact(contact);
          setEditMode(false);
        }}
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
            {contact.email || contact.company || "No email"}
          </p>
        </div>
      </button>
    ),
    [selectedContact, handleContextMenu],
  );

  return (
    <div className="flex h-full flex-col" data-testid="contact-lookup">
      <div className="flex items-center gap-2 border-b border-[var(--color-border-subtle)] px-3 py-2">
        <div className="flex-1">
          <SearchBar
            value={query}
            onChange={searchContacts}
            onSearch={searchContacts}
            placeholder="Search contacts by name, email, or company..."
            debounceMs={300}
          />
        </div>
      </div>

      <div
        className="sr-only"
        aria-live="polite"
        data-testid="contact-lookup-status"
      >
        {loading && "Searching contacts..."}
        {!loading &&
          contacts.length > 0 &&
          `${contacts.length} contact${contacts.length > 1 ? "s" : ""} found`}
        {!loading &&
          contacts.length === 0 &&
          !error &&
          query.length >= 2 &&
          "No contacts found"}
        {error && `Error: ${error}`}
      </div>

      <div className="flex flex-1 overflow-hidden">
        {loading && (
          <div
            className="flex flex-1 items-center justify-center"
            data-testid="contact-lookup-loading"
          >
            <LoadingSpinner message="Searching contacts..." />
          </div>
        )}

        {!loading && error && (
          <div
            className="flex flex-1 items-center justify-center"
            data-testid="contact-lookup-error"
          >
            <EmptyState
              icon={<AlertCircle size={48} />}
              title="Failed to search contacts"
              description={error}
              action={{
                label: "Retry",
                onClick: () => searchContacts(query),
              }}
            />
          </div>
        )}

        {!loading && !error && query.length < 2 && (
          <div className="flex flex-1 items-center justify-center">
            <EmptyState
              icon={<Contact size={48} />}
              title="Search for contacts"
              description="Enter at least 2 characters to search."
            />
          </div>
        )}

        {!loading && !error && query.length >= 2 && contacts.length === 0 && (
          <div className="flex flex-1 items-center justify-center">
            <EmptyState
              icon={<UserX size={48} />}
              title="No contacts found"
              description={`No contacts match "${query}".`}
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
                className="h-full"
              />
            </div>

            <div
              className="flex-1 overflow-auto p-4"
              data-testid="contact-detail-panel"
            >
              {selectedContact ? (
                <div data-testid="contact-detail">
                  <div className="mb-4 flex items-center justify-between">
                    <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
                      {selectedContact.displayName ||
                        `${selectedContact.firstName} ${selectedContact.lastName}`.trim()}
                    </h2>
                    {canEdit && (
                      <div className="flex items-center gap-2">
                        <button
                          className={`btn btn-sm ${editMode ? "btn-outline" : "btn-ghost"}`}
                          onClick={() => setEditMode(!editMode)}
                          data-testid="contact-edit-btn"
                        >
                          <Pencil size={14} />
                          {editMode ? "Done" : "Edit"}
                        </button>
                        <button
                          className="btn btn-sm btn-ghost text-[var(--color-error)]"
                          onClick={() => handleDelete(selectedContact)}
                          data-testid="contact-delete-btn"
                        >
                          <Trash2 size={14} />
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                  <PropertyGrid
                    groups={buildPropertyGroups(selectedContact)}
                    onEdit={editMode && canEdit ? handleEdit : undefined}
                  />
                </div>
              ) : (
                <div className="flex h-full items-center justify-center">
                  <p className="text-body text-[var(--color-text-secondary)]">
                    Select a contact to view details
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
          onMoved={() => searchContacts(query)}
        />
      )}
    </div>
  );
}
