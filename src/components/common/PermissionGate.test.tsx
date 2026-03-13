import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PermissionGate } from "./PermissionGate";

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: vi.fn(),
}));

import { usePermissions } from "@/hooks/usePermissions";
const mockedUsePermissions = vi.mocked(usePermissions);

describe("PermissionGate", () => {
  it("should render children when permission is sufficient", () => {
    mockedUsePermissions.mockReturnValue({
      level: "DomainAdmin",
      groups: [],
      loading: false,
      hasPermission: () => true,
    });

    render(
      <PermissionGate requiredLevel="HelpDesk">
        <div data-testid="protected">Secret</div>
      </PermissionGate>,
    );

    expect(screen.getByTestId("protected")).toBeInTheDocument();
  });

  it("should not render children when permission is insufficient", () => {
    mockedUsePermissions.mockReturnValue({
      level: "ReadOnly",
      groups: [],
      loading: false,
      hasPermission: () => false,
    });

    render(
      <PermissionGate requiredLevel="HelpDesk">
        <div data-testid="protected">Secret</div>
      </PermissionGate>,
    );

    expect(screen.queryByTestId("protected")).not.toBeInTheDocument();
  });

  it("should render fallback when permission is insufficient", () => {
    mockedUsePermissions.mockReturnValue({
      level: "ReadOnly",
      groups: [],
      loading: false,
      hasPermission: () => false,
    });

    render(
      <PermissionGate
        requiredLevel="HelpDesk"
        fallback={<div data-testid="fallback">No access</div>}
      >
        <div data-testid="protected">Secret</div>
      </PermissionGate>,
    );

    expect(screen.queryByTestId("protected")).not.toBeInTheDocument();
    expect(screen.getByTestId("fallback")).toBeInTheDocument();
  });

  it("should render nothing by default when fallback is not provided", () => {
    mockedUsePermissions.mockReturnValue({
      level: "ReadOnly",
      groups: [],
      loading: false,
      hasPermission: () => false,
    });

    const { container } = render(
      <PermissionGate requiredLevel="DomainAdmin">
        <div>Visible only to admins</div>
      </PermissionGate>,
    );

    expect(container.innerHTML).toBe("");
  });

  it("should allow exact level match", () => {
    mockedUsePermissions.mockReturnValue({
      level: "HelpDesk",
      groups: [],
      loading: false,
      hasPermission: () => true,
    });

    render(
      <PermissionGate requiredLevel="HelpDesk">
        <div data-testid="protected">Content</div>
      </PermissionGate>,
    );

    expect(screen.getByTestId("protected")).toBeInTheDocument();
  });
});
