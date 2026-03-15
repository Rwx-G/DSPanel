import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { HomePage } from "./HomePage";
import { type AppStatus } from "@/App";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@/components/dialogs/MfaSetupDialog", () => ({
  MfaSetupDialog: ({
    onComplete,
    onCancel,
  }: {
    onComplete: () => void;
    onCancel: () => void;
  }) => (
    <div data-testid="mfa-setup-dialog">
      <button data-testid="mfa-complete" onClick={onComplete}>
        Complete
      </button>
      <button data-testid="mfa-cancel" onClick={onCancel}>
        Cancel
      </button>
    </div>
  ),
}));

import { invoke } from "@tauri-apps/api/core";
const mockInvoke = vi.mocked(invoke);

function makeStatus(overrides: Partial<AppStatus> = {}): AppStatus {
  return {
    isConnected: true,
    domainName: "example.com",
    permissionLevel: "HelpDesk",
    username: "jdoe",
    computerName: "WS001",
    userGroups: ["Domain Users", "Developers"],
    appVersion: "1.0.0",
    ...overrides,
  };
}

describe("HomePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "mfa_is_configured") return Promise.resolve(false);
      if (cmd === "mfa_revoke") return Promise.resolve();
      return Promise.resolve(null);
    }) as typeof invoke);
  });

  it("renders main content container", () => {
    render(<HomePage status={makeStatus()} />);
    expect(screen.getByTestId("main-content")).toBeInTheDocument();
  });

  it("displays Dashboard heading", () => {
    render(<HomePage status={makeStatus()} />);
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
  });

  it("displays app version", () => {
    render(<HomePage status={makeStatus()} />);
    expect(screen.getByText("DSPanel v1.0.0")).toBeInTheDocument();
  });

  it("shows Connected status when connected", () => {
    render(<HomePage status={makeStatus({ isConnected: true })} />);
    expect(screen.getByText("Connected")).toBeInTheDocument();
  });

  it("shows Disconnected status when not connected", () => {
    render(<HomePage status={makeStatus({ isConnected: false })} />);
    expect(screen.getByText("Disconnected")).toBeInTheDocument();
  });

  it("shows domain name", () => {
    render(<HomePage status={makeStatus({ domainName: "corp.local" })} />);
    expect(screen.getByText("corp.local")).toBeInTheDocument();
  });

  it("shows N/A when domain name is null", () => {
    render(<HomePage status={makeStatus({ domainName: null })} />);
    expect(screen.getByText("N/A")).toBeInTheDocument();
  });

  it("displays Active Directory card", () => {
    render(<HomePage status={makeStatus()} />);
    expect(screen.getByText("Active Directory")).toBeInTheDocument();
  });

  it("displays Current Session card with user and computer", () => {
    render(
      <HomePage
        status={makeStatus({ username: "jdoe", computerName: "WS001" })}
      />,
    );
    expect(screen.getByText("Current Session")).toBeInTheDocument();
    expect(screen.getByText("jdoe")).toBeInTheDocument();
    expect(screen.getByText("WS001")).toBeInTheDocument();
  });

  it("displays Permissions card with correct level", () => {
    render(
      <HomePage status={makeStatus({ permissionLevel: "DomainAdmin" })} />,
    );
    expect(screen.getByText("Permissions")).toBeInTheDocument();
    expect(screen.getByText("Domain Admin")).toBeInTheDocument();
  });

  it("displays Environment card with version", () => {
    render(<HomePage status={makeStatus()} />);
    expect(screen.getByText("Environment")).toBeInTheDocument();
    expect(screen.getByText("v1.0.0")).toBeInTheDocument();
    expect(screen.getByText("Windows (Tauri v2)")).toBeInTheDocument();
  });

  it("displays MFA Security card", () => {
    render(<HomePage status={makeStatus()} />);
    expect(screen.getByText("MFA Security")).toBeInTheDocument();
  });

  it("shows Setup MFA button when MFA is not configured", async () => {
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "mfa_is_configured") return Promise.resolve(false);
      return Promise.resolve(null);
    }) as typeof invoke);

    render(<HomePage status={makeStatus()} />);
    await waitFor(() => {
      expect(screen.getByTestId("mfa-setup-btn")).toBeInTheDocument();
    });
  });

  it("shows Revoke MFA button when MFA is configured", async () => {
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "mfa_is_configured") return Promise.resolve(true);
      return Promise.resolve(null);
    }) as typeof invoke);

    render(<HomePage status={makeStatus()} />);
    await waitFor(() => {
      expect(screen.getByTestId("mfa-revoke-btn")).toBeInTheDocument();
    });
  });

  it("opens MFA setup dialog when Setup MFA is clicked", async () => {
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "mfa_is_configured") return Promise.resolve(false);
      return Promise.resolve(null);
    }) as typeof invoke);

    render(<HomePage status={makeStatus()} />);
    await waitFor(() => {
      expect(screen.getByTestId("mfa-setup-btn")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("mfa-setup-btn"));
    expect(screen.getByTestId("mfa-setup-dialog")).toBeInTheDocument();
  });

  it("closes MFA setup dialog and refreshes on complete", async () => {
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "mfa_is_configured") return Promise.resolve(false);
      return Promise.resolve(null);
    }) as typeof invoke);

    render(<HomePage status={makeStatus()} />);
    await waitFor(() => {
      expect(screen.getByTestId("mfa-setup-btn")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("mfa-setup-btn"));
    fireEvent.click(screen.getByTestId("mfa-complete"));

    await waitFor(() => {
      expect(screen.queryByTestId("mfa-setup-dialog")).not.toBeInTheDocument();
    });
  });

  it("closes MFA setup dialog on cancel", async () => {
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "mfa_is_configured") return Promise.resolve(false);
      return Promise.resolve(null);
    }) as typeof invoke);

    render(<HomePage status={makeStatus()} />);
    await waitFor(() => {
      expect(screen.getByTestId("mfa-setup-btn")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("mfa-setup-btn"));
    fireEvent.click(screen.getByTestId("mfa-cancel"));

    await waitFor(() => {
      expect(screen.queryByTestId("mfa-setup-dialog")).not.toBeInTheDocument();
    });
  });

  it("calls mfa_revoke when Revoke MFA is clicked", async () => {
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "mfa_is_configured") return Promise.resolve(true);
      if (cmd === "mfa_revoke") return Promise.resolve();
      return Promise.resolve(null);
    }) as typeof invoke);

    render(<HomePage status={makeStatus()} />);
    await waitFor(() => {
      expect(screen.getByTestId("mfa-revoke-btn")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("mfa-revoke-btn"));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("mfa_revoke");
    });
  });

  it("displays user groups when present", () => {
    render(
      <HomePage
        status={makeStatus({ userGroups: ["Domain Users", "Developers"] })}
      />,
    );
    expect(screen.getByText("AD Group Memberships")).toBeInTheDocument();
    expect(screen.getByText("Domain Users")).toBeInTheDocument();
    expect(screen.getByText("Developers")).toBeInTheDocument();
  });

  it("does not display groups section when userGroups is empty", () => {
    render(<HomePage status={makeStatus({ userGroups: [] })} />);
    expect(screen.queryByText("AD Group Memberships")).not.toBeInTheDocument();
  });

  it("shows disconnected hint when not connected", () => {
    render(<HomePage status={makeStatus({ isConnected: false })} />);
    expect(
      screen.getByText(/Not connected to Active Directory/),
    ).toBeInTheDocument();
  });

  it("does not show disconnected hint when connected", () => {
    render(<HomePage status={makeStatus({ isConnected: true })} />);
    expect(
      screen.queryByText(/Not connected to Active Directory/),
    ).not.toBeInTheDocument();
  });

  it("displays permission levels correctly for all types", () => {
    const { rerender } = render(
      <HomePage status={makeStatus({ permissionLevel: "ReadOnly" })} />,
    );
    expect(screen.getByText("Read Only")).toBeInTheDocument();

    rerender(
      <HomePage status={makeStatus({ permissionLevel: "AccountOperator" })} />,
    );
    expect(screen.getByText("Account Operator")).toBeInTheDocument();
  });

  it("falls back to Read Only for unknown permission level", () => {
    render(
      <HomePage status={makeStatus({ permissionLevel: "UnknownLevel" })} />,
    );
    expect(screen.getByText("Read Only")).toBeInTheDocument();
  });

  it("shows domain joined as Yes when domain is present", () => {
    render(<HomePage status={makeStatus({ domainName: "corp.local" })} />);
    expect(screen.getByText("Yes")).toBeInTheDocument();
  });

  it("shows domain joined as No when domain is null", () => {
    render(<HomePage status={makeStatus({ domainName: null })} />);
    expect(screen.getByText("No")).toBeInTheDocument();
  });

  it("handles mfa_is_configured error gracefully", async () => {
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "mfa_is_configured")
        return Promise.reject(new Error("MFA check failed"));
      return Promise.resolve(null);
    }) as typeof invoke);

    render(<HomePage status={makeStatus()} />);
    // Should fall back to not configured
    await waitFor(() => {
      expect(screen.getByTestId("mfa-setup-btn")).toBeInTheDocument();
    });
  });
});
