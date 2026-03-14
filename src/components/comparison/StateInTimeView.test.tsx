import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { StateInTimeView } from "./StateInTimeView";
import type { ReplicationMetadataResult, AttributeChangeDiff } from "@/types/replication";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
const mockInvoke = vi.mocked(invoke);

const MOCK_METADATA: ReplicationMetadataResult = {
  objectDn: "CN=Test User,OU=Users,DC=example,DC=com",
  attributes: [
    {
      attributeName: "title",
      version: 5,
      lastOriginatingChangeTime: "2026-03-01T08:00:00Z",
      lastOriginatingDsaDn: "CN=DC1,DC=example,DC=com",
      localUsn: 44444,
      originatingUsn: 33333,
    },
    {
      attributeName: "displayName",
      version: 3,
      lastOriginatingChangeTime: "2026-02-15T14:30:00Z",
      lastOriginatingDsaDn: "CN=DC1,DC=example,DC=com",
      localUsn: 67890,
      originatingUsn: 12345,
    },
    {
      attributeName: "department",
      version: 1,
      lastOriginatingChangeTime: "2026-01-10T09:00:00Z",
      lastOriginatingDsaDn: "CN=DC2,DC=example,DC=com",
      localUsn: 22222,
      originatingUsn: 11111,
    },
  ],
  isAvailable: true,
  message: null,
};

const MOCK_METADATA_UNAVAILABLE: ReplicationMetadataResult = {
  objectDn: "CN=Test,DC=example,DC=com",
  attributes: [],
  isAvailable: false,
  message: "Replication metadata not available for this object",
};

const MOCK_DIFF: AttributeChangeDiff[] = [
  {
    attributeName: "displayName",
    versionBefore: 2,
    versionAfter: 3,
    changeTime: "2026-02-15T14:30:00Z",
  },
];

describe("StateInTimeView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders load button initially", () => {
    render(
      <StateInTimeView
        objectDn="CN=Test,DC=example,DC=com"
        objectType="user"
      />,
    );
    expect(screen.getByTestId("load-metadata-button")).toBeInTheDocument();
  });

  it("loads and displays metadata", async () => {
    mockInvoke.mockResolvedValueOnce(MOCK_METADATA);

    render(
      <StateInTimeView
        objectDn="CN=Test,DC=example,DC=com"
        objectType="user"
      />,
    );

    fireEvent.click(screen.getByTestId("load-metadata-button"));

    await waitFor(() => {
      expect(screen.getByTestId("metadata-timeline")).toBeInTheDocument();
      expect(screen.getByTestId("metadata-row-title")).toBeInTheDocument();
      expect(screen.getByTestId("metadata-row-displayName")).toBeInTheDocument();
      expect(screen.getByTestId("metadata-row-department")).toBeInTheDocument();
    });
  });

  it("displays unavailable message when metadata not available", async () => {
    mockInvoke.mockResolvedValueOnce(MOCK_METADATA_UNAVAILABLE);

    render(
      <StateInTimeView
        objectDn="CN=Test,DC=example,DC=com"
        objectType="user"
      />,
    );

    fireEvent.click(screen.getByTestId("load-metadata-button"));

    await waitFor(() => {
      expect(screen.getByTestId("metadata-unavailable")).toBeInTheDocument();
    });
  });

  it("displays error on failure", async () => {
    mockInvoke.mockRejectedValueOnce("LDAP error");

    render(
      <StateInTimeView
        objectDn="CN=Test,DC=example,DC=com"
        objectType="user"
      />,
    );

    fireEvent.click(screen.getByTestId("load-metadata-button"));

    await waitFor(() => {
      expect(screen.getByTestId("metadata-error")).toBeInTheDocument();
    });
  });

  it("computes diff between timestamps", async () => {
    mockInvoke
      .mockResolvedValueOnce(MOCK_METADATA) // get_replication_metadata
      .mockResolvedValueOnce(MOCK_DIFF); // compute_attribute_diff

    render(
      <StateInTimeView
        objectDn="CN=Test,DC=example,DC=com"
        objectType="user"
      />,
    );

    fireEvent.click(screen.getByTestId("load-metadata-button"));

    await waitFor(() => {
      expect(screen.getByTestId("diff-from-select")).toBeInTheDocument();
    });

    // Select from and to
    fireEvent.change(screen.getByTestId("diff-from-select"), {
      target: { value: "2026-01-10T09:00:00Z" },
    });
    fireEvent.change(screen.getByTestId("diff-to-select"), {
      target: { value: "2026-03-01T08:00:00Z" },
    });
    fireEvent.click(screen.getByTestId("compute-diff-button"));

    await waitFor(() => {
      expect(screen.getByTestId("diff-results")).toBeInTheDocument();
      expect(screen.getByTestId("diff-row-displayName")).toBeInTheDocument();
    });
  });

  it("shows empty diff message when no changes", async () => {
    mockInvoke
      .mockResolvedValueOnce(MOCK_METADATA)
      .mockResolvedValueOnce([]); // empty diff

    render(
      <StateInTimeView
        objectDn="CN=Test,DC=example,DC=com"
        objectType="user"
      />,
    );

    fireEvent.click(screen.getByTestId("load-metadata-button"));

    await waitFor(() => {
      expect(screen.getByTestId("diff-from-select")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId("diff-from-select"), {
      target: { value: "2026-01-10T09:00:00Z" },
    });
    fireEvent.change(screen.getByTestId("diff-to-select"), {
      target: { value: "2026-03-01T08:00:00Z" },
    });
    fireEvent.click(screen.getByTestId("compute-diff-button"));

    await waitFor(() => {
      expect(screen.getByTestId("diff-results")).toBeInTheDocument();
      expect(screen.getByText(/No attribute changes/)).toBeInTheDocument();
    });
  });
});
