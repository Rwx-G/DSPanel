import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MfaSetupDialog } from "./MfaSetupDialog";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
const mockInvoke = vi.mocked(invoke);

describe("MfaSetupDialog", () => {
  const onComplete = vi.fn();
  const onCancel = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function renderDialog() {
    return render(
      <MfaSetupDialog onComplete={onComplete} onCancel={onCancel} />,
    );
  }

  // --- Init step ---

  it("renders init step by default", () => {
    renderDialog();
    expect(screen.getByTestId("mfa-setup-dialog")).toBeInTheDocument();
    expect(screen.getByText("Set Up MFA")).toBeInTheDocument();
    expect(screen.getByTestId("setup-begin")).toBeInTheDocument();
  });

  it("shows description text on init step", () => {
    renderDialog();
    expect(screen.getByText(/authenticator app/)).toBeInTheDocument();
  });

  it("calls onCancel when cancel is clicked on init step", () => {
    renderDialog();
    fireEvent.click(screen.getByTestId("setup-cancel"));
    expect(onCancel).toHaveBeenCalled();
  });

  it("calls mfa_setup when begin setup is clicked", async () => {
    mockInvoke.mockResolvedValueOnce({
      secretBase32: "JBSWY3DPEHPK3PXP",
      qrUri: "otpauth://totp/DSPanel:test?secret=JBSWY3DPEHPK3PXP",
      backupCodes: [
        "11111111",
        "22222222",
        "33333333",
        "44444444",
        "55555555",
        "66666666",
        "77777777",
        "88888888",
        "99999999",
        "00000000",
      ],
    } as never);

    renderDialog();
    fireEvent.click(screen.getByTestId("setup-begin"));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("mfa_setup");
    });
  });

  it("shows error when mfa_setup fails with string", async () => {
    mockInvoke.mockRejectedValueOnce("Setup error" as never);

    renderDialog();
    fireEvent.click(screen.getByTestId("setup-begin"));

    await waitFor(() => {
      expect(screen.getByTestId("setup-error")).toHaveTextContent(
        "Setup error",
      );
    });
  });

  it("shows generic error when mfa_setup fails with non-string", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("fail") as never);

    renderDialog();
    fireEvent.click(screen.getByTestId("setup-begin"));

    await waitFor(() => {
      expect(screen.getByTestId("setup-error")).toHaveTextContent(
        "Failed to set up MFA",
      );
    });
  });

  // --- Verify step ---

  async function goToVerifyStep() {
    mockInvoke.mockResolvedValueOnce({
      secretBase32: "JBSWY3DPEHPK3PXP",
      qrUri: "otpauth://totp/DSPanel:test?secret=JBSWY3DPEHPK3PXP",
      backupCodes: [
        "11111111",
        "22222222",
        "33333333",
        "44444444",
        "55555555",
        "66666666",
        "77777777",
        "88888888",
        "99999999",
        "00000000",
      ],
    } as never);

    renderDialog();
    fireEvent.click(screen.getByTestId("setup-begin"));

    await waitFor(() => {
      expect(screen.getByTestId("mfa-setup-verify")).toBeInTheDocument();
    });
  }

  it("transitions to verify step after successful setup", async () => {
    await goToVerifyStep();
    expect(screen.getByText("Step 1: Scan QR Code")).toBeInTheDocument();
  });

  it("displays QR code image on verify step", async () => {
    await goToVerifyStep();
    expect(screen.getByTestId("qr-image")).toBeInTheDocument();
  });

  it("displays secret key on verify step", async () => {
    await goToVerifyStep();
    expect(screen.getByTestId("secret-display")).toHaveTextContent(
      "JBSWY3DPEHPK3PXP",
    );
  });

  it("has verify code input on verify step", async () => {
    await goToVerifyStep();
    const input = screen.getByTestId("verify-code-input");
    expect(input).toBeInTheDocument();
  });

  it("only accepts numeric input on verify step", async () => {
    await goToVerifyStep();
    const input = screen.getByTestId("verify-code-input");
    fireEvent.change(input, { target: { value: "abc123" } });
    expect(input).toHaveValue("123");
  });

  it("disables verify button when code is too short", async () => {
    await goToVerifyStep();
    const input = screen.getByTestId("verify-code-input");
    fireEvent.change(input, { target: { value: "123" } });
    expect(screen.getByTestId("verify-btn")).toBeDisabled();
  });

  it("enables verify button with 6-digit code", async () => {
    await goToVerifyStep();
    const input = screen.getByTestId("verify-code-input");
    fireEvent.change(input, { target: { value: "123456" } });
    expect(screen.getByTestId("verify-btn")).not.toBeDisabled();
  });

  it("calls mfa_verify when verify is clicked", async () => {
    await goToVerifyStep();
    mockInvoke.mockResolvedValueOnce(true as never);

    const input = screen.getByTestId("verify-code-input");
    fireEvent.change(input, { target: { value: "123456" } });
    fireEvent.click(screen.getByTestId("verify-btn"));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("mfa_verify", { code: "123456" });
    });
  });

  it("shows error on invalid verification code", async () => {
    await goToVerifyStep();
    mockInvoke.mockResolvedValueOnce(false as never);

    const input = screen.getByTestId("verify-code-input");
    fireEvent.change(input, { target: { value: "000000" } });
    fireEvent.click(screen.getByTestId("verify-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("verify-error")).toHaveTextContent(
        "Invalid code",
      );
    });
  });

  it("clears code input after invalid verification", async () => {
    await goToVerifyStep();
    mockInvoke.mockResolvedValueOnce(false as never);

    const input = screen.getByTestId("verify-code-input");
    fireEvent.change(input, { target: { value: "000000" } });
    fireEvent.click(screen.getByTestId("verify-btn"));

    await waitFor(() => {
      expect(input).toHaveValue("");
    });
  });

  it("shows error when mfa_verify rejects with string", async () => {
    await goToVerifyStep();
    mockInvoke.mockRejectedValueOnce("Too many attempts" as never);

    const input = screen.getByTestId("verify-code-input");
    fireEvent.change(input, { target: { value: "123456" } });
    fireEvent.click(screen.getByTestId("verify-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("verify-error")).toHaveTextContent(
        "Too many attempts",
      );
    });
  });

  it("shows generic error when mfa_verify rejects with non-string", async () => {
    await goToVerifyStep();
    mockInvoke.mockRejectedValueOnce(new Error("fail") as never);

    const input = screen.getByTestId("verify-code-input");
    fireEvent.change(input, { target: { value: "123456" } });
    fireEvent.click(screen.getByTestId("verify-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("verify-error")).toHaveTextContent(
        "Verification failed",
      );
    });
  });

  // --- Backup step ---

  async function goToBackupStep() {
    mockInvoke
      .mockResolvedValueOnce({
        secretBase32: "JBSWY3DPEHPK3PXP",
        qrUri: "otpauth://totp/DSPanel:test?secret=JBSWY3DPEHPK3PXP",
        backupCodes: [
          "11111111",
          "22222222",
          "33333333",
          "44444444",
          "55555555",
          "66666666",
          "77777777",
          "88888888",
          "99999999",
          "00000000",
        ],
      } as never)
      .mockResolvedValueOnce(true as never); // verify

    renderDialog();
    fireEvent.click(screen.getByTestId("setup-begin"));

    await waitFor(() => {
      expect(screen.getByTestId("mfa-setup-verify")).toBeInTheDocument();
    });

    const input = screen.getByTestId("verify-code-input");
    fireEvent.change(input, { target: { value: "123456" } });
    fireEvent.click(screen.getByTestId("verify-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("mfa-setup-backup")).toBeInTheDocument();
    });
  }

  it("transitions to backup step after successful verification", async () => {
    await goToBackupStep();
    expect(screen.getByText("Step 2: Save Backup Codes")).toBeInTheDocument();
  });

  it("displays backup codes on backup step", async () => {
    await goToBackupStep();
    expect(screen.getByTestId("backup-codes")).toBeInTheDocument();
    expect(screen.getByText("11111111")).toBeInTheDocument();
    expect(screen.getByText("00000000")).toBeInTheDocument();
  });

  it("displays success message on backup step", async () => {
    await goToBackupStep();
    expect(
      screen.getByText(/MFA has been set up successfully/),
    ).toBeInTheDocument();
  });

  it("calls onComplete when done is clicked", async () => {
    await goToBackupStep();
    fireEvent.click(screen.getByTestId("setup-complete"));
    expect(onComplete).toHaveBeenCalled();
  });
});
