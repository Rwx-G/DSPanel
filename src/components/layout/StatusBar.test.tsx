import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusBar } from "./StatusBar";

describe("StatusBar", () => {
  const defaultProps = {
    domainName: "CORP.LOCAL",
    domainController: "DC01",
    permissionLevel: "HelpDesk",
    isConnected: true,
    appVersion: "0.1.0",
  };

  it("should render the status bar", () => {
    render(<StatusBar {...defaultProps} />);
    expect(screen.getByTestId("status-bar")).toBeInTheDocument();
  });

  it("should show Connected when isConnected is true", () => {
    render(<StatusBar {...defaultProps} />);
    expect(screen.getByTestId("status-connection")).toHaveTextContent(
      "Connected",
    );
  });

  it("should show Disconnected when isConnected is false", () => {
    render(<StatusBar {...defaultProps} isConnected={false} />);
    expect(screen.getByTestId("status-connection")).toHaveTextContent(
      "Disconnected",
    );
  });

  it("should display the domain name", () => {
    render(<StatusBar {...defaultProps} />);
    expect(screen.getByTestId("status-domain")).toHaveTextContent("CORP.LOCAL");
  });

  it("should hide domain name when null", () => {
    render(<StatusBar {...defaultProps} domainName={null} />);
    expect(screen.queryByTestId("status-domain")).not.toBeInTheDocument();
  });

  it("should display the domain controller", () => {
    render(<StatusBar {...defaultProps} />);
    expect(screen.getByTestId("status-dc")).toHaveTextContent("DC01");
  });

  it("should hide domain controller when null", () => {
    render(<StatusBar {...defaultProps} domainController={null} />);
    expect(screen.queryByTestId("status-dc")).not.toBeInTheDocument();
  });

  it("should display the permission level badge", () => {
    render(<StatusBar {...defaultProps} />);
    expect(screen.getByTestId("status-permission")).toHaveTextContent(
      "HelpDesk",
    );
  });

  it("should display the app version with v prefix", () => {
    render(<StatusBar {...defaultProps} />);
    expect(screen.getByTestId("status-version")).toHaveTextContent("v0.1.0");
  });

  it("should apply success color class to indicator when connected", () => {
    render(<StatusBar {...defaultProps} />);
    const dot = screen
      .getByTestId("status-bar")
      .querySelector("span.relative.inline-flex.rounded-full");
    expect(dot?.className).toContain("color-success");
  });

  it("should apply error color class to indicator when disconnected", () => {
    render(<StatusBar {...defaultProps} isConnected={false} />);
    const dot = screen
      .getByTestId("status-bar")
      .querySelector("span.relative.inline-flex.rounded-full");
    expect(dot?.className).toContain("color-error");
  });
});
