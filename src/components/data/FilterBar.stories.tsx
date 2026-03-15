import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { FilterBar, type FilterChip } from "./FilterBar";

const meta: Meta<typeof FilterBar> = {
  title: "Data/FilterBar",
  component: FilterBar,
};
export default meta;
type Story = StoryObj<typeof FilterBar>;

export const Default: Story = {
  render: () => {
    const [filters, setFilters] = useState<FilterChip[]>([]);
    return (
      <FilterBar
        filters={filters}
        onFilterChange={setFilters}
        onTextFilter={() => {}}
        placeholder="Filter results..."
      />
    );
  },
};

export const WithActiveFilters: Story = {
  render: () => {
    const [filters, setFilters] = useState<FilterChip[]>([
      { id: "1", label: "Department: IT", field: "department", value: "IT" },
      { id: "2", label: "Status: Active", field: "status", value: "Active" },
    ]);
    return (
      <FilterBar
        filters={filters}
        onFilterChange={setFilters}
        onTextFilter={() => {}}
        placeholder="Filter results..."
      />
    );
  },
};
