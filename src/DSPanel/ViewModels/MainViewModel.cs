using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using DSPanel.Models;
using DSPanel.Services.Dialog;
using DSPanel.Services.Directory;
using DSPanel.Services.Navigation;
using DSPanel.Services.Notifications;
using DSPanel.Services.Permissions;
using DSPanel.Services.Theme;

namespace DSPanel.ViewModels;

public partial class MainViewModel : ObservableObject
{
    private readonly INavigationService _navigationService;
    private readonly IPermissionService _permissionService;
    private readonly IThemeService _themeService;
    private readonly IDirectoryProvider _directoryProvider;
    private readonly IDialogService _dialogService;
    private readonly INotificationService _notificationService;

    public MainViewModel(
        INavigationService navigationService,
        IPermissionService permissionService,
        IThemeService themeService,
        IDirectoryProvider directoryProvider,
        IDialogService dialogService,
        INotificationService notificationService)
    {
        _navigationService = navigationService;
        _permissionService = permissionService;
        _themeService = themeService;
        _directoryProvider = directoryProvider;
        _dialogService = dialogService;
        _notificationService = notificationService;

        BuildSidebarItems();
    }

    // ---- Window title ----

    [ObservableProperty]
    private string _title = "DSPanel";

    // ---- Sidebar ----

    [ObservableProperty]
    private bool _isSidebarExpanded = true;

    public ObservableCollection<SidebarItem> SidebarItems { get; } = [];

    /// <summary>
    /// Ordered list of category names for sidebar grouping.
    /// </summary>
    public static IReadOnlyList<string> SidebarCategories { get; } =
    [
        "Lookup",
        "Management",
        "Security",
        "Infrastructure",
        "Settings"
    ];

    // ---- Tabs (delegated to NavigationService) ----

    public ObservableCollection<Models.TabItem> Tabs => _navigationService.Tabs;

    public string? ActiveTabKey
    {
        get => _navigationService.ActiveTabKey;
        set
        {
            if (_navigationService.ActiveTabKey == value)
                return;
            _navigationService.ActiveTabKey = value;
            OnPropertyChanged();
        }
    }

    /// <summary>
    /// Index of the selected tab, for two-way binding with TabControl.SelectedIndex.
    /// </summary>
    public int SelectedTabIndex
    {
        get
        {
            if (ActiveTabKey is null)
                return -1;

            for (var i = 0; i < Tabs.Count; i++)
            {
                if (string.Equals(Tabs[i].Key, ActiveTabKey, StringComparison.OrdinalIgnoreCase))
                    return i;
            }

            return -1;
        }
        set
        {
            if (value >= 0 && value < Tabs.Count)
            {
                ActiveTabKey = Tabs[value].Key;
            }
        }
    }

    // ---- Status bar ----

    public string DomainName => _directoryProvider.DomainName ?? "-";

    public string ConnectedDc => _directoryProvider.ConnectedDc ?? "-";

    public PermissionLevel PermissionLevel => _permissionService.CurrentLevel;

    public bool IsConnected => _directoryProvider.IsConnected;

    // ---- Commands ----

    [RelayCommand]
    private void ToggleTheme()
    {
        _themeService.ToggleTheme();
    }

    [RelayCommand]
    private void ToggleSidebar()
    {
        IsSidebarExpanded = !IsSidebarExpanded;
    }

    [RelayCommand]
    private void Navigate(string key)
    {
        _navigationService.NavigateTo(key);
        OnPropertyChanged(nameof(ActiveTabKey));
        OnPropertyChanged(nameof(SelectedTabIndex));
    }

    [RelayCommand]
    private void CloseTab(string key)
    {
        _navigationService.CloseTab(key);
        OnPropertyChanged(nameof(ActiveTabKey));
        OnPropertyChanged(nameof(SelectedTabIndex));
    }

    public void MoveTab(int fromIndex, int toIndex)
    {
        _navigationService.MoveTab(fromIndex, toIndex);
        OnPropertyChanged(nameof(SelectedTabIndex));
    }

    // ---- Private helpers ----

    private void BuildSidebarItems()
    {
        var allItems = new List<SidebarItem>
        {
            // Lookup
            new() { Key = "users", Label = "Users", IconGeometryKey = "IconUser", Category = "Lookup" },
            new() { Key = "computers", Label = "Computers", IconGeometryKey = "IconComputer", Category = "Lookup" },

            // Management
            new() { Key = "groups", Label = "Groups", IconGeometryKey = "IconGroup", Category = "Management",
                     RequiredPermission = PermissionLevel.AccountOperator },
            new() { Key = "presets", Label = "Presets", IconGeometryKey = "IconSettings", Category = "Management",
                     RequiredPermission = PermissionLevel.AccountOperator },

            // Security
            new() { Key = "security", Label = "Security Dashboard", IconGeometryKey = "IconLock", Category = "Security",
                     RequiredPermission = PermissionLevel.DomainAdmin },

            // Infrastructure
            new() { Key = "infrastructure", Label = "Infrastructure", IconGeometryKey = "IconDomain", Category = "Infrastructure",
                     RequiredPermission = PermissionLevel.DomainAdmin },

            // Settings
            new() { Key = "settings", Label = "Settings", IconGeometryKey = "IconSettings", Category = "Settings" }
        };

        foreach (var item in allItems)
        {
            if (item.RequiredPermission is null ||
                _permissionService.HasPermission(item.RequiredPermission.Value))
            {
                SidebarItems.Add(item);
            }
        }
    }
}
