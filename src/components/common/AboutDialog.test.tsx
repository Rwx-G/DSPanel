import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AboutDialog } from "./AboutDialog";

describe("AboutDialog", () => {
  it("renders version", () => {
    render(<AboutDialog version="0.12.0" onClose={() => {}} />);
    expect(screen.getByTestId("about-version").textContent).toContain("0.12.0");
  });

  it("shows license and author", () => {
    render(<AboutDialog version="1.0.0" onClose={() => {}} />);
    expect(screen.getByText("Apache-2.0")).toBeDefined();
    expect(screen.getByText("Romain G.")).toBeDefined();
  });

  it("has GitHub link", () => {
    render(<AboutDialog version="1.0.0" onClose={() => {}} />);
    const link = screen.getByTestId("about-github-link");
    expect(link.getAttribute("href")).toBe("https://github.com/Rwx-G/DSPanel");
  });

  it("has releases link", () => {
    render(<AboutDialog version="1.0.0" onClose={() => {}} />);
    const link = screen.getByTestId("about-releases-link");
    expect(link.getAttribute("href")).toBe("https://github.com/Rwx-G/DSPanel/releases");
  });

  it("calls onClose when close button clicked", () => {
    const onClose = vi.fn();
    render(<AboutDialog version="1.0.0" onClose={onClose} />);
    fireEvent.click(screen.getByTestId("about-dialog-close"));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calls onClose when overlay clicked", () => {
    const onClose = vi.fn();
    render(<AboutDialog version="1.0.0" onClose={onClose} />);
    fireEvent.click(screen.getByTestId("about-dialog-overlay"));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("does not close when dialog content clicked", () => {
    const onClose = vi.fn();
    render(<AboutDialog version="1.0.0" onClose={onClose} />);
    fireEvent.click(screen.getByTestId("about-dialog"));
    expect(onClose).not.toHaveBeenCalled();
  });
});
