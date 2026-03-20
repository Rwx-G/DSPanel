import { describe, it, expect } from "vitest";
import type { Preset, PresetType } from "./preset";

describe("Preset types", () => {
  it("can create an onboarding preset", () => {
    const preset: Preset = {
      name: "Dev Onboarding",
      description: "Standard dev setup",
      type: "Onboarding",
      targetOu: "OU=Devs,DC=example,DC=com",
      groups: ["CN=Devs,DC=example,DC=com"],
      attributes: { department: "Engineering" },
    };
    expect(preset.type).toBe("Onboarding");
    expect(preset.groups).toHaveLength(1);
  });

  it("can create an offboarding preset", () => {
    const preset: Preset = {
      name: "Offboarding",
      description: "Departure process",
      type: "Offboarding",
      targetOu: "OU=Disabled,DC=example,DC=com",
      groups: [],
      attributes: {},
    };
    expect(preset.type).toBe("Offboarding");
  });

  it("PresetType only allows Onboarding or Offboarding", () => {
    const validTypes: PresetType[] = ["Onboarding", "Offboarding"];
    expect(validTypes).toHaveLength(2);
  });

  it("attributes can be empty", () => {
    const preset: Preset = {
      name: "Minimal",
      description: "",
      type: "Onboarding",
      targetOu: "OU=Users,DC=example,DC=com",
      groups: ["CN=Group1,DC=example,DC=com"],
      attributes: {},
    };
    expect(Object.keys(preset.attributes)).toHaveLength(0);
  });
});
