import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Avatar } from "./Avatar";

describe("Avatar", () => {
  it("should show initials when no image is provided", () => {
    render(<Avatar displayName="John Doe" />);
    expect(screen.getByTestId("avatar-initials")).toHaveTextContent("JD");
  });

  it("should show image when imageUrl is provided", () => {
    render(
      <Avatar
        displayName="John Doe"
        imageUrl="https://example.com/photo.jpg"
      />,
    );
    expect(screen.getByTestId("avatar-image")).toBeInTheDocument();
    expect(screen.getByTestId("avatar-image")).toHaveAttribute(
      "src",
      "https://example.com/photo.jpg",
    );
  });

  it("should use default size of 32", () => {
    render(<Avatar displayName="Alice" />);
    expect(screen.getByTestId("avatar")).toHaveStyle({
      width: "32px",
      height: "32px",
    });
  });

  it("should accept custom size", () => {
    render(<Avatar displayName="Alice" size={48} />);
    expect(screen.getByTestId("avatar")).toHaveStyle({
      width: "48px",
      height: "48px",
    });
  });

  it("should have title with display name", () => {
    render(<Avatar displayName="John Doe" />);
    expect(screen.getByTestId("avatar")).toHaveAttribute("title", "John Doe");
  });

  it("should show ? for empty display name", () => {
    render(<Avatar displayName="" />);
    expect(screen.getByTestId("avatar-initials")).toHaveTextContent("?");
  });

  it("should apply deterministic background color", () => {
    const { container: c1 } = render(<Avatar displayName="Alice" />);
    const { container: c2 } = render(<Avatar displayName="Alice" />);

    const bg1 = c1
      .querySelector("[data-testid='avatar']")
      ?.getAttribute("style");
    const bg2 = c2
      .querySelector("[data-testid='avatar']")
      ?.getAttribute("style");
    expect(bg1).toBe(bg2);
  });

  it("should set alt text on image", () => {
    render(
      <Avatar displayName="John" imageUrl="https://example.com/photo.jpg" />,
    );
    expect(screen.getByAltText("John")).toBeInTheDocument();
  });
});
