import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ExchangeOnlinePanel } from "./ExchangeOnlinePanel";
import { type ExchangeOnlineInfo } from "@/types/exchange-online";

function makeInfo(
  overrides?: Partial<ExchangeOnlineInfo>,
): ExchangeOnlineInfo {
  return {
    primarySmtpAddress: "user@example.com",
    emailAliases: ["alias@example.com"],
    forwardingSmtpAddress: "forward@example.com",
    autoReplyStatus: "Disabled",
    mailboxUsageBytes: 500_000_000,
    mailboxQuotaBytes: 1_073_741_824,
    usagePercentage: 46.6,
    delegates: ["delegate@example.com"],
    ...overrides,
  };
}

describe("ExchangeOnlinePanel", () => {
  it("renders all fields", () => {
    render(<ExchangeOnlinePanel exchangeOnlineInfo={makeInfo()} />);
    expect(screen.getByTestId("exchange-online-panel")).toBeInTheDocument();
    expect(screen.getByText("Exchange Online")).toBeInTheDocument();
    expect(screen.getByText("user@example.com")).toBeInTheDocument();
    expect(screen.getByText("Disabled")).toBeInTheDocument();
    expect(screen.getByText("forward@example.com")).toBeInTheDocument();
  });

  it("displays quota usage bar", () => {
    render(<ExchangeOnlinePanel exchangeOnlineInfo={makeInfo()} />);
    expect(screen.getByTestId("exchange-online-quota")).toBeInTheDocument();
    expect(screen.getByText(/46\.6%/)).toBeInTheDocument();
  });

  it("displays aliases list", () => {
    render(<ExchangeOnlinePanel exchangeOnlineInfo={makeInfo()} />);
    expect(
      screen.getByTestId("exchange-online-aliases-list"),
    ).toBeInTheDocument();
    expect(screen.getByText("alias@example.com")).toBeInTheDocument();
  });

  it("displays delegates list", () => {
    render(<ExchangeOnlinePanel exchangeOnlineInfo={makeInfo()} />);
    expect(
      screen.getByTestId("exchange-online-delegates-list"),
    ).toBeInTheDocument();
    expect(screen.getByText("delegate@example.com")).toBeInTheDocument();
  });

  it("hides forwarding when not set", () => {
    render(
      <ExchangeOnlinePanel
        exchangeOnlineInfo={makeInfo({ forwardingSmtpAddress: null })}
      />,
    );
    expect(screen.queryByText("Forwarding To")).not.toBeInTheDocument();
  });

  it("hides aliases when empty", () => {
    render(
      <ExchangeOnlinePanel
        exchangeOnlineInfo={makeInfo({ emailAliases: [] })}
      />,
    );
    expect(
      screen.queryByTestId("exchange-online-aliases-list"),
    ).not.toBeInTheDocument();
  });

  it("hides delegates when empty", () => {
    render(
      <ExchangeOnlinePanel
        exchangeOnlineInfo={makeInfo({ delegates: [] })}
      />,
    );
    expect(
      screen.queryByTestId("exchange-online-delegates-list"),
    ).not.toBeInTheDocument();
  });

  it("collapses and expands", () => {
    render(<ExchangeOnlinePanel exchangeOnlineInfo={makeInfo()} />);
    expect(
      screen.getByTestId("exchange-online-panel-content"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("exchange-online-panel-toggle"));
    expect(
      screen.queryByTestId("exchange-online-panel-content"),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("exchange-online-panel-toggle"));
    expect(
      screen.getByTestId("exchange-online-panel-content"),
    ).toBeInTheDocument();
  });
});
