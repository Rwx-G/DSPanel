import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  MemberChangePreviewDialog,
  type MemberChange,
} from "./MemberChangePreviewDialog";

const mockChanges: MemberChange[] = [
  {
    memberDn: "CN=John Doe,OU=Users,OU=Corp,DC=example,DC=com",
    memberName: "John Doe",
    action: "add",
  },
  {
    memberDn: "CN=Alice Smith,OU=Users,OU=Corp,DC=example,DC=com",
    memberName: "Alice Smith",
    action: "remove",
  },
  {
    memberDn: "CN=Bob Wilson,OU=Users,OU=Corp,DC=example,DC=com",
    memberName: "Bob Wilson",
    action: "add",
  },
];

describe("MemberChangePreviewDialog", () => {
  it("renders with correct summary counts", () => {
    render(
      <MemberChangePreviewDialog
        open={true}
        changes={mockChanges}
        groupName="Developers"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByTestId("member-change-preview")).toBeInTheDocument();
    expect(screen.getByTestId("member-change-summary")).toHaveTextContent(
      "2 members to add, 1 member to remove",
    );
  });

  it("lists all pending changes with correct icons", () => {
    render(
      <MemberChangePreviewDialog
        open={true}
        changes={mockChanges}
        groupName="Developers"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByTestId("member-change-0")).toBeInTheDocument();
    expect(screen.getByTestId("member-change-1")).toBeInTheDocument();
    expect(screen.getByTestId("member-change-2")).toBeInTheDocument();

    expect(screen.getByText("John Doe")).toBeInTheDocument();
    expect(screen.getByText("Alice Smith")).toBeInTheDocument();
    expect(screen.getByText("Bob Wilson")).toBeInTheDocument();
  });

  it("calls onConfirm when Apply clicked", () => {
    const onConfirm = vi.fn();
    render(
      <MemberChangePreviewDialog
        open={true}
        changes={mockChanges}
        groupName="Developers"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId("member-change-apply"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("calls onCancel when Cancel clicked", () => {
    const onCancel = vi.fn();
    render(
      <MemberChangePreviewDialog
        open={true}
        changes={mockChanges}
        groupName="Developers"
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );

    fireEvent.click(screen.getByTestId("member-change-cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("shows loading state when loading=true", () => {
    render(
      <MemberChangePreviewDialog
        open={true}
        changes={mockChanges}
        groupName="Developers"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        loading={true}
      />,
    );

    expect(screen.getByTestId("member-change-apply")).toHaveTextContent(
      "Applying...",
    );
  });

  it("disables Apply button when loading", () => {
    render(
      <MemberChangePreviewDialog
        open={true}
        changes={mockChanges}
        groupName="Developers"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        loading={true}
      />,
    );

    expect(screen.getByTestId("member-change-apply")).toBeDisabled();
    expect(screen.getByTestId("member-change-cancel")).toBeDisabled();
  });

  it("does not render when open=false", () => {
    render(
      <MemberChangePreviewDialog
        open={false}
        changes={mockChanges}
        groupName="Developers"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(
      screen.queryByTestId("member-change-preview"),
    ).not.toBeInTheDocument();
  });

  it("shows group name in title", () => {
    render(
      <MemberChangePreviewDialog
        open={true}
        changes={mockChanges}
        groupName="Developers"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByTestId("member-change-title")).toHaveTextContent(
      "Member Changes - Developers",
    );
  });
});
