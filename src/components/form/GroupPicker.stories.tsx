import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { GroupPicker, type GroupOption } from "./GroupPicker";

const meta: Meta<typeof GroupPicker> = {
  title: "Form/GroupPicker",
  component: GroupPicker,
};
export default meta;
type Story = StoryObj<typeof GroupPicker>;

const SAMPLE_GROUPS: GroupOption[] = [
  { distinguishedName: "CN=IT-Admins,OU=Groups,DC=contoso,DC=com", name: "IT-Admins", description: "IT administrators group" },
  { distinguishedName: "CN=Dev-Frontend,OU=Groups,DC=contoso,DC=com", name: "Dev-Frontend", description: "Frontend developers" },
  { distinguishedName: "CN=Dev-Backend,OU=Groups,DC=contoso,DC=com", name: "Dev-Backend", description: "Backend developers" },
  { distinguishedName: "CN=Finance-Analysts,OU=Groups,DC=contoso,DC=com", name: "Finance-Analysts" },
  { distinguishedName: "CN=Sales-EMEA,OU=Groups,DC=contoso,DC=com", name: "Sales-EMEA" },
];

export const Default: Story = {
  render: () => {
    const [selected, setSelected] = useState<GroupOption[]>([]);
    return (
      <div className="w-96">
        <GroupPicker
          selectedGroups={selected}
          onSelectionChange={setSelected}
          onSearch={async (q) =>
            SAMPLE_GROUPS.filter((g) =>
              g.name.toLowerCase().includes(q.toLowerCase()),
            )
          }
        />
      </div>
    );
  },
};

export const WithPreselected: Story = {
  render: () => {
    const [selected, setSelected] = useState<GroupOption[]>([
      SAMPLE_GROUPS[0],
      SAMPLE_GROUPS[2],
    ]);
    return (
      <div className="w-96">
        <GroupPicker
          selectedGroups={selected}
          onSelectionChange={setSelected}
          onSearch={async (q) =>
            SAMPLE_GROUPS.filter((g) =>
              g.name.toLowerCase().includes(q.toLowerCase()),
            )
          }
        />
      </div>
    );
  },
};

export const Disabled: Story = {
  args: {
    selectedGroups: [SAMPLE_GROUPS[0]],
    onSelectionChange: () => {},
    onSearch: async () => [],
    disabled: true,
  },
};
