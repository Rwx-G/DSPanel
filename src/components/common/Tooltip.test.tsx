import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { Tooltip, InfoTooltip } from "./Tooltip";

describe("Tooltip", () => {
  it("renders children without a popover by default", () => {
    render(
      <Tooltip content="hidden until hover" testId="trigger">
        <span>visible</span>
      </Tooltip>,
    );
    expect(screen.getByTestId("trigger")).toBeInTheDocument();
    expect(screen.queryByTestId("tooltip-card")).not.toBeInTheDocument();
  });

  it("opens the popover on mouse enter and closes on mouse leave", () => {
    render(
      <Tooltip content="full DN here" testId="trigger">
        <span>truncated...</span>
      </Tooltip>,
    );
    const trigger = screen.getByTestId("trigger");

    fireEvent.mouseEnter(trigger);
    expect(screen.getByTestId("tooltip-card")).toHaveTextContent(
      "full DN here",
    );

    fireEvent.mouseLeave(trigger);
    expect(screen.queryByTestId("tooltip-card")).not.toBeInTheDocument();
  });

  it("opens on focus and closes on blur for keyboard users", () => {
    render(
      <Tooltip content="keyboard hint" testId="trigger">
        <span>field</span>
      </Tooltip>,
    );
    const trigger = screen.getByTestId("trigger");

    fireEvent.focus(trigger);
    expect(screen.getByTestId("tooltip-card")).toBeInTheDocument();

    fireEvent.blur(trigger);
    expect(screen.queryByTestId("tooltip-card")).not.toBeInTheDocument();
  });

  it("closes on Escape while open", () => {
    render(
      <Tooltip content="escape me" testId="trigger">
        <span>x</span>
      </Tooltip>,
    );
    const trigger = screen.getByTestId("trigger");

    fireEvent.mouseEnter(trigger);
    expect(screen.getByTestId("tooltip-card")).toBeInTheDocument();

    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(screen.queryByTestId("tooltip-card")).not.toBeInTheDocument();
  });

  it("renders children only when content is empty (no wrapper trigger, no popover)", () => {
    render(
      <Tooltip content="" testId="trigger">
        <span data-testid="bare-child">visible</span>
      </Tooltip>,
    );
    expect(screen.queryByTestId("trigger")).not.toBeInTheDocument();
    expect(screen.getByTestId("bare-child")).toBeInTheDocument();
  });

  it("links the popover to the trigger via aria-describedby when open", () => {
    render(
      <Tooltip content="aria check" testId="trigger">
        <span>x</span>
      </Tooltip>,
    );
    const trigger = screen.getByTestId("trigger");
    expect(trigger).not.toHaveAttribute("aria-describedby");

    fireEvent.focus(trigger);
    const describedBy = trigger.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(screen.getByTestId("tooltip-card").id).toBe(describedBy);
  });

  it("forwards a custom width to the popover style", () => {
    render(
      <Tooltip content="narrow" testId="trigger" width={120}>
        <span>x</span>
      </Tooltip>,
    );
    fireEvent.mouseEnter(screen.getByTestId("trigger"));
    const card = screen.getByTestId("tooltip-card");
    expect(card.style.width).toBe("120px");
  });
});

describe("InfoTooltip", () => {
  it("renders an icon button with the supplied accessible label", () => {
    render(
      <InfoTooltip ariaLabel="What is this?" testId="info">
        <p>Helper</p>
      </InfoTooltip>,
    );
    const trigger = screen.getByTestId("info");
    expect(trigger).toHaveAttribute("aria-label", "What is this?");
    expect(trigger.tagName).toBe("BUTTON");
  });

  it("toggles the popover on click", () => {
    render(
      <InfoTooltip ariaLabel="info" testId="info">
        <p>Helper text</p>
      </InfoTooltip>,
    );
    const trigger = screen.getByTestId("info");

    fireEvent.click(trigger);
    expect(screen.getByTestId("info-tooltip-card")).toHaveTextContent(
      "Helper text",
    );

    fireEvent.click(trigger);
    expect(screen.queryByTestId("info-tooltip-card")).not.toBeInTheDocument();
  });

  it("closes on Escape while open", () => {
    render(
      <InfoTooltip ariaLabel="info" testId="info">
        <p>x</p>
      </InfoTooltip>,
    );
    const trigger = screen.getByTestId("info");
    fireEvent.click(trigger);
    expect(screen.getByTestId("info-tooltip-card")).toBeInTheDocument();

    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(screen.queryByTestId("info-tooltip-card")).not.toBeInTheDocument();
  });

  it("delays close on blur so a click inside the popover registers", () => {
    vi.useFakeTimers();
    try {
      render(
        <InfoTooltip ariaLabel="info" testId="info">
          <p>x</p>
        </InfoTooltip>,
      );
      const trigger = screen.getByTestId("info");
      fireEvent.click(trigger);
      expect(screen.getByTestId("info-tooltip-card")).toBeInTheDocument();

      fireEvent.blur(trigger);
      // Still open immediately after blur.
      expect(screen.getByTestId("info-tooltip-card")).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(200);
      });
      expect(screen.queryByTestId("info-tooltip-card")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("reflects the open state on aria-expanded and aria-controls", () => {
    render(
      <InfoTooltip ariaLabel="info" testId="info">
        <p>x</p>
      </InfoTooltip>,
    );
    const trigger = screen.getByTestId("info");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).not.toHaveAttribute("aria-controls");

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const controls = trigger.getAttribute("aria-controls");
    expect(controls).toBeTruthy();
    expect(screen.getByTestId("info-tooltip-card").id).toBe(controls);
  });
});
