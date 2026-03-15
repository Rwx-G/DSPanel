import type { Meta, StoryObj } from "@storybook/react-vite";
import { EmptyState } from "./EmptyState";

const meta: Meta<typeof EmptyState> = {
  title: "Common/EmptyState",
  component: EmptyState,
};
export default meta;
type Story = StoryObj<typeof EmptyState>;

export const Default: Story = { args: { title: "No results found" } };
export const WithDescription: Story = {
  args: {
    title: "No users match your search",
    description: "Try adjusting your filters or search terms.",
  },
};
