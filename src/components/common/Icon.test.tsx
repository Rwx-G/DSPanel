import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Icon } from "./Icon";
import { Search, Settings, User } from "lucide-react";

describe("Icon", () => {
  it("should render an icon component", () => {
    render(<Icon icon={Search} />);
    const svg = document.querySelector("svg");
    expect(svg).toBeInTheDocument();
  });

  it("should apply custom size", () => {
    render(<Icon icon={Settings} size={24} />);
    const svg = document.querySelector("svg");
    expect(svg).toHaveAttribute("width", "24");
    expect(svg).toHaveAttribute("height", "24");
  });

  it("should apply default size of 16", () => {
    render(<Icon icon={User} />);
    const svg = document.querySelector("svg");
    expect(svg).toHaveAttribute("width", "16");
    expect(svg).toHaveAttribute("height", "16");
  });

  it("should apply className", () => {
    render(<Icon icon={Search} className="test-class" />);
    const svg = document.querySelector("svg");
    expect(svg).toHaveClass("test-class");
  });
});
