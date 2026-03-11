using CommunityToolkit.Mvvm.ComponentModel;

namespace DSPanel.Models;

/// <summary>
/// Represents a single tab in the main content area.
/// </summary>
public partial class TabItem : ObservableObject
{
    /// <summary>
    /// Unique key identifying this tab.
    /// </summary>
    [ObservableProperty]
    private string _key = string.Empty;

    /// <summary>
    /// Display title shown in the tab header.
    /// </summary>
    [ObservableProperty]
    private string _title = string.Empty;

    /// <summary>
    /// Content displayed inside the tab (typically a ViewModel or UserControl).
    /// </summary>
    [ObservableProperty]
    private object? _content;

    /// <summary>
    /// Whether this tab is currently selected.
    /// </summary>
    [ObservableProperty]
    private bool _isActive;

    /// <summary>
    /// Whether the user can close this tab. Some tabs (e.g. Welcome) may not be closable.
    /// </summary>
    [ObservableProperty]
    private bool _canClose = true;
}
