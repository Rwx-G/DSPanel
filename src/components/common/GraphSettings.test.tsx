import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { GraphSettings } from "./GraphSettings";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  vi.clearAllMocks();
  mockInvoke.mockImplementation((cmd: string) => {
    if (cmd === "get_app_settings") {
      return Promise.resolve({
        disabledOu: null,
        graphTenantId: null,
        graphClientId: null,
      });
    }
    if (cmd === "get_credential") return Promise.resolve(null);
    if (cmd === "store_credential") return Promise.resolve();
    if (cmd === "delete_credential") return Promise.resolve();
    if (cmd === "set_app_settings") return Promise.resolve();
    if (cmd === "test_graph_connection") return Promise.resolve(true);
    return Promise.resolve(null);
  });
});

describe("GraphSettings", () => {
  it("renders all fields", async () => {
    render(<GraphSettings />);
    await waitFor(() => {
      expect(screen.getByTestId("graph-tenant-id")).toBeInTheDocument();
    });
    expect(screen.getByTestId("graph-client-id")).toBeInTheDocument();
    expect(screen.getByTestId("graph-client-secret")).toBeInTheDocument();
    expect(screen.getByTestId("graph-test-btn")).toBeInTheDocument();
    expect(screen.getByTestId("graph-save-btn")).toBeInTheDocument();
  });

  it("loads existing settings on mount", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_app_settings") {
        return Promise.resolve({
          graphTenantId: "tenant-123",
          graphClientId: "client-456",
        });
      }
      if (cmd === "get_credential") return Promise.resolve(null);
      return Promise.resolve(null);
    });

    render(<GraphSettings />);
    await waitFor(() => {
      expect(screen.getByTestId("graph-tenant-id")).toHaveValue("tenant-123");
    });
    expect(screen.getByTestId("graph-client-id")).toHaveValue("client-456");
  });

  it("shows placeholder when secret exists in credential store", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_app_settings") {
        return Promise.resolve({
          graphTenantId: "t",
          graphClientId: "c",
        });
      }
      if (cmd === "get_credential") return Promise.resolve("stored-secret");
      return Promise.resolve(null);
    });

    render(<GraphSettings />);
    await waitFor(() => {
      const input = screen.getByTestId("graph-client-secret");
      expect(input).toHaveAttribute(
        "placeholder",
        "Stored in OS credential store",
      );
      expect(input).toHaveValue("");
    });
  });

  it("disables test button when fields are empty", async () => {
    render(<GraphSettings />);
    await waitFor(() => {
      expect(screen.getByTestId("graph-test-btn")).toBeDisabled();
    });
  });

  it("enables test button when tenant and client are filled", async () => {
    render(<GraphSettings />);
    await waitFor(() => {
      expect(screen.getByTestId("graph-tenant-id")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId("graph-tenant-id"), {
      target: { value: "tenant" },
    });
    fireEvent.change(screen.getByTestId("graph-client-id"), {
      target: { value: "client" },
    });

    expect(screen.getByTestId("graph-test-btn")).not.toBeDisabled();
  });

  it("shows success message on successful test", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_app_settings") {
        return Promise.resolve({
          graphTenantId: "t",
          graphClientId: "c",
        });
      }
      if (cmd === "get_credential") return Promise.resolve("s");
      if (cmd === "set_app_settings") return Promise.resolve();
      if (cmd === "store_credential") return Promise.resolve();
      if (cmd === "test_graph_connection") return Promise.resolve(true);
      return Promise.resolve(null);
    });

    render(<GraphSettings />);
    await waitFor(() => {
      expect(screen.getByTestId("graph-test-btn")).not.toBeDisabled();
    });

    fireEvent.click(screen.getByTestId("graph-test-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("graph-test-status")).toHaveTextContent(
        "Connection successful",
      );
    });
  });

  it("shows failure message on failed test", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_app_settings") {
        return Promise.resolve({
          graphTenantId: "t",
          graphClientId: "c",
        });
      }
      if (cmd === "get_credential") return Promise.resolve("s");
      if (cmd === "set_app_settings") return Promise.resolve();
      if (cmd === "store_credential") return Promise.resolve();
      if (cmd === "test_graph_connection")
        return Promise.reject(new Error("fail"));
      return Promise.resolve(null);
    });

    render(<GraphSettings />);
    await waitFor(() => {
      expect(screen.getByTestId("graph-test-btn")).not.toBeDisabled();
    });

    fireEvent.click(screen.getByTestId("graph-test-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("graph-test-status")).toHaveTextContent(
        "Connection failed",
      );
    });
  });

  it("calls set_app_settings on save without secret", async () => {
    render(<GraphSettings />);
    await waitFor(() => {
      expect(screen.getByTestId("graph-save-btn")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId("graph-tenant-id"), {
      target: { value: "my-tenant" },
    });

    fireEvent.click(screen.getByTestId("graph-save-btn"));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("set_app_settings", {
        settings: expect.objectContaining({
          graphTenantId: "my-tenant",
        }),
      });
      // Secret should NOT be in the settings payload
      const call = mockInvoke.mock.calls.find(
        (c) => c[0] === "set_app_settings",
      );
      expect(call?.[1]).toBeDefined();
      const settings = (call![1] as Record<string, unknown>).settings as Record<
        string,
        unknown
      >;
      expect(settings).not.toHaveProperty("graphClientSecret");
    });
  });

  it("stores secret via store_credential when secret is changed", async () => {
    render(<GraphSettings />);
    await waitFor(() => {
      expect(screen.getByTestId("graph-client-secret")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId("graph-client-secret"), {
      target: { value: "new-secret" },
    });

    fireEvent.click(screen.getByTestId("graph-save-btn"));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("store_credential", {
        key: "graph_client_secret",
        value: "new-secret",
      });
    });
  });
});
