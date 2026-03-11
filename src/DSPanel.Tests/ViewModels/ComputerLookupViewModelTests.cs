using DSPanel.Models;
using DSPanel.Services.Directory;
using DSPanel.Services.Network;
using DSPanel.ViewModels;
using FluentAssertions;
using Moq;

namespace DSPanel.Tests.ViewModels;

public class ComputerLookupViewModelTests
{
    private readonly Mock<IDirectoryProvider> _directoryProvider = new();
    private readonly Mock<INetworkService> _networkService = new();

    private ComputerLookupViewModel CreateViewModel() =>
        new(_directoryProvider.Object, _networkService.Object);

    private static DirectoryEntry CreateComputerEntry(
        string name = "WKS001",
        string os = "Windows 11 Enterprise",
        string[]? memberOf = null)
    {
        return new DirectoryEntry
        {
            DistinguishedName = $"CN={name},OU=Computers,DC=contoso,DC=com",
            SamAccountName = $"{name}$",
            DisplayName = name,
            ObjectClass = "computer",
            Attributes = new Dictionary<string, string[]>
            {
                ["cn"] = [name],
                ["dNSHostName"] = [$"{name}.contoso.com"],
                ["operatingSystem"] = [os],
                ["operatingSystemVersion"] = ["10.0 (22631)"],
                ["userAccountControl"] = ["4096"], // Workstation trust account, enabled
                ["memberOf"] = memberOf ?? ["CN=Domain Computers,OU=Groups,DC=contoso,DC=com"]
            }
        };
    }

    private static DirectoryEntry CreateComputerEntryNoDns(string name = "WKS001")
    {
        return new DirectoryEntry
        {
            DistinguishedName = $"CN={name},OU=Computers,DC=contoso,DC=com",
            SamAccountName = $"{name}$",
            DisplayName = name,
            ObjectClass = "computer",
            Attributes = new Dictionary<string, string[]>
            {
                ["cn"] = [name],
                ["operatingSystem"] = ["Windows 11 Enterprise"],
                ["operatingSystemVersion"] = ["10.0 (22631)"],
                ["userAccountControl"] = ["4096"],
                ["memberOf"] = ["CN=Domain Computers,OU=Groups,DC=contoso,DC=com"]
            }
        };
    }

    // ---- Search ----

    [Fact]
    public async Task SearchCommand_PopulatesSearchResults()
    {
        _directoryProvider.Setup(p => p.IsConnected).Returns(true);
        _directoryProvider.Setup(p => p.SearchComputersAsync("WKS", 50))
            .ReturnsAsync(new List<DirectoryEntry>
            {
                CreateComputerEntry("WKS001"),
                CreateComputerEntry("WKS002")
            });

        var vm = CreateViewModel();

        await vm.SearchCommand.ExecuteAsync("WKS");

        vm.SearchResults.Should().HaveCount(2);
        vm.SearchResults[0].Name.Should().Be("WKS001");
        vm.SearchResults[1].Name.Should().Be("WKS002");
    }

    [Fact]
    public async Task Search_WhenNotConnected_ReturnsEmpty()
    {
        _directoryProvider.Setup(p => p.IsConnected).Returns(false);

        var vm = CreateViewModel();

        await vm.SearchCommand.ExecuteAsync("WKS");

        vm.SearchResults.Should().BeEmpty();
        vm.SelectedComputer.Should().BeNull();
    }

    [Fact]
    public async Task Search_WithEmptyQuery_ClearsResults()
    {
        _directoryProvider.Setup(p => p.IsConnected).Returns(true);
        _directoryProvider.Setup(p => p.SearchComputersAsync("WKS", 50))
            .ReturnsAsync(new List<DirectoryEntry> { CreateComputerEntry() });

        var vm = CreateViewModel();
        await vm.SearchCommand.ExecuteAsync("WKS");
        vm.SearchResults.Should().HaveCount(1);

        await vm.SearchCommand.ExecuteAsync("");

        vm.SearchResults.Should().BeEmpty();
    }

