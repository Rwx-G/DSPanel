import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ComboBox } from "./ComboBox";

const meta: Meta<typeof ComboBox> = {
  title: "Form/ComboBox",
  component: ComboBox,
};
export default meta;
type Story = StoryObj<typeof ComboBox>;

const SAMPLE_OPTIONS = [
  { value: "it", label: "IT Department" },
  { value: "hr", label: "Human Resources" },
  { value: "finance", label: "Finance" },
  { value: "sales", label: "Sales" },
  { value: "engineering", label: "Engineering" },
];

export const Default: Story = {
  render: () => {
    const [value, setValue] = useState("");
    return (
      <div className="w-64">
        <ComboBox options={SAMPLE_OPTIONS} value={value} onChange={setValue} />
      </div>
    );
  },
};

export const WithSelection: Story = {
  render: () => {
    const [value, setValue] = useState("hr");
    return (
      <div className="w-64">
        <ComboBox options={SAMPLE_OPTIONS} value={value} onChange={setValue} />
      </div>
    );
  },
};

export const WithError: Story = {
  render: () => (
    <div className="w-64">
      <ComboBox options={SAMPLE_OPTIONS} value="" onChange={() => {}} error />
    </div>
  ),
};

export const Disabled: Story = {
  render: () => (
    <div className="w-64">
      <ComboBox
        options={SAMPLE_OPTIONS}
        value="finance"
        onChange={() => {}}
        disabled
      />
    </div>
  ),
};
