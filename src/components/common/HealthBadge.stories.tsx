import type { Meta, StoryObj } from "@storybook/react-vite";
import { HealthBadge } from "./HealthBadge";

const meta: Meta<typeof HealthBadge> = {
  title: "Common/HealthBadge",
  component: HealthBadge,
};
export default meta;
type Story = StoryObj<typeof HealthBadge>;

export const Healthy: Story = {
  args: { healthStatus: { level: "Healthy", activeFlags: [] } },
};

export const Warning: Story = {
  args: {
    healthStatus: {
      level: "Warning",
      activeFlags: [
        { name: "PasswordExpiring", description: "Password expires in 5 days", severity: "Warning" },
      ],
    },
  },
};

export const Critical: Story = {
  args: {
    healthStatus: {
      level: "Critical",
      activeFlags: [
        { name: "AccountDisabled", description: "Account is disabled", severity: "Critical" },
        { name: "AccountLockedOut", description: "Account is locked out", severity: "Critical" },
      ],
    },
  },
};
