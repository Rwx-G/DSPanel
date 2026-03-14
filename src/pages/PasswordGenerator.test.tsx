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
    // Default: generate_password returns a password
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "generate_password") return Promise.resolve("DefaultPass123!");
      return Promise.resolve(undefined);
    }) as typeof invoke);
  });

  it("renders page with controls", async () => {
    render(<PasswordGenerator />);
    expect(screen.getByTestId("password-generator-page")).toBeInTheDocument();
    expect(screen.getByText("Password Generator")).toBeInTheDocument();
    expect(screen.getByTestId("length-slider")).toBeInTheDocument();
    expect(screen.getByTestId("generate-btn")).toBeInTheDocument();
  });

  it("generates password automatically on mount", async () => {
    render(<PasswordGenerator />);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith(
        "generate_password",
        expect.objectContaining({ length: 16 }),
      );
    });

    expect(screen.getByTestId("password-result")).toBeInTheDocument();
    expect(screen.getByText("DefaultPass123!")).toBeInTheDocument();
  });

  it("password display is always visible (no layout shift)", () => {
    render(<PasswordGenerator />);
    expect(screen.getByTestId("password-result")).toBeInTheDocument();
  });

  it("shows default length of 16", () => {
    render(<PasswordGenerator />);
    expect(screen.getByTestId("length-value")).toHaveTextContent("16");
  });

  it("regenerates when length changes", async () => {
    render(<PasswordGenerator />);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledTimes(1);
    });

    fireEvent.change(screen.getByTestId("length-slider"), {
      target: { value: "24" },
    });

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith(
        "generate_password",
        expect.objectContaining({ length: 24 }),
      );
    });
  });

  it("regenerates when checkbox changes", async () => {
    render(<PasswordGenerator />);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByTestId("opt-ambiguous"));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith(
        "generate_password",
        expect.objectContaining({ excludeAmbiguous: true }),
      );
    });
  });

  it("has all category checkboxes checked by default", () => {
    render(<PasswordGenerator />);
    expect(screen.getByTestId("opt-uppercase")).toBeChecked();
    expect(screen.getByTestId("opt-lowercase")).toBeChecked();
    expect(screen.getByTestId("opt-digits")).toBeChecked();
    expect(screen.getByTestId("opt-special")).toBeChecked();
    expect(screen.getByTestId("opt-ambiguous")).not.toBeChecked();
  });

  it("regenerate button generates a new password", async () => {
    let callCount = 0;
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "generate_password") {
        callCount++;
        return Promise.resolve(callCount === 1 ? "First!" : "Second!");
      }
      return Promise.resolve(undefined);
    }) as typeof invoke);

    render(<PasswordGenerator />);

    await waitFor(() => {
      expect(screen.getByText("First!")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("generate-btn"));

    await waitFor(() => {
      expect(screen.getByText("Second!")).toBeInTheDocument();
    });
  });

  it("shows copy button alongside password", async () => {
    render(<PasswordGenerator />);

    await waitFor(() => {
      expect(screen.getByTestId("copy-button")).toBeInTheDocument();
    });
  });

  it("shows check HIBP button", async () => {
    render(<PasswordGenerator />);

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

    await waitFor(() => {
      expect(screen.getByTestId("check-hibp-btn")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("check-hibp-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("hibp-unchecked")).toBeInTheDocument();
    });
  });

  it("shows error message on generation failure", async () => {
    mockInvoke.mockRejectedValue("No categories selected");

    render(<PasswordGenerator />);

    await waitFor(() => {
      expect(screen.getByTestId("error-message")).toBeInTheDocument();
    });

    expect(screen.getByTestId("error-message")).toHaveTextContent("No categories selected");
  });

  it("displays best practices section", () => {
    render(<PasswordGenerator />);
    expect(screen.getByText("Password Best Practices")).toBeInTheDocument();
    expect(screen.getByText(/16 characters/)).toBeInTheDocument();
  });

  it("page is scrollable", () => {
    render(<PasswordGenerator />);
    const page = screen.getByTestId("password-generator-page");
    expect(page.className).toContain("overflow-y-auto");
  });
});
