import type { Meta, StoryObj } from "@storybook/react-vite";
import { TextInput } from "./TextInput";

const meta: Meta<typeof TextInput> = {
  title: "Form/TextInput",
  component: TextInput,
  argTypes: {
    error: { control: "boolean" },
    disabled: { control: "boolean" },
    placeholder: { control: "text" },
  },
};
export default meta;
type Story = StoryObj<typeof TextInput>;

export const Default: Story = {
  args: { placeholder: "Enter text..." },
};

export const WithValue: Story = {
  args: { defaultValue: "john.doe@example.com" },
};

export const WithError: Story = {
  args: { error: true, defaultValue: "invalid input" },
};

export const Disabled: Story = {
  args: { disabled: true, defaultValue: "Read only" },
};
