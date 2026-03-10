using DSPanel.Services.Permissions;

namespace DSPanel.Models;

/// <summary>
/// Represents a navigation entry in the sidebar.
/// </summary>
public class SidebarItem
{
    /// <summary>
    /// Unique key used for navigation (e.g. "users", "computers").
    /// </summary>
    public string Key { get; init; } = string.Empty;

    /// <summary>
    /// Display label shown in the sidebar.
    /// </summary>
    public string Label { get; init; } = string.Empty;

    /// <summary>
    /// Resource key for the icon geometry (e.g. "IconUser").
    /// </summary>
    public string IconGeometryKey { get; init; } = string.Empty;

    /// <summary>
    /// Category used to group items in the sidebar.
    /// </summary>
    public string Category { get; init; } = string.Empty;

    /// <summary>
    /// Minimum permission level required to see this item.
    /// Null means visible to everyone.
    /// </summary>
    public PermissionLevel? RequiredPermission { get; init; }
}
