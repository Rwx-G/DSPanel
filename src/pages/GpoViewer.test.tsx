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

  it("shows links input and search button", () => {
    render(<GpoViewer />);
    expect(screen.getByTestId("links-object-dn")).toBeInTheDocument();
    expect(screen.getByTestId("links-search-button")).toBeInTheDocument();
  });

  it("fetches and displays GPO links", async () => {
    mockInvoke.mockResolvedValue(mockGpoLinksResult);
    render(<GpoViewer />);

    fireEvent.change(screen.getByTestId("links-object-dn"), {
      target: { value: "CN=John,OU=Users,DC=contoso,DC=com" },
    });
    fireEvent.click(screen.getByTestId("links-search-button"));

    await waitFor(() => {
      expect(screen.getAllByTestId("gpo-row").length).toBe(2);
    });
    expect(screen.getByText("Default Domain Policy")).toBeInTheDocument();
    expect(screen.getByText("Users GPO")).toBeInTheDocument();
  });

  it("shows error on failure", async () => {
    mockInvoke.mockRejectedValue("Permission denied");
    render(<GpoViewer />);

    fireEvent.change(screen.getByTestId("links-object-dn"), {
      target: { value: "CN=Test" },
    });
    fireEvent.click(screen.getByTestId("links-search-button"));

    await waitFor(() => {
      expect(screen.getByTestId("error-message")).toBeInTheDocument();
    });
  });

  it("switches to scope view", () => {
    render(<GpoViewer />);
    fireEvent.click(screen.getByTestId("tab-scope"));
    expect(screen.getByTestId("scope-gpo-dn")).toBeInTheDocument();
    expect(screen.getByTestId("scope-search-button")).toBeInTheDocument();
  });

  it("switches to what-if view", () => {
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
      },
      {
        gpoDn: "CN={AAA}",
        gpoName: "",
        linkOrder: 1,
        isEnforced: true,
        isDisabled: false,
        linkedAt: "OU=Finance,DC=contoso,DC=com",
        isInherited: false,
      },
    ];
    mockInvoke.mockResolvedValue(mockScopeResult);

    render(<GpoViewer />);
    fireEvent.click(screen.getByTestId("tab-scope"));

    fireEvent.change(screen.getByTestId("scope-gpo-dn"), {
      target: { value: "CN={AAA}" },
    });
    fireEvent.click(screen.getByTestId("scope-search-button"));

    await waitFor(() => {
      expect(screen.getAllByTestId("scope-row").length).toBe(2);
    });
  });
});
