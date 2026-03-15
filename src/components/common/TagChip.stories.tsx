import type { Meta, StoryObj } from "@storybook/react-vite";
import { TagChip } from "./TagChip";

const meta: Meta<typeof TagChip> = {
  title: "Common/TagChip",
  component: TagChip,
};
export default meta;
type Story = StoryObj<typeof TagChip>;

export const Default: Story = { args: { text: "IT-Admins" } };
export const Removable: Story = {
  args: { text: "Dev-Backend", onRemove: () => {} },
};