    [Fact]
    public async Task SearchAsync_NullQuery_UsesSearchTextTrim()
    {
        _directoryProvider.Setup(p => p.IsConnected).Returns(true);
        _directoryProvider.Setup(p => p.SearchComputersAsync("SRV", 50))
            .ReturnsAsync(new List<DirectoryEntry> { CreateComputerEntry("SRV001") });

        var vm = CreateViewModel();
        vm.SearchText = "  SRV  ";

        await vm.SearchCommand.ExecuteAsync(null);

        vm.SearchResults.Should().HaveCount(1);
        vm.SearchResults[0].Name.Should().Be("SRV001");
    }

    [Fact]
    public async Task SearchAsync_NullQueryEmptySearchText_ClearsResults()
    {
        _directoryProvider.Setup(p => p.IsConnected).Returns(true);
        _directoryProvider.Setup(p => p.SearchComputersAsync("WKS", 50))
            .ReturnsAsync(new List<DirectoryEntry> { CreateComputerEntry() });

        var vm = CreateViewModel();
        await vm.SearchCommand.ExecuteAsync("WKS");
        vm.SearchResults.Should().HaveCount(1);

        vm.SearchText = "";
        await vm.SearchCommand.ExecuteAsync(null);

        vm.SearchResults.Should().BeEmpty();
        vm.SelectedComputer.Should().BeNull();
    }

    [Fact]
    public async Task SearchAsync_SetsIsSearchingDuringExecution()
    {
        var tcs = new TaskCompletionSource<IReadOnlyList<DirectoryEntry>>();
        _directoryProvider.Setup(p => p.IsConnected).Returns(true);
        _directoryProvider.Setup(p => p.SearchComputersAsync("WKS", 50))
            .Returns(tcs.Task);

        var vm = CreateViewModel();

        var searchTask = vm.SearchCommand.ExecuteAsync("WKS");
        vm.IsSearching.Should().BeTrue();

        tcs.SetResult(new List<DirectoryEntry>());
        await searchTask;

        vm.IsSearching.Should().BeFalse();
    }

    // ---- SelectComputer ----

    [Fact]
    public void SelectComputer_UpdatesSelectedComputerAndDetailItems()
    {
        var vm = CreateViewModel();
        var computer = DirectoryComputer.FromDirectoryEntry(CreateComputerEntry());

        vm.SelectComputerCommand.Execute(computer);

        vm.SelectedComputer.Should().NotBeNull();
        vm.SelectedComputer!.Name.Should().Be("WKS001");
        vm.DetailItems.Should().NotBeEmpty();
        vm.DetailItems.Should().Contain(item => item.Label == "Name" && item.Value == "WKS001");
        vm.ComputerGroups.Should().Contain("Domain Computers");
    }

    [Fact]
    public void SelectComputer_ClearsPingAndDnsResults()
    {
        var vm = CreateViewModel();
        var computer = DirectoryComputer.FromDirectoryEntry(CreateComputerEntry());

        vm.SelectComputerCommand.Execute(computer);

        vm.PingResult.Should().BeNull();
        vm.DnsResult.Should().BeNull();
    }

    [Fact]
    public void SelectComputer_WithNull_ClearsSelection()
    {
        var vm = CreateViewModel();
        var computer = DirectoryComputer.FromDirectoryEntry(CreateComputerEntry());
        vm.SelectComputerCommand.Execute(computer);
        vm.SelectedComputer.Should().NotBeNull();

        vm.SelectComputerCommand.Execute(null);

        vm.SelectedComputer.Should().BeNull();
        vm.HasSelectedComputer.Should().BeFalse();
        vm.DetailItems.Should().BeEmpty();
        vm.ComputerGroups.Should().BeEmpty();
    }

    // ---- HasSelectedComputer ----

    [Fact]
    public void HasSelectedComputer_IsFalse_WhenNoComputerSelected()
    {
        var vm = CreateViewModel();
        vm.HasSelectedComputer.Should().BeFalse();
    }

