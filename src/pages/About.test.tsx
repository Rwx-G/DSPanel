import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { About } from "./About";

describe("About", () => {
  it("renders the page container", () => {
    render(<About />);
    expect(screen.getByTestId("about-page")).toBeInTheDocument();
  });

  it("displays the app name", () => {
    render(<About />);
    expect(screen.getByText("DSPanel")).toBeInTheDocument();
  });

  it("displays the app description", () => {
    render(<About />);
    expect(screen.getByText("Active Directory Management")).toBeInTheDocument();
  });

  it("displays the version from the global define", () => {
    render(<About />);
    const versionEl = screen.getByTestId("about-version");
    expect(versionEl).toBeInTheDocument();
    expect(versionEl.textContent).toMatch(/^Version .+/);
  });

  it("displays the license as Apache-2.0", () => {
    render(<About />);
    expect(screen.getByText("License")).toBeInTheDocument();
    expect(screen.getByText("Apache-2.0")).toBeInTheDocument();
  });

  it("displays the author as Rwx-G", () => {
    render(<About />);
    expect(screen.getByText("Author")).toBeInTheDocument();
    expect(screen.getByText("Rwx-G")).toBeInTheDocument();
  });

  it("renders GitHub repository link with correct href and attributes", () => {
    render(<About />);
    const link = screen.getByTestId("about-github-link");
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "https://github.com/Rwx-G/DSPanel");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveTextContent("GitHub Repository");
  });

  it("renders releases link with correct href and attributes", () => {
    render(<About />);
    const link = screen.getByTestId("about-releases-link");
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "https://github.com/Rwx-G/DSPanel/releases");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveTextContent("Releases & Changelog");
  });
});
