import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { GpoViewer } from "./GpoViewer";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
const mockInvoke = vi.mocked(invoke);

const mockGpoLinksResult = {
  objectDn: "CN=John,OU=Users,DC=contoso,DC=com",
  links: [
    {
      gpoDn: "CN={AAA},CN=Policies,CN=System,DC=contoso,DC=com",
      gpoName: "Default Domain Policy",
      linkOrder: 1,
      isEnforced: true,
      isDisabled: false,
      linkedAt: "DC=contoso,DC=com",
      isInherited: true,
    },
    {
      gpoDn: "CN={BBB},CN=Policies,CN=System,DC=contoso,DC=com",
      gpoName: "Users GPO",
      linkOrder: 1,
      isEnforced: false,
      isDisabled: false,
      linkedAt: "OU=Users,DC=contoso,DC=com",
      isInherited: false,
    },
  ],
  blocksInheritance: false,
};

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
    expect(screen.getByTestId("tab-whatif")).toBeInTheDocument();
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

  it("switches to what-if view with OU dropdown", () => {
    render(<GpoViewer />);
    fireEvent.click(screen.getByTestId("tab-whatif"));
    expect(screen.getByTestId("whatif-ou-dn")).toBeInTheDocument();
    expect(screen.getByTestId("whatif-simulate-button")).toBeInTheDocument();
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
});
