using System.Collections.ObjectModel;
using Microsoft.Extensions.Logging;

namespace DSPanel.Services.Navigation;

/// <summary>
/// Default implementation of <see cref="INavigationService"/>.
/// Manages tab lifecycle - opening, closing, and activating tabs.
/// </summary>
public class NavigationService : INavigationService
{
    private readonly ILogger<NavigationService> _logger;

    public NavigationService(ILogger<NavigationService> logger)
    {
        _logger = logger;
    }

    public ObservableCollection<Models.TabItem> Tabs { get; } = [];

    private string? _activeTabKey;

    public string? ActiveTabKey
    {
        get => _activeTabKey;
        set
        {
            if (_activeTabKey == value)
                return;

            _activeTabKey = value;

            foreach (var tab in Tabs)
                tab.IsActive = tab.Key == value;
        }
    }

    /// <summary>
    /// Maps well-known module keys to display titles.
    /// </summary>
    private static readonly Dictionary<string, string> ModuleTitles = new(StringComparer.OrdinalIgnoreCase)
    {
        ["users"] = "Users",
        ["computers"] = "Computers",
        ["groups"] = "Groups",
        ["presets"] = "Presets",
        ["security"] = "Security Dashboard",
        ["infrastructure"] = "Infrastructure",
        ["settings"] = "Settings"
    };

    private readonly Dictionary<string, Func<object>> _viewFactories = new(StringComparer.OrdinalIgnoreCase);

    public void RegisterViewFactory(string key, Func<object> factory)
    {
        _viewFactories[key] = factory;
    }

    public void NavigateTo(string moduleKey)
    {
        var title = ModuleTitles.TryGetValue(moduleKey, out var t)
            ? t
            : moduleKey;

        // Use registered factory if available, otherwise fall back to placeholder
        var content = _viewFactories.TryGetValue(moduleKey, out var factory)
            ? factory()
            : (object)$"Module: {title}";

        OpenTab(moduleKey, title, content);
        _logger.LogDebug("Navigated to module {ModuleKey}", moduleKey);
    }

    public void OpenTab(string key, string title, object content)
    {
        var existing = Tabs.FirstOrDefault(t =>
            string.Equals(t.Key, key, StringComparison.OrdinalIgnoreCase));

        if (existing is not null)
        {
            ActiveTabKey = existing.Key;
            _logger.LogDebug("Activated existing tab {TabKey}", key);
            return;
        }

        var tab = new Models.TabItem
        {
            Key = key,
            Title = title,
            Content = content,
            CanClose = true
        };

        Tabs.Add(tab);
        ActiveTabKey = key;
        _logger.LogDebug("Opened new tab {TabKey}", key);
    }

    public void CloseTab(string key)
    {
        var tab = Tabs.FirstOrDefault(t =>
            string.Equals(t.Key, key, StringComparison.OrdinalIgnoreCase));

        if (tab is null)
            return;

        var index = Tabs.IndexOf(tab);
        Tabs.Remove(tab);

        _logger.LogDebug("Closed tab {TabKey}", key);

        // Activate an adjacent tab if the closed one was active
        if (ActiveTabKey == key && Tabs.Count > 0)
        {
            var newIndex = Math.Min(index, Tabs.Count - 1);
            ActiveTabKey = Tabs[newIndex].Key;
        }
        else if (Tabs.Count == 0)
        {
            ActiveTabKey = null;
        }
    }

    public void MoveTab(int fromIndex, int toIndex)
    {
        if (fromIndex < 0 || fromIndex >= Tabs.Count ||
            toIndex < 0 || toIndex >= Tabs.Count ||
            fromIndex == toIndex)
            return;

        Tabs.Move(fromIndex, toIndex);
        _logger.LogDebug("Moved tab from index {From} to {To}", fromIndex, toIndex);
    }
}
