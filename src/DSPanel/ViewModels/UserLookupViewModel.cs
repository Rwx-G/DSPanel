using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using DSPanel.Helpers;
using DSPanel.Models;
using DSPanel.Services.Directory;
using DSPanel.Services.Health;

namespace DSPanel.ViewModels;

/// <summary>
/// ViewModel for the user account lookup page.
/// Provides search, selection, and detail display for AD user accounts.
/// </summary>
public partial class UserLookupViewModel : ObservableObject
{
    private readonly IDirectoryProvider _directoryProvider;
    private readonly IHealthCheckService _healthCheckService;

    public UserLookupViewModel(
        IDirectoryProvider directoryProvider,
        IHealthCheckService healthCheckService)
    {
        _directoryProvider = directoryProvider;
        _healthCheckService = healthCheckService;
    }

    [ObservableProperty]
    private string _searchText = string.Empty;

    [ObservableProperty]
    private bool _isSearching;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(DetailItems))]
    [NotifyPropertyChangedFor(nameof(UserGroups))]
    [NotifyPropertyChangedFor(nameof(HealthStatus))]
    [NotifyPropertyChangedFor(nameof(HasSelectedUser))]
    private DirectoryUser? _selectedUser;

    public ObservableCollection<DirectoryUser> SearchResults { get; } = [];

    /// <summary>
    /// Whether a user is currently selected for detail display.
    /// </summary>
    public bool HasSelectedUser => SelectedUser is not null;

    /// <summary>
    /// Health status of the currently selected user.
    /// </summary>
    public AccountHealthStatus? HealthStatus =>
        SelectedUser is not null ? _healthCheckService.Evaluate(SelectedUser) : null;

    /// <summary>
    /// Property grid items computed from the selected user's attributes.
    /// </summary>
    public IReadOnlyList<PropertyGridItem> DetailItems
    {
        get
        {
            if (SelectedUser is null)
                return [];

            var user = SelectedUser;
            return
            [
                new PropertyGridItem("SAM Account Name", user.SamAccountName, "Identity", true),
                new PropertyGridItem("User Principal Name", user.UserPrincipalName, "Identity", true),
                new PropertyGridItem("Display Name", user.DisplayName, "Identity"),
                new PropertyGridItem("Given Name", user.GivenName, "Identity"),
                new PropertyGridItem("Surname", user.Surname, "Identity"),
                new PropertyGridItem("Email", user.Email, "Identity", true),
                new PropertyGridItem("Department", user.Department, "Organization"),
                new PropertyGridItem("Title", user.Title, "Organization"),
                new PropertyGridItem("Distinguished Name", user.DistinguishedName, "Directory", true),
                new PropertyGridItem("Organizational Unit", user.OrganizationalUnit, "Directory", true),
                new PropertyGridItem("Enabled", user.Enabled ? "Yes" : "No", "Account Status"),
                new PropertyGridItem("Locked Out", user.LockedOut ? "Yes" : "No", "Account Status"),
                new PropertyGridItem("Account Expires", FormatDate(user.AccountExpires), "Account Status"),
                new PropertyGridItem("Password Last Set", FormatDate(user.PasswordLastSet), "Password"),
                new PropertyGridItem("Password Expired", user.PasswordExpired ? "Yes" : "No", "Password"),
                new PropertyGridItem("Password Never Expires", user.PasswordNeverExpires ? "Yes" : "No", "Password"),
                new PropertyGridItem("Last Logon", FormatDate(user.LastLogon), "Activity"),
                new PropertyGridItem("Last Logon Workstation", user.LastLogonWorkstation, "Activity"),
                new PropertyGridItem("Bad Password Count", user.BadPasswordCount.ToString(), "Activity"),
                new PropertyGridItem("Created", FormatDate(user.WhenCreated), "Metadata"),
                new PropertyGridItem("Last Modified", FormatDate(user.WhenChanged), "Metadata"),
            ];
        }
    }

    /// <summary>
    /// Extracted group names from the selected user's MemberOf list.
    /// </summary>
    public IReadOnlyList<string> UserGroups
    {
        get
        {
            if (SelectedUser is null)
                return [];

            return SelectedUser.MemberOf
                .Select(ExtractCnFromDn)
                .Where(cn => cn is not null)
                .Select(cn => cn!)
                .OrderBy(cn => cn, StringComparer.OrdinalIgnoreCase)
                .ToList();
        }
    }

    [RelayCommand]
    private async Task SearchAsync(string? query)
    {
        var filter = LdapFilterHelper.ValidateSearchInput(query ?? SearchText);
        if (filter is null)
        {
            SearchResults.Clear();
            SelectedUser = null;
            return;
        }

        if (!_directoryProvider.IsConnected)
        {
            SearchResults.Clear();
            SelectedUser = null;
            return;
        }

        IsSearching = true;
        try
        {
            var entries = await _directoryProvider.SearchUsersAsync(filter);
            SearchResults.Clear();
            foreach (var entry in entries)
            {
                SearchResults.Add(DirectoryUser.FromDirectoryEntry(entry));
            }
        }
        finally
        {
            IsSearching = false;
        }
    }

    [RelayCommand]
    private void SelectUser(DirectoryUser? user)
    {
        SelectedUser = user;
    }

    private static string FormatDate(DateTime? date)
    {
        return date?.ToString("yyyy-MM-dd HH:mm:ss") ?? "-";
    }

    /// <summary>
    /// Extracts the CN (common name) from a distinguished name string.
    /// </summary>
    private static string? ExtractCnFromDn(string dn)
    {
        if (string.IsNullOrWhiteSpace(dn))
            return null;

        if (!dn.StartsWith("CN=", StringComparison.OrdinalIgnoreCase))
            return dn;

        var commaIndex = dn.IndexOf(',');
        return commaIndex > 3 ? dn[3..commaIndex] : dn[3..];
    }
}
