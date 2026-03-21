import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { type ReactNode } from "react";
import { MoveObjectDialog, type MoveTarget } from "./MoveObjectDialog";
import { NotificationProvider } from "@/contexts/NotificationContext";

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

vi.mock("@/hooks/useOUTree", () => ({
  useOUTree: () => ({
    nodes: [
      {
        distinguishedName: "OU=Sales,DC=example,DC=com",
        name: "Sales",
        children: [],
        hasChildren: false,
      },
      {
        distinguishedName: "OU=Engineering,DC=example,DC=com",
        name: "Engineering",
        children: [],
        hasChildren: false,
      },
    ],
    loading: false,
    error: false,
    reload: vi.fn(),
  }),
}));

vi.mock("@/hooks/useErrorHandler", () => ({
  useErrorHandler: () => ({
    handleError: vi.fn(),
  }),
}));

function Wrapper({ children }: { children: ReactNode }) {
  return <NotificationProvider>{children}</NotificationProvider>;
}

const defaultTargets: MoveTarget[] = [
  {
    distinguishedName: "CN=John Doe,OU=Users,DC=example,DC=com",
    displayName: "John Doe",
  },
];

describe("MoveObjectDialog", () => {
  const onClose = vi.fn();
  const onMoved = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockResolvedValue(null);
  });

  function renderDialog(targets = defaultTargets) {
    return render(
      <MoveObjectDialog targets={targets} onClose={onClose} onMoved={onMoved} />,
      { wrapper: Wrapper },
    );
  }

  it("renders with the object name in the title", () => {
    renderDialog();
    expect(screen.getByTestId("move-dialog-title")).toHaveTextContent(
      "Move John Doe",
    );
  });

  it("shows bulk title when multiple targets", () => {
    renderDialog([
      ...defaultTargets,
      {
        distinguishedName: "CN=Jane,OU=Users,DC=example,DC=com",
        displayName: "Jane",
      },
    ]);
    expect(screen.getByTestId("move-dialog-title")).toHaveTextContent(
      "Move 2 Objects",
    );
  });

  it("renders OU picker in pick step", () => {
    renderDialog();
    expect(screen.getByTestId("ou-picker")).toBeInTheDocument();
  });

  it("enables Next button when current OU is pre-selected", () => {
    renderDialog();
    // The dialog pre-selects the current parent OU from the target's DN
    expect(screen.getByTestId("move-next")).not.toBeDisabled();
  });

  it("enables Next button when an OU is selected", () => {
    renderDialog();
    fireEvent.click(screen.getByText("Sales"));
    expect(screen.getByTestId("move-next")).not.toBeDisabled();
  });

  it("shows preview step after clicking Next", () => {
    renderDialog();
    fireEvent.click(screen.getByText("Sales"));
    fireEvent.click(screen.getByTestId("move-next"));
    expect(screen.getByTestId("move-preview-item")).toBeInTheDocument();
    expect(screen.getByText(/From:/)).toBeInTheDocument();
    expect(screen.getByText(/To:/)).toBeInTheDocument();
  });

  it("calls move_object and closes on execute for single target", async () => {
    renderDialog();
    fireEvent.click(screen.getByText("Sales"));
    fireEvent.click(screen.getByTestId("move-next"));
    fireEvent.click(screen.getByTestId("move-execute"));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("move_object", {
        objectDn: "CN=John Doe,OU=Users,DC=example,DC=com",
        targetContainerDn: "OU=Sales,DC=example,DC=com",
      });
    });
    await waitFor(() => {
      expect(onMoved).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("calls bulk_move_objects for multiple targets", async () => {
    mockInvoke.mockResolvedValueOnce([
      { objectDn: "CN=John Doe,OU=Users,DC=example,DC=com", success: true, error: null },
      { objectDn: "CN=Jane,OU=Users,DC=example,DC=com", success: true, error: null },
    ]);
    const targets = [
      ...defaultTargets,
      {
        distinguishedName: "CN=Jane,OU=Users,DC=example,DC=com",
        displayName: "Jane",
      },
    ];
    renderDialog(targets);
    fireEvent.click(screen.getByText("Engineering"));
    fireEvent.click(screen.getByTestId("move-next"));
    fireEvent.click(screen.getByTestId("move-execute"));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("bulk_move_objects", {
        objectDns: [
          "CN=John Doe,OU=Users,DC=example,DC=com",
          "CN=Jane,OU=Users,DC=example,DC=com",
        ],
        targetContainerDn: "OU=Engineering,DC=example,DC=com",
      });
    });
  });

  it("calls onClose when Cancel is clicked", () => {
    renderDialog();
    fireEvent.click(screen.getByTestId("move-cancel"));
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose on Escape key", () => {
    renderDialog();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("goes back to pick step when Back is clicked", () => {
    renderDialog();
    fireEvent.click(screen.getByText("Sales"));
    fireEvent.click(screen.getByTestId("move-next"));
    expect(screen.getByTestId("move-execute")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("move-back"));
    expect(screen.getByTestId("ou-picker")).toBeInTheDocument();
  });
});
