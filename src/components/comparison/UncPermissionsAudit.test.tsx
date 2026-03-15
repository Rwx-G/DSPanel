import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { UncPermissionsAudit } from "./UncPermissionsAudit";
import type { DirectoryEntry } from "@/types/directory";
import type { NtfsAuditResult, AceCrossReference } from "@/types/ntfs";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
const mockInvoke = vi.mocked(invoke);

function makeEntry(sam: string, groups: string[] = []): DirectoryEntry {
  return {
    distinguishedName: `CN=${sam},OU=Users,DC=example,DC=com`,
    samAccountName: sam,
    displayName: sam,
    objectClass: "user",
    attributes: { memberOf: groups },
  };
}

const MOCK_AUDIT_RESULT: NtfsAuditResult = {
  path: "\\\\server\\share",
  aces: [
    {
      trusteeSid: "S-1-5-21-100",
      trusteeDisplayName: "Admins",
      accessType: "Allow",
      permissions: ["FullControl"],
      isInherited: false,
    },
    {
      trusteeSid: "S-1-5-21-200",
      trusteeDisplayName: "Everyone",
      accessType: "Deny",
      permissions: ["Write"],
      isInherited: true,
    },
  ],
  errors: [],
};

const MOCK_CROSS_REF: AceCrossReference[] = [
  {
    ace: MOCK_AUDIT_RESULT.aces[0],
    userAAccess: "Allowed",
    userBAccess: "NoMatch",
  },
  {
    ace: MOCK_AUDIT_RESULT.aces[1],
    userAAccess: "NoMatch",
    userBAccess: "Denied",
  },
];

