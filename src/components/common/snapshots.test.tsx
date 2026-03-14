import { render } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { SearchBar } from "./SearchBar";
import { StatusBadge } from "./StatusBadge";
import { Avatar } from "./Avatar";
import { TagChip } from "./TagChip";
import { LoadingSpinner } from "./LoadingSpinner";
import { EmptyState } from "./EmptyState";
import { InfoCard } from "./InfoCard";
import { CopyButton } from "./CopyButton";

// Mock clipboard API
Object.assign(navigator, {
  clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
});

describe("Common controls - visual snapshots", () => {
  it("SearchBar renders correctly", () => {
    const { container } = render(
      <SearchBar
        value="test query"
        onChange={() => {}}
        onSearch={() => {}}
        placeholder="Search users..."
        debounceMs={0}
      />,
    );
    expect(container.firstChild).toMatchSnapshot();
  });

  it("StatusBadge renders all variants", () => {
    const variants = [
      "success",
      "warning",
      "error",
      "info",
      "neutral",
    ] as const;
    const { container } = render(
      <div>
        {variants.map((v) => (
          <StatusBadge key={v} text={v} variant={v} />
        ))}
      </div>,
    );
    expect(container.firstChild).toMatchSnapshot();
  });

  it("Avatar renders with initials fallback", () => {
    const { container } = render(<Avatar displayName="John Doe" size={40} />);
    expect(container.firstChild).toMatchSnapshot();
  });

  it("TagChip renders with remove button", () => {
    const { container } = render(
      <TagChip text="Admin" removable onRemove={() => {}} />,
    );
    expect(container.firstChild).toMatchSnapshot();
  });

  it("TagChip renders without remove button", () => {
    const { container } = render(<TagChip text="ReadOnly" removable={false} />);
    expect(container.firstChild).toMatchSnapshot();
  });

  it("LoadingSpinner renders with message", () => {
    const { container } = render(<LoadingSpinner message="Loading data..." />);
    expect(container.firstChild).toMatchSnapshot();
  });

  it("EmptyState renders with icon and action", () => {
    const { container } = render(
      <EmptyState
        icon={<span>icon</span>}
        title="No results"
        description="Try a different search query."
        action={{ label: "Retry", onClick: () => {} }}
      />,
    );
    expect(container.firstChild).toMatchSnapshot();
  });

  it("InfoCard renders expanded", () => {
    const { container } = render(
      <InfoCard header="Details" collapsible defaultExpanded>
        <p>Card content here</p>
      </InfoCard>,
    );
    expect(container.firstChild).toMatchSnapshot();
  });

  it("InfoCard renders collapsed", () => {
    const { container } = render(
      <InfoCard header="Details" collapsible defaultExpanded={false}>
        <p>Card content here</p>
      </InfoCard>,
    );
    expect(container.firstChild).toMatchSnapshot();
  });

  it("CopyButton renders idle state", () => {
    const { container } = render(<CopyButton text="value-to-copy" />);
    expect(container.firstChild).toMatchSnapshot();
  });
});
