import type { Meta, StoryObj } from "@storybook/react-vite";
import { LoadingSpinner } from "./LoadingSpinner";

const meta: Meta<typeof LoadingSpinner> = {
  title: "Common/LoadingSpinner",
  component: LoadingSpinner,
};
export default meta;
type Story = StoryObj<typeof LoadingSpinner>;

export const Default: Story = {};
export const WithMessage: Story = { args: { message: "Loading users..." } };
export const Small: Story = { args: { size: 16 } };