describe("UncPermissionsAudit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders UNC path input and audit button", () => {
    render(<UncPermissionsAudit userA={null} userB={null} />);
    expect(screen.getByTestId("unc-path-input")).toBeInTheDocument();
    expect(screen.getByTestId("audit-button")).toBeInTheDocument();
  });

  it("audit button is disabled with empty path", () => {
    render(<UncPermissionsAudit userA={null} userB={null} />);
    expect(screen.getByTestId("audit-button")).toBeDisabled();
  });

  it("audits UNC path and displays results", async () => {
    mockInvoke.mockResolvedValueOnce(MOCK_AUDIT_RESULT);

    render(<UncPermissionsAudit userA={null} userB={null} />);

    fireEvent.change(screen.getByTestId("unc-path-input"), {
      target: { value: "\\\\server\\share" },
    });
    fireEvent.click(screen.getByTestId("audit-button"));

    await waitFor(() => {
      expect(screen.getByTestId("ace-results")).toBeInTheDocument();
      expect(screen.getByTestId("ace-table")).toBeInTheDocument();
      expect(screen.getByTestId("ace-row-0")).toBeInTheDocument();
      expect(screen.getByTestId("ace-row-1")).toBeInTheDocument();
    });
  });

  it("displays error on audit failure", async () => {
    mockInvoke.mockRejectedValueOnce("Access denied");

    render(<UncPermissionsAudit userA={null} userB={null} />);

    fireEvent.change(screen.getByTestId("unc-path-input"), {
      target: { value: "\\\\server\\share" },
    });
    fireEvent.click(screen.getByTestId("audit-button"));

    await waitFor(() => {
      expect(screen.getByTestId("unc-error")).toBeInTheDocument();
    });
  });

  it("cross-references ACEs when both users provided", async () => {
    const userA = makeEntry("jdoe", ["S-1-5-21-100"]);
    const userB = makeEntry("asmith", ["S-1-5-21-200"]);

    mockInvoke
      .mockResolvedValueOnce(MOCK_AUDIT_RESULT) // audit_ntfs_permissions
      .mockResolvedValueOnce(MOCK_CROSS_REF); // cross_reference_ntfs

    render(<UncPermissionsAudit userA={userA} userB={userB} />);

    fireEvent.change(screen.getByTestId("unc-path-input"), {
      target: { value: "\\\\server\\share" },
    });
    fireEvent.click(screen.getByTestId("audit-button"));

    await waitFor(() => {
      expect(screen.getByTestId("ace-results")).toBeInTheDocument();
      // Should have User A and User B columns
      expect(mockInvoke).toHaveBeenCalledWith(
        "cross_reference_ntfs",
        expect.any(Object),
      );
    });
  });

  it("export CSV button is present after audit", async () => {
    mockInvoke.mockResolvedValueOnce(MOCK_AUDIT_RESULT);

    render(<UncPermissionsAudit userA={null} userB={null} />);

    fireEvent.change(screen.getByTestId("unc-path-input"), {
      target: { value: "\\\\server\\share" },
    });
    fireEvent.click(screen.getByTestId("audit-button"));

    await waitFor(() => {
      expect(screen.getByTestId("export-csv-button")).toBeInTheDocument();
    });
  });

  it("shows access summary when cross-reference is available", async () => {
    const userA = makeEntry("jdoe", ["S-1-5-21-100"]);
    userA.displayName = "John Doe";
    const userB = makeEntry("asmith", ["S-1-5-21-200"]);
    userB.displayName = "Alice Smith";

    mockInvoke
      .mockResolvedValueOnce(MOCK_AUDIT_RESULT)
      .mockResolvedValueOnce(MOCK_CROSS_REF);

    render(<UncPermissionsAudit userA={userA} userB={userB} />);

    fireEvent.change(screen.getByTestId("unc-path-input"), {
      target: { value: "\\\\server\\share" },
    });
    fireEvent.click(screen.getByTestId("audit-button"));

    await waitFor(() => {
      expect(screen.getByTestId("access-summary")).toBeInTheDocument();
    });
  });

  it("shows color legend when cross-reference is available", async () => {
    const userA = makeEntry("jdoe", ["S-1-5-21-100"]);
    userA.displayName = "John Doe";
    const userB = makeEntry("asmith", ["S-1-5-21-200"]);
    userB.displayName = "Alice Smith";

    mockInvoke
      .mockResolvedValueOnce(MOCK_AUDIT_RESULT)
      .mockResolvedValueOnce(MOCK_CROSS_REF);

    render(<UncPermissionsAudit userA={userA} userB={userB} />);

    fireEvent.change(screen.getByTestId("unc-path-input"), {
      target: { value: "\\\\server\\share" },
    });
    fireEvent.click(screen.getByTestId("audit-button"));

    await waitFor(() => {
      expect(screen.getByTestId("ace-legend")).toBeInTheDocument();
      expect(screen.getByText(/John Doe only/)).toBeInTheDocument();
      expect(screen.getByText(/Alice Smith only/)).toBeInTheDocument();
    });
  });

  it("displays user names in table headers", async () => {
    const userA = makeEntry("jdoe", ["S-1-5-21-100"]);
    userA.displayName = "John Doe";
    const userB = makeEntry("asmith", ["S-1-5-21-200"]);
    userB.displayName = "Alice Smith";

    mockInvoke
      .mockResolvedValueOnce(MOCK_AUDIT_RESULT)
      .mockResolvedValueOnce(MOCK_CROSS_REF);

    render(<UncPermissionsAudit userA={userA} userB={userB} />);

    fireEvent.change(screen.getByTestId("unc-path-input"), {
      target: { value: "\\\\server\\share" },
    });
    fireEvent.click(screen.getByTestId("audit-button"));

    await waitFor(() => {
      expect(screen.getAllByText("John Doe").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("Alice Smith").length).toBeGreaterThanOrEqual(
        1,
      );
    });
  });

  it("triggers audit on Enter key", async () => {
    mockInvoke.mockResolvedValueOnce(MOCK_AUDIT_RESULT);

    render(<UncPermissionsAudit userA={null} userB={null} />);

    const input = screen.getByTestId("unc-path-input");
    fireEvent.change(input, { target: { value: "\\\\server\\share" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("audit_ntfs_permissions", {
        path: "\\\\server\\share",
      });
    });
  });
});
