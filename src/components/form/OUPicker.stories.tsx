import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { OUPicker, type OUNode } from "./OUPicker";

const meta: Meta<typeof OUPicker> = {
  title: "Form/OUPicker",
  component: OUPicker,
};
export default meta;
type Story = StoryObj<typeof OUPicker>;

const SAMPLE_TREE: OUNode[] = [
  {
    distinguishedName: "OU=Users,DC=contoso,DC=com",
    name: "Users",
    hasChildren: true,
    children: [
      { distinguishedName: "OU=IT,OU=Users,DC=contoso,DC=com", name: "IT" },
      { distinguishedName: "OU=HR,OU=Users,DC=contoso,DC=com", name: "HR" },
      {
        distinguishedName: "OU=Finance,OU=Users,DC=contoso,DC=com",
        name: "Finance",
      },
    ],
  },
  {
    distinguishedName: "OU=Computers,DC=contoso,DC=com",
    name: "Computers",
    hasChildren: true,
    children: [
      {
        distinguishedName: "OU=Workstations,OU=Computers,DC=contoso,DC=com",
        name: "Workstations",
      },
      {
        distinguishedName: "OU=Servers,OU=Computers,DC=contoso,DC=com",
        name: "Servers",
      },
    ],
  },
  {
    distinguishedName: "OU=Groups,DC=contoso,DC=com",
    name: "Groups",
  },
];

export const Default: Story = {
  render: () => {
    const [selected, setSelected] = useState<string | undefined>();
    return (
      <div className="w-80">
        <OUPicker
          nodes={SAMPLE_TREE}
          selectedOU={selected}
          onSelect={setSelected}
        />
      </div>
    );
  },
};

export const Loading: Story = {
  args: { nodes: [], loading: true, onSelect: () => {} },
};

export const Error: Story = {
  args: { nodes: [], error: true, onSelect: () => {} },
};

export const Empty: Story = {
  args: { nodes: [], onSelect: () => {} },
};
