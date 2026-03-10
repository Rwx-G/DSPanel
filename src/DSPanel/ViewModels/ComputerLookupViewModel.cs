using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using DSPanel.Models;
using DSPanel.Services.Directory;
using DSPanel.Services.Network;

namespace DSPanel.ViewModels;

/// <summary>
/// ViewModel for the computer account lookup page.
/// Provides search, selection, detail display, and network diagnostics for AD computer accounts.
/// </summary>
public partial class ComputerLookupViewModel : ObservableObject
{
    private readonly IDirectoryProvider _directoryProvider;
    private readonly INetworkService _networkService;

    public ComputerLookupViewModel(
        IDirectoryProvider directoryProvider,
        INetworkService networkService)
    {
        _directoryProvider = directoryProvider;
        _networkService = networkService;
    }

    [ObservableProperty]
    private string _searchText = string.Empty;

    [ObservableProperty]
    private bool _isSearching;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(DetailItems))]
    [NotifyPropertyChangedFor(nameof(ComputerGroups))]
    [NotifyPropertyChangedFor(nameof(HasSelectedComputer))]
    private DirectoryComputer? _selectedComputer;

    [ObservableProperty]
    private string? _pingResult;

    [ObservableProperty]
    private string? _dnsResult;

    [ObservableProperty]
    private bool _isPinging;

    [ObservableProperty]
    private bool _isResolvingDns;

    public ObservableCollection<DirectoryComputer> SearchResults { get; } = [];

    /// <summary>
    /// Whether a computer is currently selected for detail display.
    /// </summary>
    public bool HasSelectedComputer => SelectedComputer is not null;

    /// <summary>
    /// Property grid items computed from the selected computer's attributes.
    /// </summary>
    public IReadOnlyList<PropertyGridItem> DetailItems
    {
        get
        {
            if (SelectedComputer is null)
                return [];

            var computer = SelectedComputer;
            return
            [
                new PropertyGridItem("Name", computer.Name, "Identity", true),
                new PropertyGridItem("DNS Host Name", computer.DnsHostName, "Identity", true),
                new PropertyGridItem("Operating System", computer.OperatingSystem, "System"),
                new PropertyGridItem("OS Version", computer.OperatingSystemVersion, "System"),
                new PropertyGridItem("Last Logon", FormatDate(computer.LastLogon), "Activity"),
                new PropertyGridItem("Distinguished Name", computer.DistinguishedName, "Directory", true),
                new PropertyGridItem("Organizational Unit", computer.OrganizationalUnit, "Directory", true),
                new PropertyGridItem("Enabled", computer.Enabled ? "Yes" : "No", "Account Status"),
            ];
        }
    }

    /// <summary>
    /// Extracted group names from the selected computer's MemberOf list.
    /// </summary>
    public IReadOnlyList<string> ComputerGroups
    {
        get
        {
            if (SelectedComputer is null)
                return [];

            return SelectedComputer.MemberOf
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
        var filter = query?.Trim() ?? SearchText.Trim();
        if (string.IsNullOrEmpty(filter))
        {
            SearchResults.Clear();
            SelectedComputer = null;
            return;
        }

        if (!_directoryProvider.IsConnected)
        {
            SearchResults.Clear();
            SelectedComputer = null;
            return;
        }

        IsSearching = true;
        try
        {
            var entries = await _directoryProvider.SearchComputersAsync(filter);
            SearchResults.Clear();
            foreach (var entry in entries)
            {
                SearchResults.Add(DirectoryComputer.FromDirectoryEntry(entry));
            }
        }
        finally
        {
            IsSearching = false;
        }
    }

    [RelayCommand]
    private void SelectComputer(DirectoryComputer? computer)
    {
        SelectedComputer = computer;
        PingResult = null;
        DnsResult = null;
    }

    [RelayCommand]
    private async Task PingAsync()
    {
        var hostName = SelectedComputer?.DnsHostName ?? SelectedComputer?.Name;
        if (string.IsNullOrWhiteSpace(hostName))
        {
            PingResult = "No host name available";
            return;
        }

        IsPinging = true;
        PingResult = null;
        try
        {
            var result = await _networkService.PingAsync(hostName);
            PingResult = result.Success
                ? $"Reply from {result.Address} - {result.RoundtripTime}ms"
                : $"Ping failed - {result.Status}";
        }
        catch (Exception ex)
        {
            PingResult = $"Ping error - {ex.InnerException?.Message ?? ex.Message}";
        }
        finally
        {
            IsPinging = false;
        }
    }

    [RelayCommand]
    private async Task DnsResolveAsync()
    {
        var hostName = SelectedComputer?.DnsHostName ?? SelectedComputer?.Name;
        if (string.IsNullOrWhiteSpace(hostName))
        {
            DnsResult = "No host name available";
            return;
        }

        IsResolvingDns = true;
        DnsResult = null;
        try
        {
            var addresses = await _networkService.DnsResolveAsync(hostName);
            DnsResult = addresses.Length > 0
                ? string.Join(", ", addresses)
                : "No addresses found";
        }
        catch (Exception ex)
        {
            DnsResult = $"DNS error - {ex.Message}";
        }
        finally
        {
            IsResolvingDns = false;
        }
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
