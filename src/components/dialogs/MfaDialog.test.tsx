import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MfaDialog } from "./MfaDialog";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
const mockInvoke = vi.mocked(invoke);

describe("MfaDialog", () => {
  const onVerified = vi.fn();
  const onCancel = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders dialog with code input", () => {
    render(<MfaDialog onVerified={onVerified} onCancel={onCancel} />);
    expect(screen.getByTestId("mfa-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("mfa-code-input")).toBeInTheDocument();
    expect(screen.getByText("MFA Verification Required")).toBeInTheDocument();
  });

  it("auto-focuses code input", () => {
    render(<MfaDialog onVerified={onVerified} onCancel={onCancel} />);
    expect(screen.getByTestId("mfa-code-input")).toHaveFocus();
  });

  it("only accepts numeric input", () => {
    render(<MfaDialog onVerified={onVerified} onCancel={onCancel} />);
    const input = screen.getByTestId("mfa-code-input");
    fireEvent.change(input, { target: { value: "abc123" } });
    expect(input).toHaveValue("123");
  });

  it("disables verify button when code is too short", () => {
    render(<MfaDialog onVerified={onVerified} onCancel={onCancel} />);
    const input = screen.getByTestId("mfa-code-input");
    fireEvent.change(input, { target: { value: "123" } });
    expect(screen.getByTestId("mfa-verify")).toBeDisabled();
  });

  it("enables verify button with 6+ digit code", () => {
    render(<MfaDialog onVerified={onVerified} onCancel={onCancel} />);
    const input = screen.getByTestId("mfa-code-input");
    fireEvent.change(input, { target: { value: "123456" } });
    expect(screen.getByTestId("mfa-verify")).not.toBeDisabled();
  });

  it("calls mfa_verify on verify click", async () => {
    mockInvoke.mockResolvedValueOnce(true as never);

    render(<MfaDialog onVerified={onVerified} onCancel={onCancel} />);
    const input = screen.getByTestId("mfa-code-input");
    fireEvent.change(input, { target: { value: "123456" } });
    fireEvent.click(screen.getByTestId("mfa-verify"));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("mfa_verify", { code: "123456" });
    });
  });

  it("calls onVerified when code is valid", async () => {
    mockInvoke.mockResolvedValueOnce(true as never);

    render(<MfaDialog onVerified={onVerified} onCancel={onCancel} />);
    const input = screen.getByTestId("mfa-code-input");
    fireEvent.change(input, { target: { value: "123456" } });
    fireEvent.click(screen.getByTestId("mfa-verify"));

    await waitFor(() => {
      expect(onVerified).toHaveBeenCalled();
    });
  });

  it("shows error on invalid code", async () => {
    mockInvoke.mockResolvedValueOnce(false as never);

    render(<MfaDialog onVerified={onVerified} onCancel={onCancel} />);
    const input = screen.getByTestId("mfa-code-input");
    fireEvent.change(input, { target: { value: "000000" } });
    fireEvent.click(screen.getByTestId("mfa-verify"));

    await waitFor(() => {
      expect(screen.getByTestId("mfa-error")).toBeInTheDocument();
    });

    expect(screen.getByTestId("mfa-error")).toHaveTextContent("Invalid code");
    expect(onVerified).not.toHaveBeenCalled();
  });

  it("calls onCancel when cancel is clicked", () => {
    render(<MfaDialog onVerified={onVerified} onCancel={onCancel} />);
    fireEvent.click(screen.getByTestId("mfa-cancel"));
    expect(onCancel).toHaveBeenCalled();
  });

  it("supports backup codes (8 digits)", () => {
    render(<MfaDialog onVerified={onVerified} onCancel={onCancel} />);
    const input = screen.getByTestId("mfa-code-input");
    fireEvent.change(input, { target: { value: "12345678" } });
    expect(input).toHaveValue("12345678");
    expect(screen.getByTestId("mfa-verify")).not.toBeDisabled();
  });
});
