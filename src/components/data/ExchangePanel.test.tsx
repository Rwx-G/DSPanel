import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ExchangePanel } from "./ExchangePanel";
import { type ExchangeMailboxInfo } from "@/types/exchange";

function makeExchangeInfo(
  overrides?: Partial<ExchangeMailboxInfo>,
): ExchangeMailboxInfo {
  return {
    mailboxGuid: "abc-123-guid",
    recipientType: "UserMailbox",
    primarySmtpAddress: "john.doe@example.com",
    emailAliases: ["j.doe@example.com", "johnd@example.com"],
    forwardingAddress: "CN=Jane Smith,OU=Users,DC=example,DC=com",
    delegates: [
      "CN=Alice,OU=Users,DC=example,DC=com",
      "CN=Bob,OU=Users,DC=example,DC=com",
    ],
    ...overrides,
  };
}

describe("ExchangePanel", () => {
  it("renders the panel with all fields", () => {
    render(<ExchangePanel exchangeInfo={makeExchangeInfo()} />);
    expect(screen.getByTestId("exchange-panel")).toBeInTheDocument();
    expect(screen.getByText("Exchange Mailbox")).toBeInTheDocument();
    expect(screen.getByText("abc-123-guid")).toBeInTheDocument();
    expect(screen.getByText("UserMailbox")).toBeInTheDocument();
    expect(screen.getByText("john.doe@example.com")).toBeInTheDocument();
    expect(screen.getByText("Jane Smith")).toBeInTheDocument();
  });

  it("displays email aliases list", () => {
    render(<ExchangePanel exchangeInfo={makeExchangeInfo()} />);
    const list = screen.getByTestId("exchange-aliases-list");
    expect(list).toBeInTheDocument();
    expect(screen.getByText("j.doe@example.com")).toBeInTheDocument();
    expect(screen.getByText("johnd@example.com")).toBeInTheDocument();
  });

  it("displays delegates list", () => {
    render(<ExchangePanel exchangeInfo={makeExchangeInfo()} />);
    const list = screen.getByTestId("exchange-delegates-list");
    expect(list).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
  });

  it("hides aliases section when no aliases", () => {
    render(
      <ExchangePanel exchangeInfo={makeExchangeInfo({ emailAliases: [] })} />,
    );
    expect(
      screen.queryByTestId("exchange-aliases-list"),
    ).not.toBeInTheDocument();
  });

  it("hides delegates section when no delegates", () => {
    render(
      <ExchangePanel exchangeInfo={makeExchangeInfo({ delegates: [] })} />,
    );
    expect(
      screen.queryByTestId("exchange-delegates-list"),
    ).not.toBeInTheDocument();
  });

  it("hides forwarding row when no forwarding address", () => {
    render(
      <ExchangePanel
        exchangeInfo={makeExchangeInfo({ forwardingAddress: null })}
      />,
    );
    expect(screen.queryByText("Forwarding To")).not.toBeInTheDocument();
  });

  it("collapses and expands when toggle is clicked", () => {
    render(<ExchangePanel exchangeInfo={makeExchangeInfo()} />);
    expect(screen.getByTestId("exchange-panel-content")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("exchange-panel-toggle"));
    expect(
      screen.queryByTestId("exchange-panel-content"),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("exchange-panel-toggle"));
    expect(screen.getByTestId("exchange-panel-content")).toBeInTheDocument();
  });
});
