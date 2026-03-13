import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useFormValidation, type FieldConfig } from "./useFormValidation";

const schema: Record<string, FieldConfig> = {
  name: {
    rules: [
      {
        validate: (v) => typeof v === "string" && v.length > 0,
        message: "Name is required",
      },
      {
        validate: (v) => typeof v === "string" && v.length <= 50,
        message: "Name must be 50 characters or less",
      },
    ],
  },
  email: {
    rules: [
      {
        validate: (v) => typeof v === "string" && v.includes("@"),
        message: "Email must contain @",
      },
    ],
  },
};

describe("useFormValidation", () => {
  it("should start with no errors", () => {
    const { result } = renderHook(() => useFormValidation(schema));
    expect(result.current.errors).toEqual({});
    expect(result.current.hasErrors).toBe(false);
  });

  it("should set error when field validation fails", () => {
    const { result } = renderHook(() => useFormValidation(schema));

    act(() => {
      result.current.validateField("name", "");
    });

    expect(result.current.errors.name).toBe("Name is required");
    expect(result.current.hasErrors).toBe(true);
  });

  it("should clear error when field validation passes", () => {
    const { result } = renderHook(() => useFormValidation(schema));

    act(() => {
      result.current.validateField("name", "");
    });
    act(() => {
      result.current.validateField("name", "Alice");
    });

    expect(result.current.errors.name).toBeUndefined();
  });

  it("should stop at first failing rule for a field", () => {
    const { result } = renderHook(() => useFormValidation(schema));

    act(() => {
      result.current.validateField("name", "");
    });

    expect(result.current.errors.name).toBe("Name is required");
  });

  it("should validate all fields at once", () => {
    const { result } = renderHook(() => useFormValidation(schema));

    let isValid: boolean;
    act(() => {
      isValid = result.current.validateAll({ name: "", email: "nope" });
    });

    expect(isValid!).toBe(false);
    expect(result.current.errors.name).toBe("Name is required");
    expect(result.current.errors.email).toBe("Email must contain @");
  });

  it("should return true when all fields are valid", () => {
    const { result } = renderHook(() => useFormValidation(schema));

    let isValid: boolean;
    act(() => {
      isValid = result.current.validateAll({
        name: "Alice",
        email: "alice@test.com",
      });
    });

    expect(isValid!).toBe(true);
    expect(result.current.hasErrors).toBe(false);
  });

  it("should clear all errors", () => {
    const { result } = renderHook(() => useFormValidation(schema));

    act(() => {
      result.current.validateAll({ name: "", email: "" });
    });
    act(() => {
      result.current.clearErrors();
    });

    expect(result.current.errors).toEqual({});
    expect(result.current.hasErrors).toBe(false);
  });

  it("should ignore unknown field names", () => {
    const { result } = renderHook(() => useFormValidation(schema));

    act(() => {
      result.current.validateField("unknown", "value");
    });

    expect(result.current.errors).toEqual({});
  });
});
