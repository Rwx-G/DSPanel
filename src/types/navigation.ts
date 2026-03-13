import { type PermissionLevel } from "./permissions";

export interface TabItem {
  id: string;
  title: string;
  moduleId: string;
  icon?: string;
  isPinned: boolean;
}

export interface BreadcrumbSegment {
  label: string;
  navigationTarget: string;
}

export interface SidebarModule {
  id: string;
  label: string;
  icon: string;
  group: "Directory" | "Tools" | "Settings";
  requiredLevel: PermissionLevel;
}
