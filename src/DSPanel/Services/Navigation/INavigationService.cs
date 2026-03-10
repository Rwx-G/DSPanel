using System.Collections.ObjectModel;

namespace DSPanel.Services.Navigation;

/// <summary>
/// Manages tab-based navigation in the application shell.
/// </summary>
public interface INavigationService
{
    /// <summary>
    /// Collection of currently open tabs.
    /// </summary>
    ObservableCollection<Models.TabItem> Tabs { get; }

    /// <summary>
    /// Key of the currently active (selected) tab.
    /// </summary>
    string? ActiveTabKey { get; set; }

    /// <summary>
    /// Navigates to a module by its key.
    /// If a tab for the module already exists, it is activated.
    /// Otherwise a new tab is created with a placeholder content.
    /// </summary>
    void NavigateTo(string moduleKey);

    /// <summary>
    /// Opens a new tab or activates an existing one with the same key.
    /// </summary>
    void OpenTab(string key, string title, object content);

    /// <summary>
    /// Closes the tab identified by key.
    /// </summary>
    void CloseTab(string key);
}
