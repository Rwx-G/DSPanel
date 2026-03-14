import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { VirtualizedList } from "./VirtualizedList";

// Mock @tanstack/react-virtual to avoid needing real scroll container measurements
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: vi.fn(({ count, estimateSize, getItemKey }) => {
    const items = Array.from({ length: Math.min(count, 20) }, (_, i) => ({
      key: getItemKey ? getItemKey(i) : i,
      index: i,
      start: i * estimateSize(i),
      size: estimateSize(i),
    }));
    return {
      getTotalSize: () => count * estimateSize(0),
      getVirtualItems: () => items,
    };
  }),
}));

interface TestItem {
  id: string;
  label: string;
}

const makeItems = (count: number): TestItem[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `item-${i}`,
    label: `Item ${i}`,
  }));

describe("VirtualizedList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should render the virtualized list container", () => {
    const items = makeItems(5);
    render(
      <VirtualizedList
        items={items}
        renderItem={(item) => <div>{item.label}</div>}
        estimateSize={40}
        itemKey={(item) => item.id}
      />,
    );
    expect(screen.getByTestId("virtualized-list")).toBeInTheDocument();
  });

  it("should render visible items", () => {
    const items = makeItems(5);
    render(
      <VirtualizedList
        items={items}
        renderItem={(item) => <div>{item.label}</div>}
        estimateSize={40}
        itemKey={(item) => item.id}
      />,
    );
    expect(screen.getByText("Item 0")).toBeInTheDocument();
    expect(screen.getByText("Item 4")).toBeInTheDocument();
  });

  it("should render only a window of items for large lists", () => {
    const items = makeItems(1000);
    render(
      <VirtualizedList
        items={items}
        renderItem={(item) => <div>{item.label}</div>}
        estimateSize={40}
        itemKey={(item) => item.id}
      />,
    );
    // Mock limits to 20 visible items
    const renderedItems = screen.getAllByTestId("virtualized-list-item");
    expect(renderedItems.length).toBeLessThan(1000);
    expect(renderedItems.length).toBe(20);
  });

  it("should show loading state", () => {
    render(
      <VirtualizedList
        items={[]}
        renderItem={() => <div />}
        estimateSize={40}
        itemKey={(_, i) => i}
        loading={true}
      />,
    );
    expect(screen.getByTestId("virtualized-list-loading")).toBeInTheDocument();
  });

  it("should show empty state when no items", () => {
    render(
      <VirtualizedList
        items={[]}
        renderItem={() => <div />}
        estimateSize={40}
        itemKey={(_, i) => i}
      />,
    );
    expect(screen.getByTestId("virtualized-list-empty")).toBeInTheDocument();
  });

  it("should show custom empty message", () => {
    render(
      <VirtualizedList
        items={[]}
        renderItem={() => <div />}
        estimateSize={40}
        itemKey={(_, i) => i}
        emptyMessage="Nothing here"
      />,
    );
    expect(screen.getByText("Nothing here")).toBeInTheDocument();
  });

  it("should apply custom className", () => {
    const items = makeItems(3);
    render(
      <VirtualizedList
        items={items}
        renderItem={(item) => <div>{item.label}</div>}
        estimateSize={40}
        itemKey={(item) => item.id}
        className="h-96"
      />,
    );
    expect(screen.getByTestId("virtualized-list")).toHaveClass("h-96");
  });

  it("should set data-index on each item", () => {
    const items = makeItems(3);
    render(
      <VirtualizedList
        items={items}
        renderItem={(item) => <div>{item.label}</div>}
        estimateSize={40}
        itemKey={(item) => item.id}
      />,
    );
    const rendered = screen.getAllByTestId("virtualized-list-item");
    expect(rendered[0]).toHaveAttribute("data-index", "0");
    expect(rendered[2]).toHaveAttribute("data-index", "2");
  });

  it("should position items absolutely with translateY", () => {
    const items = makeItems(3);
    render(
      <VirtualizedList
        items={items}
        renderItem={(item) => <div>{item.label}</div>}
        estimateSize={40}
        itemKey={(item) => item.id}
      />,
    );
    const rendered = screen.getAllByTestId("virtualized-list-item");
    expect(rendered[0].style.transform).toBe("translateY(0px)");
    expect(rendered[1].style.transform).toBe("translateY(40px)");
    expect(rendered[2].style.transform).toBe("translateY(80px)");
  });

  it("should set total height on inner container", () => {
    const items = makeItems(100);
    render(
      <VirtualizedList
        items={items}
        renderItem={(item) => <div>{item.label}</div>}
        estimateSize={40}
        itemKey={(item) => item.id}
      />,
    );
    const container = screen.getByTestId("virtualized-list").firstElementChild;
    expect(container).toHaveStyle({ height: "4000px" });
  });

  it("should call onEndReached when last item is visible", () => {
    const items = makeItems(5);
    const onEndReached = vi.fn();
    render(
      <VirtualizedList
        items={items}
        renderItem={(item) => <div>{item.label}</div>}
        estimateSize={40}
        itemKey={(item) => item.id}
        onEndReached={onEndReached}
      />,
    );
    // Mock shows all 5 items (< 20 limit), so last item is visible
    expect(onEndReached).toHaveBeenCalled();
  });

  it("should show loading more indicator", () => {
    const items = makeItems(3);
    render(
      <VirtualizedList
        items={items}
        renderItem={(item) => <div>{item.label}</div>}
        estimateSize={40}
        itemKey={(item) => item.id}
        loadingMore={true}
      />,
    );
    expect(
      screen.getByTestId("virtualized-list-loading-more"),
    ).toBeInTheDocument();
  });

  it("should pass index to renderItem", () => {
    const items = makeItems(3);
    const renderItem = vi.fn((item: TestItem, index: number) => (
      <div data-testid={`rendered-${index}`}>{item.label}</div>
    ));
    render(
      <VirtualizedList
        items={items}
        renderItem={renderItem}
        estimateSize={40}
        itemKey={(item) => item.id}
      />,
    );
    expect(renderItem).toHaveBeenCalledWith(items[0], 0);
    expect(renderItem).toHaveBeenCalledWith(items[2], 2);
  });
});
