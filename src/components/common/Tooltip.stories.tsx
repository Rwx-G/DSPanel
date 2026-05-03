import type { Meta, StoryObj } from "@storybook/react-vite";
import { Tooltip, InfoTooltip } from "./Tooltip";

const meta: Meta<typeof Tooltip> = {
  title: "Common/Tooltip",
  component: Tooltip,
};
export default meta;
type Story = StoryObj<typeof Tooltip>;

export const TruncatedCell: Story = {
  args: {
    content: "CN=John Doe,OU=Users,DC=corp,DC=local",
    children: (
      <span className="block max-w-[160px] truncate text-[var(--color-text-primary)]">
        CN=John Doe,OU=Users,DC=corp,DC=local
      </span>
    ),
  },
};

export const RichContent: Story = {
  args: {
    content: (
      <div className="space-y-1">
        <p className="font-medium">Account locked</p>
        <p className="text-[var(--color-text-secondary)]">
          Locked at 12:34 from host01. Unlocks automatically in 30 minutes.
        </p>
      </div>
    ),
    width: 280,
    children: <span className="text-[var(--color-warning)]">Locked icon</span>,
  },
};

export const InfoIcon: StoryObj<typeof InfoTooltip> = {
  render: (args) => (
    <div className="flex items-center gap-2 text-body text-[var(--color-text-primary)]">
      <span>Group hygiene</span>
      <InfoTooltip {...args}>
        <p>
          <strong>What:</strong> Empty groups are likely deletion candidates.
        </p>
        <p className="mt-1">
          <strong>Why:</strong> Stale groups inflate the directory and confuse
          access reviews.
        </p>
        <p className="mt-1">
          <strong>Fix:</strong> Confirm with the owner, then delete.
        </p>
      </InfoTooltip>
    </div>
  ),
  args: {
    ariaLabel: "About this section",
  },
};
