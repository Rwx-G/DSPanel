import type { Meta, StoryObj } from "@storybook/react-vite";
import { DialogShell } from "./DialogShell";

const meta: Meta<typeof DialogShell> = {
  title: "Dialogs/DialogShell",
  component: DialogShell,
};
export default meta;
type Story = StoryObj<typeof DialogShell>;

export const Small: Story = {
  args: {
    maxWidth: "sm",
    ariaLabel: "Small dialog",
    children: (
      <div className="p-4">
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
          Small Dialog
        </h2>
        <p className="mt-2 text-body text-[var(--color-text-secondary)]">
          This is a small dialog shell example.
        </p>
      </div>
    ),
  },
};

export const Medium: Story = {
  args: {
    maxWidth: "md",
    ariaLabel: "Medium dialog",
    children: (
      <div className="p-4">
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
          Confirmation
        </h2>
        <p className="mt-2 text-body text-[var(--color-text-secondary)]">
          Are you sure you want to proceed with this action?
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn btn-sm">Cancel</button>
          <button className="btn btn-sm btn-primary">Confirm</button>
        </div>
      </div>
    ),
  },
};
