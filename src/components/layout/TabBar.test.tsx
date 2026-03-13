import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { type ReactNode } from "react";
import {
  NavigationProvider,
  useNavigation,
  resetTabIdCounter,
} from "@/contexts/NavigationContext";
import { TabBar } from "./TabBar";

function renderWithNavigation(ui: ReactNode) {
  return render(<NavigationProvider>{ui}</NavigationProvider>);
}

// jsdom does not implement setPointerCapture/releasePointerCapture
if (!HTMLElement.prototype.setPointerCapture) {
  HTMLElement.prototype.setPointerCapture = () => {};
}
if (!HTMLElement.prototype.releasePointerCapture) {
  HTMLElement.prototype.releasePointerCapture = () => {};
}

describe("TabBar", () => {
  beforeEach(() => {
    resetTabIdCounter();
  });

  it("should render the tab bar", () => {
    renderWithNavigation(<TabBar />);
    expect(screen.getByTestId("tab-bar")).toBeInTheDocument();
  });

  it("should have tablist role", () => {
    renderWithNavigation(<TabBar />);
    expect(screen.getByRole("tablist")).toBeInTheDocument();
  });

  it("should render empty tab bar by default", () => {
    renderWithNavigation(<TabBar />);
    expect(screen.getByTestId("tab-bar")).toBeInTheDocument();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
  });

  it("should render a tab when opened", () => {
    function TestSetup() {
      const { openTab } = useNavigation();
      return (
        <>
          <button
            data-testid="open-users"
            onClick={() => openTab("Users", "users")}
          />
          <TabBar />
        </>
      );
    }

    renderWithNavigation(<TestSetup />);
    fireEvent.click(screen.getByTestId("open-users"));

    expect(screen.getByTestId("tab-users")).toBeInTheDocument();
  });

  it("should show close button on tabs", () => {
    function TestSetup() {
      const { openTab } = useNavigation();
      return (
        <>
          <button
            data-testid="open-users"
            onClick={() => openTab("Users", "users")}
          />
          <TabBar />
        </>
      );
    }

    renderWithNavigation(<TestSetup />);
    fireEvent.click(screen.getByTestId("open-users"));

    expect(screen.getByTestId("tab-close-users")).toBeInTheDocument();
  });

  it("should mark opened tab as active", () => {
    function TestSetup() {
      const { openTab } = useNavigation();
      return (
        <>
          <button
            data-testid="open-users"
            onClick={() => openTab("Users", "users")}
          />
          <TabBar />
        </>
      );
    }

    renderWithNavigation(<TestSetup />);
    fireEvent.click(screen.getByTestId("open-users"));

    expect(screen.getByTestId("tab-users")).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("should switch active tab on click", () => {
    function TestSetup() {
      const { openTab } = useNavigation();
      return (
        <>
          <button
            data-testid="open-users"
            onClick={() => openTab("Users", "users")}
          />
          <button
            data-testid="open-computers"
            onClick={() => openTab("Computers", "computers")}
          />
          <TabBar />
        </>
      );
    }

    renderWithNavigation(<TestSetup />);
    fireEvent.click(screen.getByTestId("open-users"));
    fireEvent.click(screen.getByTestId("open-computers"));

    // Computers is active
    expect(screen.getByTestId("tab-computers")).toHaveAttribute(
      "aria-selected",
      "true",
    );

    // Click users tab
    fireEvent.click(screen.getByTestId("tab-users"));
    expect(screen.getByTestId("tab-users")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByTestId("tab-computers")).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });

  it("should close tab when close button is clicked", () => {
    function TestSetup() {
      const { openTab } = useNavigation();
      return (
        <>
          <button
            data-testid="open-users"
            onClick={() => openTab("Users", "users")}
          />
          <TabBar />
        </>
      );
    }

    renderWithNavigation(<TestSetup />);
    fireEvent.click(screen.getByTestId("open-users"));
    fireEvent.click(screen.getByTestId("tab-close-users"));

    expect(screen.queryByTestId("tab-users")).not.toBeInTheDocument();
  });

  it("should display tab title", () => {
    function TestSetup() {
      const { openTab } = useNavigation();
      return (
        <>
          <button
            data-testid="open-users"
            onClick={() => openTab("User Lookup", "users")}
          />
          <TabBar />
        </>
      );
    }

    renderWithNavigation(<TestSetup />);
    fireEvent.click(screen.getByTestId("open-users"));

    expect(screen.getByTestId("tab-users")).toHaveTextContent("User Lookup");
  });

  it("should close tab on middle-click", () => {
    function TestSetup() {
      const { openTab } = useNavigation();
      return (
        <>
          <button
            data-testid="open-users"
            onClick={() => openTab("Users", "users")}
          />
          <TabBar />
        </>
      );
    }

    renderWithNavigation(<TestSetup />);
    fireEvent.click(screen.getByTestId("open-users"));

    const tabEl = screen.getByTestId("tab-users");
    act(() => {
      tabEl.dispatchEvent(
        new MouseEvent("auxclick", { bubbles: true, button: 1 }),
      );
    });

    expect(screen.queryByTestId("tab-users")).not.toBeInTheDocument();
  });

  // --- Context menu tests ---

  it("should open context menu on right-click", () => {
    function TestSetup() {
      const { openTab } = useNavigation();
      return (
        <>
          <button
            data-testid="open-users"
            onClick={() => openTab("Users", "users")}
          />
          <TabBar />
        </>
      );
    }

    renderWithNavigation(<TestSetup />);
    fireEvent.click(screen.getByTestId("open-users"));

    fireEvent.contextMenu(screen.getByTestId("tab-users"));

    expect(screen.getByTestId("tab-context-menu")).toBeInTheDocument();
    expect(screen.getByTestId("tab-ctx-close")).toBeInTheDocument();
    expect(screen.getByTestId("tab-ctx-close-others")).toBeInTheDocument();
    expect(screen.getByTestId("tab-ctx-close-all")).toBeInTheDocument();
  });

  it("should close the tab via context menu Close", () => {
    function TestSetup() {
      const { openTab } = useNavigation();
      return (
        <>
          <button
            data-testid="open-users"
            onClick={() => openTab("Users", "users")}
          />
          <TabBar />
        </>
      );
    }

    renderWithNavigation(<TestSetup />);
    fireEvent.click(screen.getByTestId("open-users"));
    fireEvent.contextMenu(screen.getByTestId("tab-users"));
    fireEvent.click(screen.getByTestId("tab-ctx-close"));

    expect(screen.queryByTestId("tab-users")).not.toBeInTheDocument();
    expect(screen.queryByTestId("tab-context-menu")).not.toBeInTheDocument();
  });

  it("should close other tabs via context menu Close Others", () => {
    function TestSetup() {
      const { openTab } = useNavigation();
      return (
        <>
          <button
            data-testid="open-users"
            onClick={() => openTab("Users", "users")}
          />
          <button
            data-testid="open-computers"
            onClick={() => openTab("Computers", "computers")}
          />
          <button
            data-testid="open-groups"
            onClick={() => openTab("Groups", "groups")}
          />
          <TabBar />
        </>
      );
    }

    renderWithNavigation(<TestSetup />);
    fireEvent.click(screen.getByTestId("open-users"));
    fireEvent.click(screen.getByTestId("open-computers"));
    fireEvent.click(screen.getByTestId("open-groups"));

    // Right-click on "Computers" and choose Close Others
    fireEvent.contextMenu(screen.getByTestId("tab-computers"));
    fireEvent.click(screen.getByTestId("tab-ctx-close-others"));

    expect(screen.getByTestId("tab-computers")).toBeInTheDocument();
    expect(screen.queryByTestId("tab-users")).not.toBeInTheDocument();
    expect(screen.queryByTestId("tab-groups")).not.toBeInTheDocument();
  });

  it("should close all tabs via context menu Close All", () => {
    function TestSetup() {
      const { openTab } = useNavigation();
      return (
        <>
          <button
            data-testid="open-users"
            onClick={() => openTab("Users", "users")}
          />
          <button
            data-testid="open-computers"
            onClick={() => openTab("Computers", "computers")}
          />
          <TabBar />
        </>
      );
    }

    renderWithNavigation(<TestSetup />);
    fireEvent.click(screen.getByTestId("open-users"));
    fireEvent.click(screen.getByTestId("open-computers"));

    fireEvent.contextMenu(screen.getByTestId("tab-users"));
    fireEvent.click(screen.getByTestId("tab-ctx-close-all"));

    expect(screen.queryByTestId("tab-users")).not.toBeInTheDocument();
    expect(screen.queryByTestId("tab-computers")).not.toBeInTheDocument();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
  });

  it("should dismiss context menu on click outside", () => {
    function TestSetup() {
      const { openTab } = useNavigation();
      return (
        <>
          <button
            data-testid="open-users"
            onClick={() => openTab("Users", "users")}
          />
          <TabBar />
        </>
      );
    }

    renderWithNavigation(<TestSetup />);
    fireEvent.click(screen.getByTestId("open-users"));

    fireEvent.contextMenu(screen.getByTestId("tab-users"));
    expect(screen.getByTestId("tab-context-menu")).toBeInTheDocument();

    // Click anywhere on the document to dismiss
    act(() => {
      document.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(screen.queryByTestId("tab-context-menu")).not.toBeInTheDocument();
  });

  // --- Drag and drop tests ---

  it("should set dragging state on pointerdown", () => {
    function TestSetup() {
      const { openTab } = useNavigation();
      return (
        <>
          <button
            data-testid="open-users"
            onClick={() => openTab("Users", "users")}
          />
          <TabBar />
        </>
      );
    }

    renderWithNavigation(<TestSetup />);
    fireEvent.click(screen.getByTestId("open-users"));

    const tabEl = screen.getByTestId("tab-users");
    fireEvent.pointerDown(tabEl, { button: 0, clientX: 100 });

    // The tab should have z-10 and cursor-grabbing classes when dragging
    expect(tabEl.className).toContain("z-10");
    expect(tabEl.className).toContain("cursor-grabbing");
  });

  it("should reset drag state on pointerup", () => {
    function TestSetup() {
      const { openTab } = useNavigation();
      return (
        <>
          <button
            data-testid="open-users"
            onClick={() => openTab("Users", "users")}
          />
          <TabBar />
        </>
      );
    }

    renderWithNavigation(<TestSetup />);
    fireEvent.click(screen.getByTestId("open-users"));

    const tabEl = screen.getByTestId("tab-users");
    fireEvent.pointerDown(tabEl, { button: 0, clientX: 100 });
    expect(tabEl.className).toContain("z-10");

    fireEvent.pointerUp(tabEl);
    expect(tabEl.className).not.toContain("z-10");
    expect(tabEl.className).toContain("cursor-grab");
  });

  // --- Scroll button tests ---

  it("should show and use scroll-left button when scrolled right", () => {
    function TestSetup() {
      const { openTab } = useNavigation();
      return (
        <>
          <button
            data-testid="open-many"
            onClick={() => {
              for (let i = 0; i < 10; i++) {
                openTab(`Tab${i}`, `tab${i}`);
              }
            }}
          />
          <TabBar />
        </>
      );
    }

    const { container } = renderWithNavigation(<TestSetup />);
    fireEvent.click(screen.getByTestId("open-many"));

    const scrollContainer = container.querySelector(".overflow-x-auto")!;
    // Mock scrollBy so we can verify it's called
    const scrollBySpy = vi.fn();
    scrollContainer.scrollBy = scrollBySpy;

    // Mock scroll measurements to simulate overflow with scroll position > 0
    Object.defineProperty(scrollContainer, "scrollLeft", { value: 50, configurable: true });
    Object.defineProperty(scrollContainer, "clientWidth", { value: 200, configurable: true });
    Object.defineProperty(scrollContainer, "scrollWidth", { value: 500, configurable: true });

    act(() => {
      scrollContainer.dispatchEvent(new Event("scroll"));
    });

    const scrollLeftBtn = screen.getByTestId("tab-scroll-left");
    expect(scrollLeftBtn).toBeInTheDocument();

    fireEvent.click(scrollLeftBtn);
    expect(scrollBySpy).toHaveBeenCalledWith({ left: -150, behavior: "smooth" });
  });

  it("should show and use scroll-right button when content overflows", () => {
    function TestSetup() {
      const { openTab } = useNavigation();
      return (
        <>
          <button
            data-testid="open-many"
            onClick={() => {
              for (let i = 0; i < 10; i++) {
                openTab(`Tab${i}`, `tab${i}`);
              }
            }}
          />
          <TabBar />
        </>
      );
    }

    const { container } = renderWithNavigation(<TestSetup />);
    fireEvent.click(screen.getByTestId("open-many"));

    const scrollContainer = container.querySelector(".overflow-x-auto")!;
    const scrollBySpy = vi.fn();
    scrollContainer.scrollBy = scrollBySpy;

    // Mock: scrollLeft=0, clientWidth < scrollWidth means we can scroll right
    Object.defineProperty(scrollContainer, "scrollLeft", { value: 0, configurable: true });
    Object.defineProperty(scrollContainer, "clientWidth", { value: 200, configurable: true });
    Object.defineProperty(scrollContainer, "scrollWidth", { value: 500, configurable: true });

    act(() => {
      scrollContainer.dispatchEvent(new Event("scroll"));
    });

    const scrollRightBtn = screen.getByTestId("tab-scroll-right");
    expect(scrollRightBtn).toBeInTheDocument();

    fireEvent.click(scrollRightBtn);
    expect(scrollBySpy).toHaveBeenCalledWith({ left: 150, behavior: "smooth" });
  });

  // --- Drag move test ---

  it("should apply translateX during pointermove while dragging", () => {
    function TestSetup() {
      const { openTab } = useNavigation();
      return (
        <>
          <button
            data-testid="open-users"
            onClick={() => openTab("Users", "users")}
          />
          <button
            data-testid="open-computers"
            onClick={() => openTab("Computers", "computers")}
          />
          <TabBar />
        </>
      );
    }

    renderWithNavigation(<TestSetup />);
    fireEvent.click(screen.getByTestId("open-users"));
    fireEvent.click(screen.getByTestId("open-computers"));

    const tabEl = screen.getByTestId("tab-users");
    fireEvent.pointerDown(tabEl, { button: 0, clientX: 100 });

    // Move pointer to the right
    fireEvent.pointerMove(tabEl, { clientX: 130 });

    // The tab should have a translateX style applied
    expect(tabEl.style.transform).toContain("translateX");
  });

  it("should not initiate drag on right-click", () => {
    function TestSetup() {
      const { openTab } = useNavigation();
      return (
        <>
          <button
            data-testid="open-users"
            onClick={() => openTab("Users", "users")}
          />
          <TabBar />
        </>
      );
    }

    renderWithNavigation(<TestSetup />);
    fireEvent.click(screen.getByTestId("open-users"));

    const tabEl = screen.getByTestId("tab-users");
    // Right-click (button=2) should not initiate drag
    fireEvent.pointerDown(tabEl, { button: 2, clientX: 100 });

    expect(tabEl.className).not.toContain("z-10");
    expect(tabEl.className).not.toContain("cursor-grabbing");
  });

  it("should not start drag from close button", () => {
    function TestSetup() {
      const { openTab } = useNavigation();
      return (
        <>
          <button
            data-testid="open-users"
            onClick={() => openTab("Users", "users")}
          />
          <TabBar />
        </>
      );
    }

    renderWithNavigation(<TestSetup />);
    fireEvent.click(screen.getByTestId("open-users"));

    const closeBtn = screen.getByTestId("tab-close-users");
    fireEvent.pointerDown(closeBtn, { button: 0, clientX: 100 });

    // Tab should not enter dragging state when clicking on the close button
    const tabEl = screen.getByTestId("tab-users");
    expect(tabEl.className).not.toContain("z-10");
    expect(tabEl.className).not.toContain("cursor-grabbing");
  });
});
