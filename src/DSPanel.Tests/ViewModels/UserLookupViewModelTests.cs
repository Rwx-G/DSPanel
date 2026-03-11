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

    private static DirectoryEntry CreateUserEntryWithMemberOf(string[] memberOf)
    {
        return new DirectoryEntry
        {
            DistinguishedName = "CN=John Doe,OU=Users,DC=contoso,DC=com",
            SamAccountName = "jdoe",
            DisplayName = "John Doe",
            ObjectClass = "user",
            Attributes = new Dictionary<string, string[]>
            {
                ["sAMAccountName"] = ["jdoe"],
                ["displayName"] = ["John Doe"],
                ["department"] = ["IT"],
                ["userAccountControl"] = ["512"],
                ["givenName"] = ["John"],
                ["sn"] = ["Doe"],
                ["mail"] = ["jdoe@contoso.com"],
                ["memberOf"] = memberOf
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

    // ---- SearchAsync with null query uses SearchText ----

    [Fact]
    public async Task SearchAsync_NullQuery_UsesSearchTextTrim()
    {
        _directoryProvider.Setup(p => p.IsConnected).Returns(true);
        _directoryProvider.Setup(p => p.SearchUsersAsync("alice", 50))
            .ReturnsAsync(new List<DirectoryEntry> { CreateUserEntry("alice", "Alice") });

        var vm = CreateViewModel();
        vm.SearchText = "  alice  ";

        await vm.SearchCommand.ExecuteAsync(null);

        vm.SearchResults.Should().HaveCount(1);
        vm.SearchResults[0].SamAccountName.Should().Be("alice");
    }

    // ---- DetailItems when SelectedUser is null ----

    [Fact]
    public void DetailItems_ReturnsEmptyList_WhenNoUserSelected()
    {
        var vm = CreateViewModel();
        vm.DetailItems.Should().BeEmpty();
    }

    // ---- UserGroups when SelectedUser is null ----

    [Fact]
    public void UserGroups_ReturnsEmptyList_WhenNoUserSelected()
    {
        var vm = CreateViewModel();
        vm.UserGroups.Should().BeEmpty();
    }

    // ---- HealthStatus when SelectedUser is null ----

    [Fact]
    public void HealthStatus_ReturnsNull_WhenNoUserSelected()
    {
        var vm = CreateViewModel();
        vm.HealthStatus.Should().BeNull();
    }

    // ---- UserGroups edge cases in ExtractCnFromDn ----

    [Fact]
    public void UserGroups_FiltersOutEmptyDn()
    {
        _healthCheckService.Setup(h => h.Evaluate(It.IsAny<DirectoryUser>()))
            .Returns(new AccountHealthStatus());

        var entry = CreateUserEntryWithMemberOf([
            "CN=Domain Users,OU=Groups,DC=contoso,DC=com",
            "",
            "   "
        ]);

        var vm = CreateViewModel();
        var user = DirectoryUser.FromDirectoryEntry(entry);
        vm.SelectUserCommand.Execute(user);

        vm.UserGroups.Should().Contain("Domain Users");
        vm.UserGroups.Should().HaveCount(1);
    }

    [Fact]
    public void UserGroups_DnWithoutCnPrefix_ReturnsFullDn()
    {
        _healthCheckService.Setup(h => h.Evaluate(It.IsAny<DirectoryUser>()))
            .Returns(new AccountHealthStatus());

        var entry = CreateUserEntryWithMemberOf([
            "OU=SomeGroup,DC=contoso,DC=com"
        ]);

        var vm = CreateViewModel();
        var user = DirectoryUser.FromDirectoryEntry(entry);
        vm.SelectUserCommand.Execute(user);

        vm.UserGroups.Should().Contain("OU=SomeGroup,DC=contoso,DC=com");
    }

    [Fact]
    public void UserGroups_CnWithoutComma_ReturnsEntireCnValue()
    {
        _healthCheckService.Setup(h => h.Evaluate(It.IsAny<DirectoryUser>()))
            .Returns(new AccountHealthStatus());

        var entry = CreateUserEntryWithMemberOf([
            "CN=SimpleGroup"
        ]);

        var vm = CreateViewModel();
        var user = DirectoryUser.FromDirectoryEntry(entry);
        vm.SelectUserCommand.Execute(user);

        vm.UserGroups.Should().Contain("SimpleGroup");
    }

    // ---- DetailItems covers all ternary branches ----

    [Fact]
    public void DetailItems_DisabledLockedExpired_CoversOppositeBranches()
    {
        _healthCheckService.Setup(h => h.Evaluate(It.IsAny<DirectoryUser>()))
            .Returns(new AccountHealthStatus());

        var entry = new DirectoryEntry
        {
            DistinguishedName = "CN=Test,OU=Users,DC=contoso,DC=com",
            SamAccountName = "test",
            DisplayName = "Test",
            ObjectClass = "user",
            Attributes = new Dictionary<string, string[]>
            {
                ["userAccountControl"] = ["514"], // disabled
                ["lockoutTime"] = ["133515648000000000"], // locked
                ["memberOf"] = []
            }
        };
        var user = DirectoryUser.FromDirectoryEntry(entry);

        var vm = CreateViewModel();
        vm.SelectUserCommand.Execute(user);

        // Cover the "No" branches for Enabled, and "Yes" for LockedOut
        vm.DetailItems.Should().Contain(i => i.Label == "Enabled" && i.Value == "No");
        vm.DetailItems.Should().Contain(i => i.Label == "Locked Out" && i.Value == "Yes");
    }

    [Fact]
    public void DetailItems_PasswordExpiredAndNeverExpires_CoversYesBranches()
    {
        _healthCheckService.Setup(h => h.Evaluate(It.IsAny<DirectoryUser>()))
            .Returns(new AccountHealthStatus());

        var entry = new DirectoryEntry
        {
            DistinguishedName = "CN=Test,OU=Users,DC=contoso,DC=com",
            SamAccountName = "test",
            DisplayName = "Test",
            ObjectClass = "user",
            Attributes = new Dictionary<string, string[]>
            {
                // 512 + 65536 (DONT_EXPIRE) + 8388608 (PASSWORD_EXPIRED)
                ["userAccountControl"] = ["8454656"],
                ["memberOf"] = []
            }
        };
        var user = DirectoryUser.FromDirectoryEntry(entry);

        var vm = CreateViewModel();
        vm.SelectUserCommand.Execute(user);

        vm.DetailItems.Should().Contain(i => i.Label == "Password Expired" && i.Value == "Yes");
        vm.DetailItems.Should().Contain(i => i.Label == "Password Never Expires" && i.Value == "Yes");
    }

    [Fact]
    public void DetailItems_NullDates_ShowDash()
    {
        _healthCheckService.Setup(h => h.Evaluate(It.IsAny<DirectoryUser>()))
            .Returns(new AccountHealthStatus());

        // User with no date attributes -> all FormatDate calls return "-"
        var entry = new DirectoryEntry
        {
            DistinguishedName = "CN=Test,OU=Users,DC=contoso,DC=com",
            SamAccountName = "test",
            DisplayName = "Test",
            ObjectClass = "user",
            Attributes = new Dictionary<string, string[]>
            {
                ["userAccountControl"] = ["512"],
                ["memberOf"] = []
            }
        };
        var user = DirectoryUser.FromDirectoryEntry(entry);

        var vm = CreateViewModel();
        vm.SelectUserCommand.Execute(user);

        vm.DetailItems.Should().Contain(i => i.Label == "Account Expires" && i.Value == "-");
        vm.DetailItems.Should().Contain(i => i.Label == "Last Logon" && i.Value == "-");
        vm.DetailItems.Should().Contain(i => i.Label == "Created" && i.Value == "-");
        vm.DetailItems.Should().Contain(i => i.Label == "Last Modified" && i.Value == "-");
    }

    // ---- SelectUser with null ----

    [Fact]
    public void SelectUser_WithNull_ClearsSelection()
    {
        _healthCheckService.Setup(h => h.Evaluate(It.IsAny<DirectoryUser>()))
            .Returns(new AccountHealthStatus());

        var vm = CreateViewModel();
        var user = DirectoryUser.FromDirectoryEntry(CreateUserEntry());
        vm.SelectUserCommand.Execute(user);
        vm.SelectedUser.Should().NotBeNull();

        vm.SelectUserCommand.Execute(null);

        vm.SelectedUser.Should().BeNull();
        vm.HasSelectedUser.Should().BeFalse();
        vm.DetailItems.Should().BeEmpty();
        vm.UserGroups.Should().BeEmpty();
        vm.HealthStatus.Should().BeNull();
    }
}
