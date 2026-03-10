using DSPanel.Models;
using DSPanel.Services.Directory;
using DSPanel.Services.Health;
using DSPanel.ViewModels;
using FluentAssertions;
using Moq;

namespace DSPanel.Tests.ViewModels;

public class UserLookupViewModelTests
{
    private readonly Mock<IDirectoryProvider> _directoryProvider = new();
    private readonly Mock<IHealthCheckService> _healthCheckService = new();

    private UserLookupViewModel CreateViewModel() =>
        new(_directoryProvider.Object, _healthCheckService.Object);

    private static DirectoryEntry CreateUserEntry(
        string samAccountName = "jdoe",
        string displayName = "John Doe",
        string department = "IT")
    {
        return new DirectoryEntry
        {
            DistinguishedName = $"CN={displayName},OU=Users,DC=contoso,DC=com",
            SamAccountName = samAccountName,
            DisplayName = displayName,
            ObjectClass = "user",
            Attributes = new Dictionary<string, string[]>
            {
                ["sAMAccountName"] = [samAccountName],
                ["displayName"] = [displayName],
                ["department"] = [department],
                ["userAccountControl"] = ["512"], // Normal account, enabled
                ["givenName"] = ["John"],
                ["sn"] = ["Doe"],
                ["mail"] = [$"{samAccountName}@contoso.com"],
                ["memberOf"] = ["CN=Domain Users,OU=Groups,DC=contoso,DC=com"]
            }
        };
    }

    [Fact]
    public async Task SearchCommand_PopulatesSearchResults()
    {
        _directoryProvider.Setup(p => p.IsConnected).Returns(true);
        _directoryProvider.Setup(p => p.SearchUsersAsync("john", 50))
            .ReturnsAsync(new List<DirectoryEntry>
            {
                CreateUserEntry("jdoe", "John Doe"),
                CreateUserEntry("jsmith", "John Smith")
            });

        var vm = CreateViewModel();

        await vm.SearchCommand.ExecuteAsync("john");

        vm.SearchResults.Should().HaveCount(2);
        vm.SearchResults[0].SamAccountName.Should().Be("jdoe");
        vm.SearchResults[1].SamAccountName.Should().Be("jsmith");
    }

    [Fact]
    public async Task SelectUser_UpdatesSelectedUserAndDetailItems()
    {
        _directoryProvider.Setup(p => p.IsConnected).Returns(true);
        _directoryProvider.Setup(p => p.SearchUsersAsync("john", 50))
            .ReturnsAsync(new List<DirectoryEntry> { CreateUserEntry() });
        _healthCheckService.Setup(h => h.Evaluate(It.IsAny<DirectoryUser>()))
            .Returns(new AccountHealthStatus());

        var vm = CreateViewModel();
        await vm.SearchCommand.ExecuteAsync("john");

        vm.SelectUserCommand.Execute(vm.SearchResults[0]);

        vm.SelectedUser.Should().NotBeNull();
        vm.SelectedUser!.SamAccountName.Should().Be("jdoe");
        vm.DetailItems.Should().NotBeEmpty();
        vm.DetailItems.Should().Contain(item => item.Label == "SAM Account Name" && item.Value == "jdoe");
        vm.UserGroups.Should().Contain("Domain Users");
    }

    [Fact]
    public async Task Search_WhenNotConnected_ReturnsEmpty()
    {
        _directoryProvider.Setup(p => p.IsConnected).Returns(false);

        var vm = CreateViewModel();

        await vm.SearchCommand.ExecuteAsync("john");

        vm.SearchResults.Should().BeEmpty();
        vm.SelectedUser.Should().BeNull();
    }

    [Fact]
    public async Task Search_WithEmptyQuery_ClearsResults()
    {
        _directoryProvider.Setup(p => p.IsConnected).Returns(true);
        _directoryProvider.Setup(p => p.SearchUsersAsync("john", 50))
            .ReturnsAsync(new List<DirectoryEntry> { CreateUserEntry() });

        var vm = CreateViewModel();
        await vm.SearchCommand.ExecuteAsync("john");
        vm.SearchResults.Should().HaveCount(1);

        await vm.SearchCommand.ExecuteAsync("");

        vm.SearchResults.Should().BeEmpty();
    }

    [Fact]
    public void SelectUser_UpdatesHealthStatus()
    {
        var expectedStatus = new AccountHealthStatus
        {
            OverallLevel = HealthLevel.Warning,
            ActiveFlags = [new HealthFlag("Test", HealthLevel.Warning, "Test flag")]
        };
        _healthCheckService.Setup(h => h.Evaluate(It.IsAny<DirectoryUser>()))
            .Returns(expectedStatus);

        var vm = CreateViewModel();
        var user = DirectoryUser.FromDirectoryEntry(CreateUserEntry());

        vm.SelectUserCommand.Execute(user);

        vm.HealthStatus.Should().NotBeNull();
        vm.HealthStatus!.OverallLevel.Should().Be(HealthLevel.Warning);
    }

    [Fact]
    public void HasSelectedUser_IsFalse_WhenNoUserSelected()
    {
        var vm = CreateViewModel();
        vm.HasSelectedUser.Should().BeFalse();
    }

    [Fact]
    public void HasSelectedUser_IsTrue_WhenUserSelected()
    {
        _healthCheckService.Setup(h => h.Evaluate(It.IsAny<DirectoryUser>()))
            .Returns(new AccountHealthStatus());

        var vm = CreateViewModel();
        var user = DirectoryUser.FromDirectoryEntry(CreateUserEntry());
        vm.SelectUserCommand.Execute(user);

        vm.HasSelectedUser.Should().BeTrue();
    }
}
