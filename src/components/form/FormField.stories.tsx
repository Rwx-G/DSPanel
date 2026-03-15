import type { Meta, StoryObj } from "@storybook/react-vite";
import { FormField } from "./FormField";
import { TextInput } from "./TextInput";

const meta: Meta<typeof FormField> = {
  title: "Form/FormField",
  component: FormField,
};
export default meta;
type Story = StoryObj<typeof FormField>;

export const Default: Story = {
  args: {
    label: "Username",
    children: <TextInput placeholder="Enter username..." />,
  },
};

export const Required: Story = {
  args: {
    label: "Email",
    required: true,
    children: <TextInput placeholder="user@example.com" />,
  },
};

export const WithError: Story = {
  args: {
    label: "Password",
    required: true,
    error: "Password must be at least 8 characters",
    children: <TextInput error defaultValue="abc" />,
  },
};
