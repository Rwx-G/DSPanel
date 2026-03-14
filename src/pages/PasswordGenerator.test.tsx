import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PasswordGenerator } from "./PasswordGenerator";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
const mockInvoke = vi.mocked(invoke);

describe("PasswordGenerator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders page with controls", () => {
    render(<PasswordGenerator />);
    expect(screen.getByTestId("password-generator-page")).toBeInTheDocument();
    expect(screen.getByText("Password Generator")).toBeInTheDocument();
    expect(screen.getByTestId("length-slider")).toBeInTheDocument();
    expect(screen.getByTestId("generate-btn")).toBeInTheDocument();
  });

  it("shows default length of 16", () => {
    render(<PasswordGenerator />);
    expect(screen.getByTestId("length-value")).toHaveTextContent("16");
  });

  it("updates length when slider changes", () => {
    render(<PasswordGenerator />);
    const slider = screen.getByTestId("length-slider");
    fireEvent.change(slider, { target: { value: "24" } });
    expect(screen.getByTestId("length-value")).toHaveTextContent("24");
  });

  it("has all category checkboxes checked by default", () => {
    render(<PasswordGenerator />);
    expect(screen.getByTestId("opt-uppercase")).toBeChecked();
    expect(screen.getByTestId("opt-lowercase")).toBeChecked();
    expect(screen.getByTestId("opt-digits")).toBeChecked();
    expect(screen.getByTestId("opt-special")).toBeChecked();
    expect(screen.getByTestId("opt-ambiguous")).not.toBeChecked();
  });

  it("calls generate_password on button click", async () => {
    mockInvoke.mockResolvedValueOnce("Abc123!@XyZ" as never);

    render(<PasswordGenerator />);
    fireEvent.click(screen.getByTestId("generate-btn"));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith(
        "generate_password",
        expect.objectContaining({
          length: 16,
          includeUppercase: true,
          includeLowercase: true,
          includeDigits: true,
          includeSpecial: true,
          excludeAmbiguous: false,
        }),
      );
    });
  });

  it("displays generated password", async () => {
    mockInvoke.mockResolvedValueOnce("SecurePass123!" as never);

    render(<PasswordGenerator />);
    fireEvent.click(screen.getByTestId("generate-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("password-result")).toBeInTheDocument();
    });

    expect(screen.getByText("SecurePass123!")).toBeInTheDocument();
  });

  it("shows copy button after generation", async () => {
    mockInvoke.mockResolvedValueOnce("Pass123!" as never);

    render(<PasswordGenerator />);
    fireEvent.click(screen.getByTestId("generate-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("copy-button")).toBeInTheDocument();
    });
  });

  it("shows check HIBP button after generation", async () => {
    mockInvoke.mockResolvedValueOnce("Pass123!" as never);

    render(<PasswordGenerator />);
    fireEvent.click(screen.getByTestId("generate-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("check-hibp-btn")).toBeInTheDocument();
    });
  });

  it("shows clean status after HIBP check", async () => {
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "generate_password") return Promise.resolve("SafePass!");
      if (cmd === "check_password_hibp")
        return Promise.resolve({ isBreached: false, breachCount: 0, checked: true });
      return Promise.resolve(undefined);
    }) as typeof invoke);

    render(<PasswordGenerator />);
    fireEvent.click(screen.getByTestId("generate-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("check-hibp-btn")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("check-hibp-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("hibp-clean")).toBeInTheDocument();
    });
  });

  it("shows breached status after HIBP check", async () => {
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "generate_password") return Promise.resolve("password");
      if (cmd === "check_password_hibp")
        return Promise.resolve({ isBreached: true, breachCount: 3861493, checked: true });
      return Promise.resolve(undefined);
    }) as typeof invoke);

    render(<PasswordGenerator />);
    fireEvent.click(screen.getByTestId("generate-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("check-hibp-btn")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("check-hibp-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("hibp-breached")).toBeInTheDocument();
    });

    expect(screen.getByTestId("hibp-breached")).toHaveTextContent("3");
    expect(screen.getByTestId("hibp-breached")).toHaveTextContent("breaches");
  });

  it("shows unchecked status when HIBP API fails", async () => {
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "generate_password") return Promise.resolve("Pass!");
      if (cmd === "check_password_hibp") return Promise.reject("Network error");
      return Promise.resolve(undefined);
    }) as typeof invoke);

    render(<PasswordGenerator />);
    fireEvent.click(screen.getByTestId("generate-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("check-hibp-btn")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("check-hibp-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("hibp-unchecked")).toBeInTheDocument();
    });
  });

  it("shows error message on generation failure", async () => {
    mockInvoke.mockRejectedValueOnce("No categories selected" as never);

    render(<PasswordGenerator />);
    fireEvent.click(screen.getByTestId("generate-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("error-message")).toBeInTheDocument();
    });

    expect(screen.getByTestId("error-message")).toHaveTextContent("No categories selected");
  });

  it("passes exclude ambiguous option correctly", async () => {
    mockInvoke.mockResolvedValueOnce("Pass123" as never);

    render(<PasswordGenerator />);
    fireEvent.click(screen.getByTestId("opt-ambiguous"));
    fireEvent.click(screen.getByTestId("generate-btn"));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith(
        "generate_password",
        expect.objectContaining({
          excludeAmbiguous: true,
        }),
      );
    });
  });
});
