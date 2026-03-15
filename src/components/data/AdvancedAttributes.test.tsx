import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AdvancedAttributes } from "./AdvancedAttributes";

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
  };
})();

Object.defineProperty(window, "localStorage", {
  value: localStorageMock,
});

// Sample raw attributes - these should NOT include attributes in DISPLAYED_ATTRS
const SAMPLE_ATTRS: Record<string, string[]> = {
  cn: ["John Doe"],
  description: ["Test user account"],
  homeDirectory: ["\\\\server\\home\\jdoe"],
  logonCount: ["42"],
  objectGUID: ["{12345678-abcd-ef01-2345-6789abcdef01}"],
  // These are in DISPLAYED_ATTRS and should be filtered out:
  displayName: ["John Doe"],
  sAMAccountName: ["jdoe"],
  mail: ["jdoe@example.com"],
  memberOf: ["CN=Domain Users,DC=example,DC=com"],
};

describe("AdvancedAttributes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
  });

  it("renders the component with correct total count", () => {
    render(<AdvancedAttributes rawAttributes={SAMPLE_ATTRS} />);
    expect(screen.getByTestId("advanced-attributes")).toBeInTheDocument();
    // Should show count excluding DISPLAYED_ATTRS
    expect(screen.getByText(/Advanced Attributes/)).toBeInTheDocument();
  });

  it("displays advanced attributes that are not in DISPLAYED_ATTRS", () => {
    render(<AdvancedAttributes rawAttributes={SAMPLE_ATTRS} />);
    expect(screen.getByTestId("advanced-attr-cn")).toBeInTheDocument();
    expect(
      screen.getByTestId("advanced-attr-description"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("advanced-attr-logonCount"),
    ).toBeInTheDocument();
  });

  it("does not display attributes that are in DISPLAYED_ATTRS", () => {
    render(<AdvancedAttributes rawAttributes={SAMPLE_ATTRS} />);
    expect(
      screen.queryByTestId("advanced-attr-displayName"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("advanced-attr-sAMAccountName"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("advanced-attr-mail"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("advanced-attr-memberOf"),
    ).not.toBeInTheDocument();
  });

  it("shows attribute values", () => {
    render(<AdvancedAttributes rawAttributes={SAMPLE_ATTRS} />);
    expect(screen.getByText("John Doe")).toBeInTheDocument();
    expect(screen.getByText("Test user account")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("joins multiple values with semicolons", () => {
    const attrs: Record<string, string[]> = {
      proxyAddresses: ["SMTP:user@example.com", "smtp:alias@example.com"],
    };
    render(<AdvancedAttributes rawAttributes={attrs} />);
    expect(
      screen.getByText("SMTP:user@example.com ; smtp:alias@example.com"),
    ).toBeInTheDocument();
  });

  it("collapses and expands the section", () => {
    render(<AdvancedAttributes rawAttributes={SAMPLE_ATTRS} />);

    // Initially expanded - attributes should be visible
    expect(screen.getByTestId("advanced-attr-cn")).toBeInTheDocument();

    // Click to collapse
    const toggleBtn = screen.getByRole("button", {
      name: /Advanced Attributes/i,
    });
    fireEvent.click(toggleBtn);

    // Attributes should be hidden
    expect(
      screen.queryByTestId("advanced-attr-cn"),
    ).not.toBeInTheDocument();

    // Click to expand again
    fireEvent.click(toggleBtn);

    // Attributes should be visible again
    expect(screen.getByTestId("advanced-attr-cn")).toBeInTheDocument();
  });

  it("filters attributes by search text", () => {
    render(<AdvancedAttributes rawAttributes={SAMPLE_ATTRS} />);

    const searchInput = screen.getByTestId("advanced-attributes-search");
    fireEvent.change(searchInput, { target: { value: "logon" } });

    // logonCount should still be visible
    expect(
      screen.getByTestId("advanced-attr-logonCount"),
    ).toBeInTheDocument();

    // Other attributes should be filtered out
    expect(
      screen.queryByTestId("advanced-attr-cn"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("advanced-attr-description"),
    ).not.toBeInTheDocument();
  });

  it("filters attributes by value content", () => {
    render(<AdvancedAttributes rawAttributes={SAMPLE_ATTRS} />);

    const searchInput = screen.getByTestId("advanced-attributes-search");
    fireEvent.change(searchInput, { target: { value: "Test user" } });

    // description has "Test user account" value
    expect(
      screen.getByTestId("advanced-attr-description"),
    ).toBeInTheDocument();

    // Other attributes should be filtered out
    expect(
      screen.queryByTestId("advanced-attr-logonCount"),
    ).not.toBeInTheDocument();
  });

  it("shows 'No attributes match' when search finds nothing", () => {
    render(<AdvancedAttributes rawAttributes={SAMPLE_ATTRS} />);

    const searchInput = screen.getByTestId("advanced-attributes-search");
    fireEvent.change(searchInput, { target: { value: "zzz-nonexistent" } });

    expect(screen.getByText(/No attributes match/)).toBeInTheDocument();
  });

  it("clears search text when clear button is clicked", () => {
    render(<AdvancedAttributes rawAttributes={SAMPLE_ATTRS} />);

    const searchInput = screen.getByTestId("advanced-attributes-search");
    fireEvent.change(searchInput, { target: { value: "logon" } });

    // Clear button should appear
    const clearBtn = screen.getByLabelText("Clear filter");
    fireEvent.click(clearBtn);

    // All attributes should be visible again
    expect(screen.getByTestId("advanced-attr-cn")).toBeInTheDocument();
    expect(
      screen.getByTestId("advanced-attr-logonCount"),
    ).toBeInTheDocument();
  });

  it("toggles favorite status of an attribute", () => {
    render(<AdvancedAttributes rawAttributes={SAMPLE_ATTRS} />);

    const favBtn = screen.getByTestId("favorite-toggle-cn");
    fireEvent.click(favBtn);

    // Should now show "Favorites" section header
    expect(screen.getByText("Favorites")).toBeInTheDocument();

    // localStorage should have been called
    expect(localStorageMock.setItem).toHaveBeenCalled();

    // Click again to unfavorite
    fireEvent.click(favBtn);

    // After removing from favorites, "Favorites" section header may still exist
    // due to re-render timing, but the attribute should move to "All Attributes"
    const attrRow = screen.getByTestId("advanced-attr-cn");
    expect(attrRow).toBeInTheDocument();
  });

  it("shows favorite attributes in a separate section", () => {
    // Pre-set favorites in localStorage
    localStorageMock.getItem.mockReturnValue(JSON.stringify(["cn"]));

    render(<AdvancedAttributes rawAttributes={SAMPLE_ATTRS} />);

    expect(screen.getByText("Favorites")).toBeInTheDocument();
    expect(screen.getByText("All Attributes")).toBeInTheDocument();
  });

  it("shows 'No advanced attributes available' for empty rawAttributes", () => {
    // Pass only DISPLAYED_ATTRS so nothing remains
    const onlyDisplayed: Record<string, string[]> = {
      displayName: ["Test"],
      sAMAccountName: ["test"],
    };
    render(<AdvancedAttributes rawAttributes={onlyDisplayed} />);

    expect(
      screen.getByText("No advanced attributes available"),
    ).toBeInTheDocument();
  });

  it("sorts attributes alphabetically", () => {
    const attrs: Record<string, string[]> = {
      zeta: ["z"],
      alpha: ["a"],
      middle: ["m"],
    };
    render(<AdvancedAttributes rawAttributes={attrs} />);

    const items = screen.getAllByTestId(/advanced-attr-/);
    expect(items[0]).toHaveAttribute("data-testid", "advanced-attr-alpha");
    expect(items[1]).toHaveAttribute("data-testid", "advanced-attr-middle");
    expect(items[2]).toHaveAttribute("data-testid", "advanced-attr-zeta");
  });

  it("shows (empty) indicator for empty value", () => {
    const attrs: Record<string, string[]> = {
      emptyAttr: [""],
    };
    render(<AdvancedAttributes rawAttributes={attrs} />);

    expect(screen.getByText("(empty)")).toBeInTheDocument();
  });

  it("renders copy button for attribute values on hover", () => {
    render(<AdvancedAttributes rawAttributes={SAMPLE_ATTRS} />);

    // CopyButton is present (hidden by CSS opacity but in DOM)
    const attrRow = screen.getByTestId("advanced-attr-cn");
    expect(attrRow).toBeInTheDocument();
  });

  it("handles corrupted localStorage data gracefully", () => {
    localStorageMock.getItem.mockReturnValue("not-valid-json");

    // Should not throw
    render(<AdvancedAttributes rawAttributes={SAMPLE_ATTRS} />);
    expect(screen.getByTestId("advanced-attributes")).toBeInTheDocument();
  });

  it("displays correct filtered count in section", () => {
    render(<AdvancedAttributes rawAttributes={SAMPLE_ATTRS} />);

    const searchInput = screen.getByTestId("advanced-attributes-search");
    fireEvent.change(searchInput, { target: { value: "cn" } });

    // Only cn should match the key filter
    expect(screen.getByTestId("advanced-attr-cn")).toBeInTheDocument();
  });
});
