import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { PresetSettings } from "./PresetSettings";
import { NotificationProvider } from "@/contexts/NotificationContext";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
const mockInvoke = vi.mocked(invoke);

function Wrapper({ children }: { children: ReactNode }) {
  return createElement(NotificationProvider, null, children);
}

describe("PresetSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the preset settings section", async () => {
    mockInvoke.mockResolvedValueOnce(null as never); // get_preset_path

    render(
      <Wrapper>
        <PresetSettings />
      </Wrapper>,
    );

    expect(screen.getByTestId("preset-settings")).toBeDefined();
    expect(screen.getByText("Preset Storage Path")).toBeDefined();
    expect(screen.getByTestId("preset-path-input")).toBeDefined();
    expect(screen.getByTestId("preset-path-test")).toBeDefined();
    expect(screen.getByTestId("preset-path-save")).toBeDefined();
  });

  it("shows configured path when set", async () => {
    mockInvoke.mockResolvedValueOnce("\\\\server\\presets" as never);

    render(
      <Wrapper>
        <PresetSettings />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("preset-path-configured")).toBeDefined();
    });
  });

  it("test button calls test_preset_path", async () => {
    mockInvoke
      .mockResolvedValueOnce(null as never) // initial load
      .mockResolvedValueOnce(true as never); // test call

    render(
      <Wrapper>
        <PresetSettings />
      </Wrapper>,
    );

    const input = screen.getByTestId("preset-path-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "C:\\presets" } });

    const testBtn = screen.getByTestId("preset-path-test");
    fireEvent.click(testBtn);

    await waitFor(() => {
      expect(screen.getByTestId("preset-path-status")).toBeDefined();
    });

    expect(screen.getByText("Path is accessible and valid.")).toBeDefined();
  });

  it("shows error when test fails", async () => {
    mockInvoke
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce(false as never);

    render(
      <Wrapper>
        <PresetSettings />
      </Wrapper>,
    );

    const input = screen.getByTestId("preset-path-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "/bad/path" } });

    const testBtn = screen.getByTestId("preset-path-test");
    fireEvent.click(testBtn);

    await waitFor(() => {
      expect(screen.getByTestId("preset-path-status")).toBeDefined();
    });

    expect(
      screen.getByText(
        "Path is not accessible. Please check the path and permissions.",
      ),
    ).toBeDefined();
  });

  it("save button calls set_preset_path", async () => {
    mockInvoke
      .mockResolvedValueOnce(null as never) // initial load
      .mockResolvedValueOnce(undefined as never); // set call

    render(
      <Wrapper>
        <PresetSettings />
      </Wrapper>,
    );

    const input = screen.getByTestId("preset-path-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "C:\\presets" } });

    const saveBtn = screen.getByTestId("preset-path-save");
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("set_preset_path", {
        path: "C:\\presets",
      });
    });
  });

  it("disables buttons when input is empty", async () => {
    mockInvoke.mockResolvedValueOnce(null as never);

    render(
      <Wrapper>
        <PresetSettings />
      </Wrapper>,
    );

    const testBtn = screen.getByTestId("preset-path-test") as HTMLButtonElement;
    const saveBtn = screen.getByTestId("preset-path-save") as HTMLButtonElement;

    expect(testBtn.disabled).toBe(true);
    expect(saveBtn.disabled).toBe(true);
  });
});
