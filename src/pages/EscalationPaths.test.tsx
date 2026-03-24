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
    {
      dn: "CN=SRV01,OU=Servers,DC=example,DC=com",
      displayName: "SRV01",
      nodeType: "Computer",
      isPrivileged: false,
    },
  ],
  edges: [
    {
      sourceDn: "CN=JDoe,OU=Users,DC=example,DC=com",
      targetDn: "CN=HelpDesk,OU=Groups,DC=example,DC=com",
      edgeType: "Membership",
      label: "Member of",
    },
    {
      sourceDn: "CN=HelpDesk,OU=Groups,DC=example,DC=com",
      targetDn: "CN=ServerOps,OU=Groups,DC=example,DC=com",
      edgeType: "Ownership",
      label: "Manages group",
    },
    {
      sourceDn: "CN=ServerOps,OU=Groups,DC=example,DC=com",
      targetDn: "CN=Domain Admins,OU=Groups,DC=example,DC=com",
      edgeType: "Delegation",
      label: "Constrained delegation to CIFS/DC1",
    },
    {
      sourceDn: "CN=SRV01,OU=Servers,DC=example,DC=com",
      targetDn: "CN=Domain Admins,OU=Groups,DC=example,DC=com",
      edgeType: "UnconstrainedDeleg",
      label: "Unconstrained delegation",
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
      riskScore: 4.5,
      edgeTypes: ["Member of", "Manages group", "Constrained delegation to CIFS/DC1"],
    },
    {
      nodes: [
        "CN=JDoe,OU=Users,DC=example,DC=com",
        "CN=HelpDesk,OU=Groups,DC=example,DC=com",
      ],
      hopCount: 1,
      isCritical: false,
      riskScore: 1.0,
      edgeTypes: ["Member of"],
    },
    {
      nodes: [
        "CN=SRV01,OU=Servers,DC=example,DC=com",
        "CN=Domain Admins,OU=Groups,DC=example,DC=com",
      ],
      hopCount: 1,
      isCritical: true,
      riskScore: 2.5,
      edgeTypes: ["Unconstrained delegation"],
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

    expect(screen.getByText("5 nodes")).toBeInTheDocument();
    expect(screen.getByText("4 edges")).toBeInTheDocument();
    expect(screen.getByText(/2 critical path/)).toBeInTheDocument();
  });

  it("displays hop count badges", async () => {
    mockInvoke.mockResolvedValue(mockData);
    render(<EscalationPaths />);

    await waitFor(() => {
      expect(screen.getByTestId("critical-paths-panel")).toBeInTheDocument();
    });

    const hopBadges = screen.getAllByTestId("hop-count");
    expect(hopBadges).toHaveLength(3);
  });

  it("displays risk score badges", async () => {
    mockInvoke.mockResolvedValue(mockData);
    render(<EscalationPaths />);

    await waitFor(() => {
      expect(screen.getByTestId("critical-paths-panel")).toBeInTheDocument();
    });

    const riskBadges = screen.getAllByTestId("risk-score");
    expect(riskBadges).toHaveLength(3);
    // Check that risk scores are displayed
    expect(riskBadges[0]).toHaveTextContent("risk");
  });

  it("shows edge type labels between nodes in paths", async () => {
    mockInvoke.mockResolvedValue(mockData);
    render(<EscalationPaths />);

    await waitFor(() => {
      expect(screen.getByTestId("critical-paths-panel")).toBeInTheDocument();
    });

    // Edge labels should appear in the path display
    expect(screen.getAllByText(/\[Member of\]/).length).toBeGreaterThan(0);
  });

  it("marks critical paths with CRITICAL label", async () => {
    mockInvoke.mockResolvedValue(mockData);
    render(<EscalationPaths />);

    await waitFor(() => {
      expect(screen.getAllByText("CRITICAL").length).toBeGreaterThan(0);
    });
  });

  it("displays graph legend stats bar", async () => {
    mockInvoke.mockResolvedValue(mockData);
    render(<EscalationPaths />);

    await waitFor(() => {
      expect(screen.getByTestId("graph-legend")).toBeInTheDocument();
    });

    expect(screen.getByText("Nodes:")).toBeInTheDocument();
    expect(screen.getByText("Edges:")).toBeInTheDocument();
  });

  it("shows node type counts in compact legend", async () => {
    mockInvoke.mockResolvedValue(mockData);
    render(<EscalationPaths />);

    await waitFor(() => {
      expect(screen.getByTestId("graph-legend")).toBeInTheDocument();
    });

    expect(screen.getByText(/users/)).toBeInTheDocument();
    expect(screen.getByText(/privileged/)).toBeInTheDocument();
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

  it("sorts paths with critical first, then by risk score", async () => {
    mockInvoke.mockResolvedValue(mockData);
    render(<EscalationPaths />);

    await waitFor(() => {
      expect(screen.getByTestId("critical-paths-panel")).toBeInTheDocument();
    });

    const riskBadges = screen.getAllByTestId("risk-score");
    // Critical paths should come first (sorted by risk score ascending)
    // SRV01 path (2.5 risk, critical) before JDoe path (4.5 risk, critical)
    // then non-critical JDoe-HelpDesk (1.0 risk)
    expect(riskBadges[0]).toHaveTextContent("2.5");
    expect(riskBadges[1]).toHaveTextContent("4.5");
    expect(riskBadges[2]).toHaveTextContent("1.0");
  });
});
