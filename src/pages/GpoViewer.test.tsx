import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { GpoViewer } from "./GpoViewer";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
const mockInvoke = vi.mocked(invoke);

describe("GpoViewer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockImplementation(() => Promise.resolve(null));
  });

  it("renders the page title", () => {
    render(<GpoViewer />);
    expect(screen.getByText("GPO Viewer")).toBeInTheDocument();
  });

  it("shows three view mode tabs", () => {
    render(<GpoViewer />);
    expect(screen.getByTestId("tab-links")).toBeInTheDocument();
    expect(screen.getByTestId("tab-scope")).toBeInTheDocument();
  });

  it("shows search input and OU select for links view", () => {
    render(<GpoViewer />);
    expect(screen.getByTestId("links-search-input")).toBeInTheDocument();
    expect(screen.getByTestId("links-ou-select")).toBeInTheDocument();
  });

  it("switches to scope view", () => {
    render(<GpoViewer />);
    fireEvent.click(screen.getByTestId("tab-scope"));
    expect(screen.getByTestId("scope-gpo-dn")).toBeInTheDocument();
    expect(screen.getByTestId("scope-search-button")).toBeInTheDocument();
  });

  it("has export toolbar", () => {
    render(<GpoViewer />);
    expect(screen.getByTestId("export-toolbar")).toBeInTheDocument();
  });

  it("scope view fetches and displays linked OUs", async () => {
    const mockScopeResult = [
      {
        gpoDn: "CN={AAA}",
        gpoName: "",
        linkOrder: 1,
        isEnforced: false,
        isDisabled: false,
        linkedAt: "DC=contoso,DC=com",
        isInherited: false,
        wmiFilter: null,
      },
      {
        gpoDn: "CN={AAA}",
        gpoName: "",
        linkOrder: 1,
        isEnforced: true,
        isDisabled: false,
        linkedAt: "OU=Finance,DC=contoso,DC=com",
        isInherited: false,
        wmiFilter: null,
      },
    ];
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_gpo_list") return Promise.resolve([]);
      if (cmd === "get_ou_tree") return Promise.resolve([]);
      if (cmd === "get_gpo_scope") return Promise.resolve(mockScopeResult);
      return Promise.resolve(null);
    });

    render(<GpoViewer />);
    fireEvent.click(screen.getByTestId("tab-scope"));

    // With empty gpoList, fallback text input + button is shown
    fireEvent.change(screen.getByTestId("scope-gpo-dn"), {
      target: { value: "CN={AAA}" },
    });
    fireEvent.click(screen.getByTestId("scope-search-button"));

    await waitFor(() => {
      expect(screen.getAllByTestId("scope-row").length).toBe(2);
    });
  });

  // -----------------------------------------------------------------------
  // Links view - search + fetch
  // -----------------------------------------------------------------------

  it("search results appear after typing and selecting populates objectDn", async () => {
    const mockSearchUsers = [
      {
        distinguishedName: "CN=John,OU=Users,DC=contoso,DC=com",
        samAccountName: "jdoe",
        displayName: "John Doe",
        objectClass: ["user"],
      },
    ];
    const mockLinksResult = {
      objectDn: "CN=John,OU=Users,DC=contoso,DC=com",
      links: [
        {
          gpoDn: "CN={BBB}",
          gpoName: "Default Domain Policy",
          linkOrder: 1,
          isEnforced: false,
          isDisabled: false,
          linkedAt: "DC=contoso,DC=com",
          isInherited: true,
          wmiFilter: null,
        },
      ],
      blocksInheritance: false,
    };

    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_gpo_list") return Promise.resolve([]);
      if (cmd === "get_ou_tree") return Promise.resolve([]);
      if (cmd === "search_users") return Promise.resolve(mockSearchUsers);
      if (cmd === "search_computers") return Promise.resolve([]);
      if (cmd === "get_gpo_links") return Promise.resolve(mockLinksResult);
      return Promise.resolve(null);
    });

    render(<GpoViewer />);

    const searchInput = screen.getByPlaceholderText("Search by name or SAM...");
    // First change sets searchQuery state; handleSearch reads stale closure value
    await act(async () => {
      fireEvent.change(searchInput, { target: { value: "Jo" } });
    });
    // Second change triggers handleSearch with searchQuery="Jo" now in closure
    await act(async () => {
      fireEvent.change(searchInput, { target: { value: "John" } });
    });

    await waitFor(() => {
      expect(screen.getByText("John Doe")).toBeInTheDocument();
    });

    // Select the result via mouseDown (simulates click before blur)
    fireEvent.mouseDown(screen.getByTestId("links-object-dn"));

    await waitFor(() => {
      expect(screen.getAllByTestId("gpo-row").length).toBe(1);
    });

    // Should show the formatted DN path
    expect(screen.getByText(/Showing GPOs for:/)).toBeInTheDocument();
  });

  it("shows empty GPO table when links result has zero links", async () => {
    const mockLinksResult = {
      objectDn: "OU=HR,DC=contoso,DC=com",
      links: [],
      blocksInheritance: false,
    };

    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_gpo_list") return Promise.resolve([]);
      if (cmd === "get_ou_tree")
        return Promise.resolve([
          { distinguishedName: "OU=HR,DC=contoso,DC=com", name: "HR", children: [], hasChildren: false },
        ]);
      if (cmd === "get_gpo_links") return Promise.resolve(mockLinksResult);
      return Promise.resolve(null);
    });

    render(<GpoViewer />);

    await waitFor(() => {
      const select = screen.getByRole("combobox");
      expect(select).toBeInTheDocument();
    });

    // Select an OU from the dropdown
    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "OU=HR,DC=contoso,DC=com" } });

    await waitFor(() => {
      expect(screen.getByText("No GPOs linked")).toBeInTheDocument();
    });
  });

  it("shows blocks inheritance warning when blocksInheritance is true", async () => {
    const mockLinksResult = {
      objectDn: "OU=HR,DC=contoso,DC=com",
      links: [
        {
          gpoDn: "CN={CCC}",
          gpoName: "HR Policy",
          linkOrder: 1,
          isEnforced: true,
          isDisabled: false,
          linkedAt: "OU=HR,DC=contoso,DC=com",
          isInherited: false,
          wmiFilter: "WMI-Filter-1",
        },
      ],
      blocksInheritance: true,
    };

    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_gpo_list") return Promise.resolve([]);
      if (cmd === "get_ou_tree")
        return Promise.resolve([
          { distinguishedName: "OU=HR,DC=contoso,DC=com", name: "HR", children: [], hasChildren: false },
        ]);
      if (cmd === "get_gpo_links") return Promise.resolve(mockLinksResult);
      return Promise.resolve(null);
    });

    render(<GpoViewer />);

    await waitFor(() => {
      const select = screen.getByRole("combobox");
      expect(select).toBeInTheDocument();
    });

    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "OU=HR,DC=contoso,DC=com" } });

    await waitFor(() => {
      expect(screen.getByText(/blocks Group Policy inheritance/)).toBeInTheDocument();
    });

    // Verify enforced GPO row data
    expect(screen.getByText("HR Policy")).toBeInTheDocument();
    expect(screen.getByText("WMI-Filter-1")).toBeInTheDocument();
    expect(screen.getByText("1 GPO(s) in effective order")).toBeInTheDocument();
  });

  it("shows error banner when links fetch fails", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_gpo_list") return Promise.resolve([]);
      if (cmd === "get_ou_tree")
        return Promise.resolve([
          { distinguishedName: "OU=IT,DC=contoso,DC=com", name: "IT", children: [], hasChildren: false },
        ]);
      if (cmd === "get_gpo_links") return Promise.reject("LDAP connection failed");
      return Promise.resolve(null);
    });

    render(<GpoViewer />);

    await waitFor(() => {
      const select = screen.getByRole("combobox");
      expect(select).toBeInTheDocument();
    });

    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "OU=IT,DC=contoso,DC=com" } });

    await waitFor(() => {
      expect(screen.getByTestId("error-message")).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // Scope view - GPO selection with dropdown + error states
  // -----------------------------------------------------------------------

  it("shows GPO dropdown when gpoList is populated", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_gpo_list")
        return Promise.resolve([
          { dn: "CN={111}", displayName: "Policy A", wmiFilter: null },
          { dn: "CN={222}", displayName: "Policy B", wmiFilter: "WMI-X" },
        ]);
      if (cmd === "get_ou_tree") return Promise.resolve([]);
      return Promise.resolve(null);
    });

    render(<GpoViewer />);
    fireEvent.click(screen.getByTestId("tab-scope"));

    await waitFor(() => {
      expect(screen.getByText("Policy A")).toBeInTheDocument();
      expect(screen.getByText("Policy B [WMI: WMI-X]")).toBeInTheDocument();
    });
  });

  it("scope view auto-fetches on GPO dropdown selection", async () => {
    const mockScopeLinks = [
      {
        gpoDn: "CN={111}",
        gpoName: "Policy A",
        linkOrder: 1,
        isEnforced: false,
        isDisabled: true,
        linkedAt: "OU=Sales,DC=contoso,DC=com",
        isInherited: false,
        wmiFilter: null,
      },
    ];

    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_gpo_list")
        return Promise.resolve([
          { dn: "CN={111}", displayName: "Policy A", wmiFilter: null },
        ]);
      if (cmd === "get_ou_tree") return Promise.resolve([]);
      if (cmd === "get_gpo_scope") return Promise.resolve(mockScopeLinks);
      return Promise.resolve(null);
    });

    render(<GpoViewer />);
    fireEvent.click(screen.getByTestId("tab-scope"));

    await waitFor(() => {
      expect(screen.getByText("Policy A")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId("scope-gpo-dn"), {
      target: { value: "CN={111}" },
    });

    await waitFor(() => {
      expect(screen.getAllByTestId("scope-row").length).toBe(1);
    });

    // Disabled link shows "Disabled" badge
    expect(screen.getByText("Disabled")).toBeInTheDocument();
  });

  it("scope view shows error banner on fetch failure", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_gpo_list") return Promise.resolve([]);
      if (cmd === "get_ou_tree") return Promise.resolve([]);
      if (cmd === "get_gpo_scope") return Promise.reject("Server error");
      return Promise.resolve(null);
    });

    render(<GpoViewer />);
    fireEvent.click(screen.getByTestId("tab-scope"));

    fireEvent.change(screen.getByTestId("scope-gpo-dn"), {
      target: { value: "CN={FAIL}" },
    });
    fireEvent.click(screen.getByTestId("scope-search-button"));

    await waitFor(() => {
      expect(screen.getByTestId("error-message")).toBeInTheDocument();
    });
  });

  it("scope view shows empty state when GPO has no links", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_gpo_list") return Promise.resolve([]);
      if (cmd === "get_ou_tree") return Promise.resolve([]);
      if (cmd === "get_gpo_scope") return Promise.resolve([]);
      return Promise.resolve(null);
    });

    render(<GpoViewer />);
    fireEvent.click(screen.getByTestId("tab-scope"));

    fireEvent.change(screen.getByTestId("scope-gpo-dn"), {
      target: { value: "CN={EMPTY}" },
    });
    fireEvent.click(screen.getByTestId("scope-search-button"));

    await waitFor(() => {
      expect(screen.getByText("No links found")).toBeInTheDocument();
    });
  });

  it("scope search button is disabled when input is empty", () => {
    mockInvoke.mockImplementation(() => Promise.resolve([]));

    render(<GpoViewer />);
    fireEvent.click(screen.getByTestId("tab-scope"));

    const btn = screen.getByTestId("scope-search-button") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Table rendering details
  // -----------------------------------------------------------------------

  it("GpoLinksTable shows inherited vs direct badges correctly", async () => {
    const mockLinksResult = {
      objectDn: "OU=Dev,DC=contoso,DC=com",
      links: [
        {
          gpoDn: "CN={AAA}",
          gpoName: "Direct Policy",
          linkOrder: 1,
          isEnforced: false,
          isDisabled: false,
          linkedAt: "OU=Dev,DC=contoso,DC=com",
          isInherited: false,
          wmiFilter: null,
        },
        {
          gpoDn: "CN={BBB}",
          gpoName: "Inherited Policy",
          linkOrder: 2,
          isEnforced: false,
          isDisabled: false,
          linkedAt: "DC=contoso,DC=com",
          isInherited: true,
          wmiFilter: null,
        },
      ],
      blocksInheritance: false,
    };

    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_gpo_list") return Promise.resolve([]);
      if (cmd === "get_ou_tree")
        return Promise.resolve([
          { distinguishedName: "OU=Dev,DC=contoso,DC=com", name: "Dev", children: [], hasChildren: false },
        ]);
      if (cmd === "get_gpo_links") return Promise.resolve(mockLinksResult);
      return Promise.resolve(null);
    });

    render(<GpoViewer />);

    await waitFor(() => {
      const select = screen.getByRole("combobox");
      expect(select).toBeInTheDocument();
    });

    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "OU=Dev,DC=contoso,DC=com" } });

    await waitFor(() => {
      expect(screen.getAllByTestId("gpo-row").length).toBe(2);
    });

    expect(screen.getByText("Direct")).toBeInTheDocument();
    // "Inherited" appears both as a table header and as a badge
    expect(screen.getAllByText("Inherited").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("2 GPO(s) in effective order")).toBeInTheDocument();
  });

  it("scope table shows Enforced and Active badges", async () => {
    const mockScopeLinks = [
      {
        gpoDn: "CN={111}",
        gpoName: "",
        linkOrder: 1,
        isEnforced: true,
        isDisabled: false,
        linkedAt: "OU=Sales,DC=contoso,DC=com",
        isInherited: false,
        wmiFilter: null,
      },
    ];

    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_gpo_list") return Promise.resolve([]);
      if (cmd === "get_ou_tree") return Promise.resolve([]);
      if (cmd === "get_gpo_scope") return Promise.resolve(mockScopeLinks);
      return Promise.resolve(null);
    });

    render(<GpoViewer />);
    fireEvent.click(screen.getByTestId("tab-scope"));

    fireEvent.change(screen.getByTestId("scope-gpo-dn"), {
      target: { value: "CN={111}" },
    });
    fireEvent.click(screen.getByTestId("scope-search-button"));

    await waitFor(() => {
      // "Enforced" appears as both table header and badge
      expect(screen.getAllByText("Enforced").length).toBeGreaterThanOrEqual(2);
      expect(screen.getByText("Active")).toBeInTheDocument();
      expect(screen.getByText("Linked to 1 container(s)")).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // OU tree flattening
  // -----------------------------------------------------------------------

  it("renders nested OU tree in the dropdown", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_gpo_list") return Promise.resolve([]);
      if (cmd === "get_ou_tree")
        return Promise.resolve([
          {
            distinguishedName: "OU=Corp,DC=contoso,DC=com",
            name: "Corp",
            hasChildren: true,
            children: [
              {
                distinguishedName: "OU=IT,OU=Corp,DC=contoso,DC=com",
                name: "IT",
                hasChildren: false,
                children: [],
              },
            ],
          },
        ]);
      return Promise.resolve(null);
    });

    render(<GpoViewer />);

    await waitFor(() => {
      const select = screen.getByRole("combobox");
      // Both the parent and child OU should be in the dropdown
      const options = select.querySelectorAll("option");
      // "Choose OU..." + "Corp" + "IT" = 3
      expect(options.length).toBe(3);
    });
  });

  // -----------------------------------------------------------------------
  // Enter key triggers scope search
  // -----------------------------------------------------------------------

  it("Enter key triggers scope fetch", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_gpo_list") return Promise.resolve([]);
      if (cmd === "get_ou_tree") return Promise.resolve([]);
      if (cmd === "get_gpo_scope") return Promise.resolve([]);
      return Promise.resolve(null);
    });

    render(<GpoViewer />);
    fireEvent.click(screen.getByTestId("tab-scope"));

    const input = screen.getByTestId("scope-gpo-dn");
    fireEvent.change(input, { target: { value: "CN={ENTER}" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("get_gpo_scope", { gpoDn: "CN={ENTER}" });
    });
  });
});
