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

    /// <summary>
    /// Registers a factory function that creates the view content for a given module key.
    /// When <see cref="NavigateTo"/> is called, the factory is invoked to produce the tab content.
    /// </summary>
    void RegisterViewFactory(string key, Func<object> factory);

    /// <summary>
    /// Moves a tab from one index to another.
    /// </summary>
    void MoveTab(int fromIndex, int toIndex);

    /// <summary>
    /// Closes all closable tabs.
    /// </summary>
    void CloseAllTabs();

    /// <summary>
    /// Closes all closable tabs except the one identified by key.
    /// </summary>
    void CloseOtherTabs(string key);

    /// <summary>
    /// Activates the next tab (wraps around).
    /// </summary>
    void ActivateNextTab();

    /// <summary>
    /// Activates the previous tab (wraps around).
    /// </summary>
    void ActivatePreviousTab();

    /// <summary>
    /// Activates the tab at the given 0-based index.
    /// </summary>
    void ActivateTabByIndex(int index);
}
