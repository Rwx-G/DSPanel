using DSPanel.Models;
using DSPanel.Services.Directory;
using DSPanel.ViewModels;
using FluentAssertions;
using Moq;

namespace DSPanel.Tests.ViewModels;

public class ComputerLookupViewModelTests
{
    private readonly Mock<IDirectoryProvider> _directoryProvider = new();

    private ComputerLookupViewModel CreateViewModel() =>
        new(_directoryProvider.Object);

    private static DirectoryEntry CreateComputerEntry(
        string name = "WKS001",
        string os = "Windows 11 Enterprise")
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
                ["memberOf"] = ["CN=Domain Computers,OU=Groups,DC=contoso,DC=com"]
            }
        };
    }

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
    public async Task SelectComputer_UpdatesSelectedComputerAndDetailItems()
    {
        _directoryProvider.Setup(p => p.IsConnected).Returns(true);
        _directoryProvider.Setup(p => p.SearchComputersAsync("WKS", 50))
            .ReturnsAsync(new List<DirectoryEntry> { CreateComputerEntry() });

        var vm = CreateViewModel();
        await vm.SearchCommand.ExecuteAsync("WKS");

        vm.SelectComputerCommand.Execute(vm.SearchResults[0]);

        vm.SelectedComputer.Should().NotBeNull();
        vm.SelectedComputer!.Name.Should().Be("WKS001");
        vm.DetailItems.Should().NotBeEmpty();
        vm.DetailItems.Should().Contain(item => item.Label == "Name" && item.Value == "WKS001");
        vm.ComputerGroups.Should().Contain("Domain Computers");
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

    [Fact]
    public void SelectComputer_ClearsPingAndDnsResults()
    {
        var vm = CreateViewModel();
        var computer = DirectoryComputer.FromDirectoryEntry(CreateComputerEntry());

        vm.SelectComputerCommand.Execute(computer);

        vm.PingResult.Should().BeNull();
        vm.DnsResult.Should().BeNull();
    }
}
