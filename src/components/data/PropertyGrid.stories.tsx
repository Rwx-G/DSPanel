import type { Meta, StoryObj } from "@storybook/react-vite";
import { PropertyGrid } from "./PropertyGrid";

const meta: Meta<typeof PropertyGrid> = {
  title: "Data/PropertyGrid",
  component: PropertyGrid,
};
export default meta;
type Story = StoryObj<typeof PropertyGrid>;

export const Default: Story = {
  args: {
    groups: [
      {
        category: "Identity",
        items: [
          { label: "Display Name", value: "John Doe" },
          { label: "Email", value: "jdoe@contoso.com" },
          { label: "Department", value: "IT" },
          { label: "Title", value: "Senior Engineer" },
        ],
      },
      {
        category: "Account Status",
        items: [
          { label: "Enabled", value: "Yes", severity: "Success" as const },
          { label: "Locked Out", value: "No" },
          { label: "Password Expired", value: "Yes", severity: "Warning" as const },
        ],
      },
    ],
  },
};
