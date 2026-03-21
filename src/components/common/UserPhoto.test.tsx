import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { UserPhoto } from "./UserPhoto";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
const mockInvoke = vi.mocked(invoke);

describe("UserPhoto", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows placeholder avatar when no photo is returned", async () => {
    mockInvoke.mockResolvedValueOnce(null);
    render(
      <UserPhoto
        userDn="CN=John,OU=Users,DC=example,DC=com"
        displayName="John Doe"
        canEdit={false}
      />,
    );

    await waitFor(() => {
      expect(screen.queryByTestId("user-photo-loading")).not.toBeInTheDocument();
    });

    expect(screen.getByTestId("avatar")).toBeInTheDocument();
    expect(screen.getByTestId("avatar-initials")).toBeInTheDocument();
  });

  it("shows photo when base64 is returned", async () => {
    mockInvoke.mockResolvedValueOnce("dGVzdA==");
    render(
      <UserPhoto
        userDn="CN=John,OU=Users,DC=example,DC=com"
        displayName="John Doe"
        canEdit={false}
      />,
    );

    await waitFor(() => {
      expect(screen.queryByTestId("user-photo-loading")).not.toBeInTheDocument();
    });

    expect(screen.getByTestId("avatar-image")).toBeInTheDocument();
    expect(screen.getByTestId("avatar-image")).toHaveAttribute(
      "src",
      "data:image/jpeg;base64,dGVzdA==",
    );
  });

  it("hides upload button when canEdit is false", async () => {
    mockInvoke.mockResolvedValueOnce(null);
    render(
      <UserPhoto
        userDn="CN=John,OU=Users,DC=example,DC=com"
        displayName="John Doe"
        canEdit={false}
      />,
    );

    await waitFor(() => {
      expect(screen.queryByTestId("user-photo-loading")).not.toBeInTheDocument();
    });

    expect(screen.queryByTestId("upload-photo-btn")).not.toBeInTheDocument();
  });

  it("shows upload button when canEdit is true", async () => {
    mockInvoke.mockResolvedValueOnce(null);
    render(
      <UserPhoto
        userDn="CN=John,OU=Users,DC=example,DC=com"
        displayName="John Doe"
        canEdit={true}
      />,
    );

    await waitFor(() => {
      expect(screen.queryByTestId("user-photo-loading")).not.toBeInTheDocument();
    });

    expect(screen.getByTestId("upload-photo-btn")).toBeInTheDocument();
    expect(screen.getByTestId("upload-photo-btn")).toHaveTextContent(
      "Upload Photo",
    );
  });

  it("shows remove button only when photo exists and canEdit", async () => {
    mockInvoke.mockResolvedValueOnce("dGVzdA==");
    render(
      <UserPhoto
        userDn="CN=John,OU=Users,DC=example,DC=com"
        displayName="John Doe"
        canEdit={true}
      />,
    );

    await waitFor(() => {
      expect(screen.queryByTestId("user-photo-loading")).not.toBeInTheDocument();
    });

    expect(screen.getByTestId("remove-photo-btn")).toBeInTheDocument();
    expect(screen.getByTestId("upload-photo-btn")).toHaveTextContent(
      "Change Photo",
    );
  });

  it("hides remove button when no photo exists", async () => {
    mockInvoke.mockResolvedValueOnce(null);
    render(
      <UserPhoto
        userDn="CN=John,OU=Users,DC=example,DC=com"
        displayName="John Doe"
        canEdit={true}
      />,
    );

    await waitFor(() => {
      expect(screen.queryByTestId("user-photo-loading")).not.toBeInTheDocument();
    });

    expect(screen.queryByTestId("remove-photo-btn")).not.toBeInTheDocument();
  });

  it("shows loading state on mount", () => {
    mockInvoke.mockReturnValue(new Promise(() => {})); // Never resolves
    render(
      <UserPhoto
        userDn="CN=John,OU=Users,DC=example,DC=com"
        displayName="John Doe"
        canEdit={false}
      />,
    );

    expect(screen.getByTestId("user-photo-loading")).toBeInTheDocument();
  });

  it("calls remove_thumbnail_photo when remove is clicked", async () => {
    mockInvoke.mockResolvedValueOnce("dGVzdA=="); // get
    render(
      <UserPhoto
        userDn="CN=John,OU=Users,DC=example,DC=com"
        displayName="John Doe"
        canEdit={true}
      />,
    );

    await waitFor(() => {
      expect(screen.queryByTestId("user-photo-loading")).not.toBeInTheDocument();
    });

    mockInvoke.mockResolvedValueOnce(undefined); // remove
    fireEvent.click(screen.getByTestId("remove-photo-btn"));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("remove_thumbnail_photo", {
        userDn: "CN=John,OU=Users,DC=example,DC=com",
      });
    });
  });

  it("calls get_thumbnail_photo on mount", async () => {
    mockInvoke.mockResolvedValueOnce(null);
    render(
      <UserPhoto
        userDn="CN=John,OU=Users,DC=example,DC=com"
        displayName="John Doe"
        canEdit={false}
      />,
    );

    expect(mockInvoke).toHaveBeenCalledWith("get_thumbnail_photo", {
      userDn: "CN=John,OU=Users,DC=example,DC=com",
    });
  });

  it("uses custom size prop", async () => {
    mockInvoke.mockResolvedValueOnce(null);
    render(
      <UserPhoto
        userDn="CN=John,OU=Users,DC=example,DC=com"
        displayName="John Doe"
        canEdit={false}
        size={64}
      />,
    );

    await waitFor(() => {
      expect(screen.queryByTestId("user-photo-loading")).not.toBeInTheDocument();
    });

    expect(screen.getByTestId("avatar")).toHaveStyle({
      width: "64px",
      height: "64px",
    });
  });
});
