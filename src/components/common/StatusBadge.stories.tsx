import type { Meta, StoryObj } from "@storybook/react-vite";
import { StatusBadge } from "./StatusBadge";

const meta: Meta<typeof StatusBadge> = {
  title: "Common/StatusBadge",
  component: StatusBadge,
};
export default meta;
type Story = StoryObj<typeof StatusBadge>;

export const Success: Story = { args: { text: "Enabled", variant: "success" } };
export const Error: Story = { args: { text: "Disabled", variant: "error" } };
export const Warning: Story = { args: { text: "Expiring", variant: "warning" } };
export const Info: Story = { args: { text: "Pending", variant: "info" } };
export const Neutral: Story = { args: { text: "Unknown", variant: "neutral" } };
