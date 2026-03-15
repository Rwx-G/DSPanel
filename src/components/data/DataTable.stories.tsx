import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { DataTable, type SortState } from "./DataTable";

const meta: Meta = {
  title: "Data/DataTable",
};
export default meta;

interface User {
  name: string;
  email: string;
  department: string;
  status: string;
}

const COLUMNS = [
  { key: "name" as const, header: "Name", sortable: true },
  { key: "email" as const, header: "Email", sortable: true },
  { key: "department" as const, header: "Department", sortable: true },
  { key: "status" as const, header: "Status" },
];

const SAMPLE_DATA: User[] = [
  {
    name: "John Doe",
    email: "jdoe@contoso.com",
    department: "IT",
    status: "Active",
  },
  {
    name: "Alice Smith",
    email: "asmith@contoso.com",
    department: "HR",
    status: "Active",
  },
  {
    name: "Bob Wilson",
    email: "bwilson@contoso.com",
    department: "Finance",
    status: "Disabled",
  },
  {
    name: "Carol Davis",
    email: "cdavis@contoso.com",
    department: "Sales",
    status: "Active",
  },
  {
    name: "Dan Brown",
    email: "dbrown@contoso.com",
    department: "Engineering",
    status: "Locked",
  },
];

export const Default: StoryObj = {
  render: () => {
    const [sort, setSort] = useState<SortState<User> | undefined>();
    const sorted = sort
      ? [...SAMPLE_DATA].sort((a, b) => {
          const v = a[sort.key].localeCompare(b[sort.key]);
          return sort.direction === "asc" ? v : -v;
        })
      : SAMPLE_DATA;
    return (
      <DataTable
        columns={COLUMNS}
        data={sorted}
        rowKey={(r) => r.email}
        sortState={sort}
        onSort={(key, dir) => setSort({ key, direction: dir })}
      />
    );
  },
};

export const WithCsvExport: StoryObj = {
  render: () => (
    <DataTable
      columns={COLUMNS}
      data={SAMPLE_DATA}
      rowKey={(r) => r.email}
      csvFilename="users-export.csv"
    />
  ),
};

export const Loading: StoryObj = {
  render: () => (
    <DataTable
      columns={COLUMNS}
      data={[]}
      rowKey={(r: User) => r.email}
      loading
    />
  ),
};

export const Empty: StoryObj = {
  render: () => (
    <DataTable
      columns={COLUMNS}
      data={[]}
      rowKey={(r: User) => r.email}
      emptyMessage="No users match your search"
    />
  ),
};
