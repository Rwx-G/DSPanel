import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { CopyButton } from "./CopyButton";

describe("CopyButton", () => {
  const mockWriteText = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.useFakeTimers();
    Object.assign(navigator, {
      clipboard: { writeText: mockWriteText },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("should render the copy button", () => {
    render(<CopyButton text="hello" />);
    expect(screen.getByTestId("copy-button")).toBeInTheDocument();
  });

  it("should have 'Copy to clipboard' label initially", () => {
    render(<CopyButton text="hello" />);
    expect(screen.getByLabelText("Copy to clipboard")).toBeInTheDocument();
  });

  it("should copy text to clipboard on click", async () => {
    render(<CopyButton text="hello world" />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("copy-button"));
    });

    expect(mockWriteText).toHaveBeenCalledWith("hello world");
  });

  it("should show 'Copied' label after click", async () => {
    render(<CopyButton text="hello" />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("copy-button"));
    });

    expect(screen.getByLabelText("Copied")).toBeInTheDocument();
  });

  it("should revert to copy label after feedback duration", async () => {
    render(<CopyButton text="hello" feedbackMs={1000} />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("copy-button"));
    });

    expect(screen.getByLabelText("Copied")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(screen.getByLabelText("Copy to clipboard")).toBeInTheDocument();
  });

  it("should use default feedback duration of 2000ms", async () => {
    render(<CopyButton text="hello" />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("copy-button"));
    });

    act(() => {
      vi.advanceTimersByTime(2100);
    });
    expect(screen.getByLabelText("Copy to clipboard")).toBeInTheDocument();
  });
});
