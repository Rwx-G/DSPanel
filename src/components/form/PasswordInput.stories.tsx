import type { Meta, StoryObj } from "@storybook/react-vite";
import { PasswordInput } from "./PasswordInput";

const meta: Meta<typeof PasswordInput> = {
  title: "Form/PasswordInput",
  component: PasswordInput,
};
export default meta;
type Story = StoryObj<typeof PasswordInput>;

export const Default: Story = {
  args: { placeholder: "Enter password..." },
};

export const WithError: Story = {
  args: { error: true, defaultValue: "weak" },
};

export const Disabled: Story = {
  args: { disabled: true, defaultValue: "secret" },
};