    [Fact]
    public void HasSelectedComputer_IsTrue_WhenComputerSelected()
    {
        var vm = CreateViewModel();
        var computer = DirectoryComputer.FromDirectoryEntry(CreateComputerEntry());
        vm.SelectComputerCommand.Execute(computer);

        vm.HasSelectedComputer.Should().BeTrue();
    }

    // ---- DetailItems ----

    [Fact]
    public void DetailItems_ReturnsEmptyList_WhenNoComputerSelected()
    {
        var vm = CreateViewModel();
        vm.DetailItems.Should().BeEmpty();
    }

    [Fact]
    public void DetailItems_ContainsAllExpectedFields()
    {
        var vm = CreateViewModel();
        var computer = DirectoryComputer.FromDirectoryEntry(CreateComputerEntry());
        vm.SelectComputerCommand.Execute(computer);

        var labels = vm.DetailItems.Select(i => i.Label).ToList();
        labels.Should().Contain("Name");
        labels.Should().Contain("DNS Host Name");
        labels.Should().Contain("Operating System");
        labels.Should().Contain("OS Version");
        labels.Should().Contain("Last Logon");
        labels.Should().Contain("Distinguished Name");
        labels.Should().Contain("Organizational Unit");
        labels.Should().Contain("Enabled");
    }

    [Fact]
    public void DetailItems_EnabledYes_WhenComputerEnabled()
    {
        var vm = CreateViewModel();
        var computer = DirectoryComputer.FromDirectoryEntry(CreateComputerEntry());
        vm.SelectComputerCommand.Execute(computer);

        vm.DetailItems.Should().Contain(i => i.Label == "Enabled" && i.Value == "Yes");
    }

    [Fact]
    public void DetailItems_EnabledNo_WhenComputerDisabled()
    {
        var entry = new DirectoryEntry
        {
            DistinguishedName = "CN=WKS002,OU=Computers,DC=contoso,DC=com",
            SamAccountName = "WKS002$",
            DisplayName = "WKS002",
            ObjectClass = "computer",
            Attributes = new Dictionary<string, string[]>
            {
                ["cn"] = ["WKS002"],
                ["userAccountControl"] = ["4098"], // Disabled workstation trust
                ["memberOf"] = []
            }
        };
        var vm = CreateViewModel();
        var computer = DirectoryComputer.FromDirectoryEntry(entry);
        vm.SelectComputerCommand.Execute(computer);

        vm.DetailItems.Should().Contain(i => i.Label == "Enabled" && i.Value == "No");
    }

    [Fact]
    public void DetailItems_LastLogonShowsDash_WhenNull()
    {
        var entry = new DirectoryEntry
        {
            DistinguishedName = "CN=WKS003,OU=Computers,DC=contoso,DC=com",
            SamAccountName = "WKS003$",
            DisplayName = "WKS003",
            ObjectClass = "computer",
            Attributes = new Dictionary<string, string[]>
            {
                ["cn"] = ["WKS003"],
                ["userAccountControl"] = ["4096"],
                ["memberOf"] = []
            }
        };
        var vm = CreateViewModel();
        var computer = DirectoryComputer.FromDirectoryEntry(entry);
        vm.SelectComputerCommand.Execute(computer);

        vm.DetailItems.Should().Contain(i => i.Label == "Last Logon" && i.Value == "-");
    }

    // ---- ComputerGroups ----

    [Fact]
    public void ComputerGroups_ReturnsEmptyList_WhenNoComputerSelected()
    {
        var vm = CreateViewModel();
        vm.ComputerGroups.Should().BeEmpty();
    }

    [Fact]
    public void ComputerGroups_FiltersOutEmptyDn()
    {
        var entry = CreateComputerEntry(memberOf: [
            "CN=Domain Computers,OU=Groups,DC=contoso,DC=com",
            "",
            "   "
        ]);

        var vm = CreateViewModel();
        var computer = DirectoryComputer.FromDirectoryEntry(entry);
        vm.SelectComputerCommand.Execute(computer);

        vm.ComputerGroups.Should().Contain("Domain Computers");
        vm.ComputerGroups.Should().HaveCount(1);
    }

