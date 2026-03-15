import type { Meta, StoryObj } from "@storybook/react-vite";
import { CopyButton } from "./CopyButton";

const meta: Meta<typeof CopyButton> = {
  title: "Common/CopyButton",
  component: CopyButton,
};
export default meta;
type Story = StoryObj<typeof CopyButton>;

export const Default: Story = {
  args: { text: "CN=John Doe,OU=Users,DC=contoso,DC=com" },
};
