import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { EscalationPaths } from "./EscalationPaths";
import type { EscalationGraphResult } from "@/types/security";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
const mockInvoke = vi.mocked(invoke);

const mockData: EscalationGraphResult = {
  nodes: [
    {
      dn: "CN=JDoe,OU=Users,DC=example,DC=com",
      displayName: "John Doe",
      nodeType: "User",
      isPrivileged: false,
    },
    {
      dn: "CN=HelpDesk,OU=Groups,DC=example,DC=com",
      displayName: "HelpDesk",
      nodeType: "Group",
      isPrivileged: false,
    },
    {
      dn: "CN=ServerOps,OU=Groups,DC=example,DC=com",
      displayName: "ServerOps",
      nodeType: "Group",
      isPrivileged: false,
    },
    {
      dn: "CN=Domain Admins,OU=Groups,DC=example,DC=com",
      displayName: "Domain Admins",
      nodeType: "Group",
      isPrivileged: true,
    },
  ],
  edges: [
    {
      sourceDn: "CN=JDoe,OU=Users,DC=example,DC=com",
      targetDn: "CN=HelpDesk,OU=Groups,DC=example,DC=com",
      edgeType: "Membership",
    },
    {
      sourceDn: "CN=HelpDesk,OU=Groups,DC=example,DC=com",
      targetDn: "CN=ServerOps,OU=Groups,DC=example,DC=com",
      edgeType: "Ownership",
    },
    {
      sourceDn: "CN=ServerOps,OU=Groups,DC=example,DC=com",
      targetDn: "CN=Domain Admins,OU=Groups,DC=example,DC=com",
      edgeType: "Delegation",
    },
  ],
  criticalPaths: [
    {
      nodes: [
        "CN=JDoe,OU=Users,DC=example,DC=com",
        "CN=HelpDesk,OU=Groups,DC=example,DC=com",
        "CN=ServerOps,OU=Groups,DC=example,DC=com",
        "CN=Domain Admins,OU=Groups,DC=example,DC=com",
      ],
      hopCount: 3,
      isCritical: true,
    },
    {
      nodes: [
        "CN=JDoe,OU=Users,DC=example,DC=com",
        "CN=HelpDesk,OU=Groups,DC=example,DC=com",
      ],
      hopCount: 1,
      isCritical: false,
    },
  ],
  computedAt: "2026-03-23T10:00:00Z",
};

describe("EscalationPaths", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows loading state initially", () => {
    mockInvoke.mockReturnValue(new Promise(() => {}));
    render(<EscalationPaths />);
    expect(screen.getByText("Analyzing group memberships...")).toBeInTheDocument();
  });

  it("calls get_escalation_paths on mount", async () => {
    mockInvoke.mockResolvedValue(mockData);
    render(<EscalationPaths />);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("get_escalation_paths");
    });
  });

  it("renders critical paths after loading", async () => {
    mockInvoke.mockResolvedValue(mockData);
    render(<EscalationPaths />);

    await waitFor(() => {
      expect(screen.getByTestId("critical-paths-panel")).toBeInTheDocument();
    });

    expect(screen.getAllByText("John Doe").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Domain Admins").length).toBeGreaterThan(0);
  });

  it("displays summary counts", async () => {
    mockInvoke.mockResolvedValue(mockData);
    render(<EscalationPaths />);

    await waitFor(() => {
      expect(screen.getByTestId("summary")).toBeInTheDocument();
    });

    expect(screen.getByText("4 nodes")).toBeInTheDocument();
    expect(screen.getByText("3 edges")).toBeInTheDocument();
    expect(screen.getByText(/1 critical path/)).toBeInTheDocument();
  });

  it("displays hop count badges", async () => {
    mockInvoke.mockResolvedValue(mockData);
    render(<EscalationPaths />);

    await waitFor(() => {
      expect(screen.getByTestId("critical-paths-panel")).toBeInTheDocument();
    });

    const hopBadges = screen.getAllByTestId("hop-count");
    expect(hopBadges).toHaveLength(2);
    expect(hopBadges[0]).toHaveTextContent("3 hops");
    expect(hopBadges[1]).toHaveTextContent("1 hop");
  });

  it("marks critical paths with CRITICAL label", async () => {
    mockInvoke.mockResolvedValue(mockData);
    render(<EscalationPaths />);

    await waitFor(() => {
      expect(screen.getByText("CRITICAL")).toBeInTheDocument();
    });
  });

  it("displays graph legend and stats", async () => {
    mockInvoke.mockResolvedValue(mockData);
    render(<EscalationPaths />);

    await waitFor(() => {
      expect(screen.getByTestId("graph-legend")).toBeInTheDocument();
    });

    expect(screen.getByText("Node Types")).toBeInTheDocument();
    expect(screen.getByText("Edge Types")).toBeInTheDocument();
    expect(screen.getByText("Legend")).toBeInTheDocument();
  });

  it("shows node type counts in legend", async () => {
    mockInvoke.mockResolvedValue(mockData);
    render(<EscalationPaths />);

    await waitFor(() => {
      expect(screen.getByTestId("graph-legend")).toBeInTheDocument();
    });

    // 1 user, 2 non-privileged groups, 1 privileged group
    expect(screen.getByText("Users")).toBeInTheDocument();
    expect(screen.getByText("Groups")).toBeInTheDocument();
    expect(screen.getByText("Privileged Groups")).toBeInTheDocument();
  });

  it("shows edges table", async () => {
    mockInvoke.mockResolvedValue(mockData);
    render(<EscalationPaths />);

    await waitFor(() => {
      expect(screen.getByTestId("edges-table")).toBeInTheDocument();
    });

    expect(screen.getAllByText("Membership").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Ownership").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Delegation").length).toBeGreaterThan(0);
  });

  it("shows error state on failure", async () => {
    mockInvoke.mockRejectedValue("Connection failed");
    render(<EscalationPaths />);

    await waitFor(() => {
      expect(screen.getByText("Analysis Failed")).toBeInTheDocument();
    });
  });

  it("shows empty state when no data", async () => {
    mockInvoke.mockResolvedValue({
      nodes: [],
      edges: [],
      criticalPaths: [],
      computedAt: "2026-03-23T10:00:00Z",
    });
    render(<EscalationPaths />);

    await waitFor(() => {
      expect(screen.getByText("No Escalation Paths Found")).toBeInTheDocument();
    });
  });

  it("calls refresh on button click", async () => {
    mockInvoke.mockResolvedValue(mockData);
    render(<EscalationPaths />);

    await waitFor(() => {
      expect(screen.getByTestId("refresh-button")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("refresh-button"));
    expect(mockInvoke).toHaveBeenCalledTimes(2);
  });

  it("sorts paths with critical first, then by hop count", async () => {
    mockInvoke.mockResolvedValue(mockData);
    render(<EscalationPaths />);

    await waitFor(() => {
      expect(screen.getByTestId("critical-paths-panel")).toBeInTheDocument();
    });

    const hopBadges = screen.getAllByTestId("hop-count");
    // Critical path (3 hops) should come before non-critical (1 hop)
    expect(hopBadges[0]).toHaveTextContent("3 hops");
    expect(hopBadges[1]).toHaveTextContent("1 hop");
  });
});