    [Fact]
    public void ComputerGroups_DnWithoutCnPrefix_ReturnsFullDn()
    {
        var entry = CreateComputerEntry(memberOf: [
            "OU=SomeGroup,DC=contoso,DC=com"
        ]);

        var vm = CreateViewModel();
        var computer = DirectoryComputer.FromDirectoryEntry(entry);
        vm.SelectComputerCommand.Execute(computer);

        vm.ComputerGroups.Should().Contain("OU=SomeGroup,DC=contoso,DC=com");
    }

    [Fact]
    public void ComputerGroups_CnWithoutComma_ReturnsEntireCnValue()
    {
        var entry = CreateComputerEntry(memberOf: [
            "CN=SimpleGroup"
        ]);

        var vm = CreateViewModel();
        var computer = DirectoryComputer.FromDirectoryEntry(entry);
        vm.SelectComputerCommand.Execute(computer);

        vm.ComputerGroups.Should().Contain("SimpleGroup");
    }

    [Fact]
    public void ComputerGroups_SortedAlphabetically()
    {
        var entry = CreateComputerEntry(memberOf: [
            "CN=Zebra Group,OU=Groups,DC=contoso,DC=com",
            "CN=Alpha Group,OU=Groups,DC=contoso,DC=com",
            "CN=Middle Group,OU=Groups,DC=contoso,DC=com"
        ]);

        var vm = CreateViewModel();
        var computer = DirectoryComputer.FromDirectoryEntry(entry);
        vm.SelectComputerCommand.Execute(computer);

        vm.ComputerGroups.Should().BeInAscendingOrder(StringComparer.OrdinalIgnoreCase);
    }

    // ---- PingAsync ----

    [Fact]
    public async Task PingAsync_SuccessfulPing_ShowsReply()
    {
        _networkService.Setup(n => n.PingAsync("WKS001.contoso.com"))
            .ReturnsAsync(new PingResult(true, "Success", 5, "192.168.1.10"));

        var vm = CreateViewModel();
        var computer = DirectoryComputer.FromDirectoryEntry(CreateComputerEntry());
        vm.SelectComputerCommand.Execute(computer);

        await vm.PingCommand.ExecuteAsync(null);

        vm.PingResult.Should().Be("Reply from 192.168.1.10 - 5ms");
        vm.IsPinging.Should().BeFalse();
    }

    [Fact]
    public async Task PingAsync_FailedPing_ShowsStatus()
    {
        _networkService.Setup(n => n.PingAsync("WKS001.contoso.com"))
            .ReturnsAsync(new PingResult(false, "TimedOut", 0));

        var vm = CreateViewModel();
        var computer = DirectoryComputer.FromDirectoryEntry(CreateComputerEntry());
        vm.SelectComputerCommand.Execute(computer);

        await vm.PingCommand.ExecuteAsync(null);

        vm.PingResult.Should().Be("Ping failed - TimedOut");
        vm.IsPinging.Should().BeFalse();
    }

    [Fact]
    public async Task PingAsync_Exception_ShowsErrorMessage()
    {
        _networkService.Setup(n => n.PingAsync("WKS001.contoso.com"))
            .ThrowsAsync(new Exception("Network unreachable"));

        var vm = CreateViewModel();
        var computer = DirectoryComputer.FromDirectoryEntry(CreateComputerEntry());
        vm.SelectComputerCommand.Execute(computer);

        await vm.PingCommand.ExecuteAsync(null);

        vm.PingResult.Should().Be("Ping error - Network unreachable");
        vm.IsPinging.Should().BeFalse();
    }

