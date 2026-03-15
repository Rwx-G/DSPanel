import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { TreeView, type TreeNode } from "./TreeView";

const meta: Meta<typeof TreeView> = {
  title: "Data/TreeView",
  component: TreeView,
};
export default meta;
type Story = StoryObj<typeof TreeView>;

const SAMPLE_NODES: TreeNode[] = [
  {
    id: "users",
    label: "Users",
    children: [
      { id: "it", label: "IT" },
      { id: "hr", label: "HR" },
      {
        id: "engineering",
        label: "Engineering",
        children: [
          { id: "frontend", label: "Frontend" },
          { id: "backend", label: "Backend" },
        ],
      },
    ],
  },
  {
    id: "computers",
    label: "Computers",
    children: [
      { id: "workstations", label: "Workstations" },
      { id: "servers", label: "Servers" },
    ],
  },
  { id: "groups", label: "Groups" },
];

export const Default: Story = {
  render: () => {
    const [selected, setSelected] = useState(new Set<string>());
    return (
      <div className="w-64">
        <TreeView
          nodes={SAMPLE_NODES}
          selectedIds={selected}
          onSelect={(id) => setSelected(new Set([id]))}
        />
      </div>
    );
  },
};