    [Fact]
    public async Task PingAsync_ExceptionWithInnerException_ShowsInnerMessage()
    {
        var innerEx = new InvalidOperationException("Inner failure");
        var outerEx = new Exception("Outer", innerEx);
        _networkService.Setup(n => n.PingAsync("WKS001.contoso.com"))
            .ThrowsAsync(outerEx);

        var vm = CreateViewModel();
        var computer = DirectoryComputer.FromDirectoryEntry(CreateComputerEntry());
        vm.SelectComputerCommand.Execute(computer);

        await vm.PingCommand.ExecuteAsync(null);

        vm.PingResult.Should().Be("Ping error - Inner failure");
    }

    [Fact]
    public async Task PingAsync_NoHostName_ShowsNoHostAvailable()
    {
        var vm = CreateViewModel();
        // No computer selected

        await vm.PingCommand.ExecuteAsync(null);

        vm.PingResult.Should().Be("No host name available");
    }

    [Fact]
    public async Task PingAsync_ComputerWithNoDnsHostName_UsesName()
    {
        _networkService.Setup(n => n.PingAsync("WKS001"))
            .ReturnsAsync(new PingResult(true, "Success", 3, "10.0.0.1"));

        var vm = CreateViewModel();
        var computer = DirectoryComputer.FromDirectoryEntry(CreateComputerEntryNoDns());
        vm.SelectComputerCommand.Execute(computer);

        await vm.PingCommand.ExecuteAsync(null);

        vm.PingResult.Should().Be("Reply from 10.0.0.1 - 3ms");
        _networkService.Verify(n => n.PingAsync("WKS001"), Times.Once);
    }

    [Fact]
    public async Task PingAsync_SetsIsPingingDuringExecution()
    {
        var tcs = new TaskCompletionSource<PingResult>();
        _networkService.Setup(n => n.PingAsync(It.IsAny<string>()))
            .Returns(tcs.Task);

        var vm = CreateViewModel();
        var computer = DirectoryComputer.FromDirectoryEntry(CreateComputerEntry());
        vm.SelectComputerCommand.Execute(computer);

        var pingTask = vm.PingCommand.ExecuteAsync(null);
        vm.IsPinging.Should().BeTrue();

        tcs.SetResult(new PingResult(true, "Success", 1, "1.2.3.4"));
        await pingTask;

        vm.IsPinging.Should().BeFalse();
    }

    [Fact]
    public async Task PingAsync_ClearsPreviousResultDuringExecution()
    {
        // First complete a ping to set PingResult
        _networkService.Setup(n => n.PingAsync(It.IsAny<string>()))
            .ReturnsAsync(new PingResult(true, "Success", 1, "1.2.3.4"));

        var vm = CreateViewModel();
        var computer = DirectoryComputer.FromDirectoryEntry(CreateComputerEntry());
        vm.SelectComputerCommand.Execute(computer);

        await vm.PingCommand.ExecuteAsync(null);
        vm.PingResult.Should().NotBeNull();

        // Now start second ping - PingResult should be cleared
        var tcs = new TaskCompletionSource<PingResult>();
        _networkService.Setup(n => n.PingAsync(It.IsAny<string>()))
            .Returns(tcs.Task);

        var task = vm.PingCommand.ExecuteAsync(null);
        vm.PingResult.Should().BeNull();

        tcs.SetResult(new PingResult(true, "Success", 2, "1.2.3.4"));
        await task;
    }

    // ---- DnsResolveAsync ----

    [Fact]
    public async Task DnsResolveAsync_AddressesFound_ShowsAddresses()
    {
        _networkService.Setup(n => n.DnsResolveAsync("WKS001.contoso.com"))
            .ReturnsAsync(new[] { "192.168.1.10", "fe80::1" });

        var vm = CreateViewModel();
        var computer = DirectoryComputer.FromDirectoryEntry(CreateComputerEntry());
        vm.SelectComputerCommand.Execute(computer);

        await vm.DnsResolveCommand.ExecuteAsync(null);

        vm.DnsResult.Should().Be("192.168.1.10, fe80::1");
        vm.IsResolvingDns.Should().BeFalse();
    }

    [Fact]
    public async Task DnsResolveAsync_NoAddresses_ShowsMessage()
    {
        _networkService.Setup(n => n.DnsResolveAsync("WKS001.contoso.com"))
            .ReturnsAsync(Array.Empty<string>());

        var vm = CreateViewModel();
        var computer = DirectoryComputer.FromDirectoryEntry(CreateComputerEntry());
        vm.SelectComputerCommand.Execute(computer);

        await vm.DnsResolveCommand.ExecuteAsync(null);

        vm.DnsResult.Should().Be("No addresses found");
    }

    [Fact]
    public async Task DnsResolveAsync_Exception_ShowsErrorMessage()
    {
        _networkService.Setup(n => n.DnsResolveAsync("WKS001.contoso.com"))
            .ThrowsAsync(new Exception("DNS server unavailable"));

        var vm = CreateViewModel();
        var computer = DirectoryComputer.FromDirectoryEntry(CreateComputerEntry());
        vm.SelectComputerCommand.Execute(computer);

        await vm.DnsResolveCommand.ExecuteAsync(null);

        vm.DnsResult.Should().Be("DNS error - DNS server unavailable");
        vm.IsResolvingDns.Should().BeFalse();
    }

    [Fact]
    public async Task DnsResolveAsync_NoHostName_ShowsNoHostAvailable()
    {
        var vm = CreateViewModel();
        // No computer selected

        await vm.DnsResolveCommand.ExecuteAsync(null);

        vm.DnsResult.Should().Be("No host name available");
    }

    [Fact]
    public async Task DnsResolveAsync_ComputerWithNoDnsHostName_UsesName()
    {
        _networkService.Setup(n => n.DnsResolveAsync("WKS001"))
            .ReturnsAsync(new[] { "10.0.0.1" });

        var vm = CreateViewModel();
        var computer = DirectoryComputer.FromDirectoryEntry(CreateComputerEntryNoDns());
        vm.SelectComputerCommand.Execute(computer);

        await vm.DnsResolveCommand.ExecuteAsync(null);

        vm.DnsResult.Should().Be("10.0.0.1");
        _networkService.Verify(n => n.DnsResolveAsync("WKS001"), Times.Once);
    }

    [Fact]
    public async Task DnsResolveAsync_SetsIsResolvingDnsDuringExecution()
    {
        var tcs = new TaskCompletionSource<string[]>();
        _networkService.Setup(n => n.DnsResolveAsync(It.IsAny<string>()))
            .Returns(tcs.Task);

        var vm = CreateViewModel();
        var computer = DirectoryComputer.FromDirectoryEntry(CreateComputerEntry());
        vm.SelectComputerCommand.Execute(computer);

        var resolveTask = vm.DnsResolveCommand.ExecuteAsync(null);
        vm.IsResolvingDns.Should().BeTrue();

        tcs.SetResult(new[] { "1.2.3.4" });
        await resolveTask;

        vm.IsResolvingDns.Should().BeFalse();
    }

    [Fact]
    public async Task DnsResolveAsync_ClearsPreviousResultDuringExecution()
    {
        // First resolve
        _networkService.Setup(n => n.DnsResolveAsync(It.IsAny<string>()))
            .ReturnsAsync(new[] { "1.2.3.4" });

        var vm = CreateViewModel();
        var computer = DirectoryComputer.FromDirectoryEntry(CreateComputerEntry());
        vm.SelectComputerCommand.Execute(computer);

        await vm.DnsResolveCommand.ExecuteAsync(null);
        vm.DnsResult.Should().NotBeNull();

        // Second resolve - result should be cleared during execution
        var tcs = new TaskCompletionSource<string[]>();
        _networkService.Setup(n => n.DnsResolveAsync(It.IsAny<string>()))
            .Returns(tcs.Task);

        var task = vm.DnsResolveCommand.ExecuteAsync(null);
        vm.DnsResult.Should().BeNull();

        tcs.SetResult(new[] { "5.6.7.8" });
        await task;
    }
}
