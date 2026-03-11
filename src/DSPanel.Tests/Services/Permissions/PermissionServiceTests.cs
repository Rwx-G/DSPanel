using DSPanel.Models;
using DSPanel.Services.Directory;
using DSPanel.Services.Permissions;
using FluentAssertions;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Moq;

namespace DSPanel.Tests.Services.Permissions;

public class PermissionServiceTests
{
    private readonly Mock<IDirectoryProvider> _directoryProvider = new();
    private readonly Mock<ILogger<PermissionService>> _logger = new();

    private PermissionService CreateService(Dictionary<string, string>? mappings = null)
    {
        var options = new PermissionOptions();
        if (mappings is not null)
            options.GroupMappings = mappings;

        return new PermissionService(
            _directoryProvider.Object,
            Options.Create(options),
            _logger.Object);
    }

    private void SetupUserWithGroups(params string[] groupCns)
    {
        _directoryProvider.Setup(p => p.IsConnected).Returns(true);
        _directoryProvider
            .Setup(p => p.GetUserByIdentityAsync(It.IsAny<string>()))
            .ReturnsAsync(new DirectoryEntry
            {
                DistinguishedName = "CN=TestUser,DC=test,DC=com"
            });
        _directoryProvider
            .Setup(p => p.GetUserGroupsAsync(It.IsAny<string>()))
            .ReturnsAsync(groupCns.Select(cn => $"CN={cn},OU=Groups,DC=test,DC=com").ToList());
    }

    [Fact]
    public void CurrentLevel_Initially_IsReadOnly()
    {
        var service = CreateService();

        service.CurrentLevel.Should().Be(PermissionLevel.ReadOnly);
    }

    [Fact]
    public async Task DetectPermissionsAsync_WhenNotConnected_DefaultsToReadOnly()
    {
        _directoryProvider.Setup(p => p.IsConnected).Returns(false);
        var service = CreateService();

        await service.DetectPermissionsAsync();

        service.CurrentLevel.Should().Be(PermissionLevel.ReadOnly);
    }

    [Fact]
    public async Task DetectPermissionsAsync_WhenUserNotFound_DefaultsToReadOnly()
    {
        _directoryProvider.Setup(p => p.IsConnected).Returns(true);
        _directoryProvider
            .Setup(p => p.GetUserByIdentityAsync(It.IsAny<string>()))
            .ReturnsAsync((DirectoryEntry?)null);
        var service = CreateService();

        await service.DetectPermissionsAsync();

        service.CurrentLevel.Should().Be(PermissionLevel.ReadOnly);
    }

    [Fact]
    public async Task DetectPermissionsAsync_WhenNoMatchingGroups_DefaultsToReadOnly()
    {
        SetupUserWithGroups("SomeOtherGroup", "AnotherGroup");
        var service = CreateService();

        await service.DetectPermissionsAsync();

        service.CurrentLevel.Should().Be(PermissionLevel.ReadOnly);
    }

    [Fact]
    public async Task DetectPermissionsAsync_WhenInHelpDeskGroup_DetectsHelpDesk()
    {
        SetupUserWithGroups("DSPanel-HelpDesk");
        var service = CreateService();

        await service.DetectPermissionsAsync();

        service.CurrentLevel.Should().Be(PermissionLevel.HelpDesk);
    }

    [Fact]
    public async Task DetectPermissionsAsync_WhenInAccountOpsGroup_DetectsAccountOperator()
    {
        SetupUserWithGroups("DSPanel-AccountOps");
        var service = CreateService();

        await service.DetectPermissionsAsync();

        service.CurrentLevel.Should().Be(PermissionLevel.AccountOperator);
    }

    [Fact]
    public async Task DetectPermissionsAsync_WhenInDomainAdminsGroup_DetectsDomainAdmin()
    {
        SetupUserWithGroups("Domain Admins");
        var service = CreateService();

        await service.DetectPermissionsAsync();

        service.CurrentLevel.Should().Be(PermissionLevel.DomainAdmin);
    }

    [Fact]
    public async Task DetectPermissionsAsync_WhenInMultipleGroups_TakesHighestLevel()
    {
        SetupUserWithGroups("DSPanel-HelpDesk", "Domain Admins");
        var service = CreateService();

        await service.DetectPermissionsAsync();

        service.CurrentLevel.Should().Be(PermissionLevel.DomainAdmin);
    }

    [Fact]
    public async Task HasPermission_WhenDomainAdmin_ReturnsTrueForAllLevels()
    {
        SetupUserWithGroups("Domain Admins");
        var service = CreateService();
        await service.DetectPermissionsAsync();

        service.HasPermission(PermissionLevel.ReadOnly).Should().BeTrue();
        service.HasPermission(PermissionLevel.HelpDesk).Should().BeTrue();
        service.HasPermission(PermissionLevel.AccountOperator).Should().BeTrue();
        service.HasPermission(PermissionLevel.DomainAdmin).Should().BeTrue();
    }

    [Fact]
    public async Task HasPermission_WhenHelpDesk_ReturnsFalseForHigherLevels()
    {
        SetupUserWithGroups("DSPanel-HelpDesk");
        var service = CreateService();
        await service.DetectPermissionsAsync();

        service.HasPermission(PermissionLevel.ReadOnly).Should().BeTrue();
        service.HasPermission(PermissionLevel.HelpDesk).Should().BeTrue();
        service.HasPermission(PermissionLevel.AccountOperator).Should().BeFalse();
        service.HasPermission(PermissionLevel.DomainAdmin).Should().BeFalse();
    }

    [Fact]
    public void HasPermission_WhenReadOnly_ReturnsFalseForHigherLevels()
    {
        var service = CreateService();

        service.HasPermission(PermissionLevel.ReadOnly).Should().BeTrue();
        service.HasPermission(PermissionLevel.HelpDesk).Should().BeFalse();
    }

    [Fact]
    public async Task DetectPermissionsAsync_WithCustomGroupMappings_UsesCustomNames()
    {
        var customMappings = new Dictionary<string, string>
        {
            ["IT-Support"] = "HelpDesk",
            ["IT-Admins"] = "DomainAdmin"
        };
        SetupUserWithGroups("IT-Support");
        var service = CreateService(customMappings);

        await service.DetectPermissionsAsync();

        service.CurrentLevel.Should().Be(PermissionLevel.HelpDesk);
    }

    [Fact]
    public async Task UserGroups_AfterDetection_ContainsGroupNames()
    {
        SetupUserWithGroups("DSPanel-HelpDesk", "SomeOtherGroup");
        var service = CreateService();

        await service.DetectPermissionsAsync();

        service.UserGroups.Should().Contain("DSPanel-HelpDesk");
        service.UserGroups.Should().Contain("SomeOtherGroup");
    }

    [Fact]
    public async Task DetectPermissionsAsync_WhenGetUserByIdentityThrows_DefaultsToReadOnly()
    {
        _directoryProvider.Setup(p => p.IsConnected).Returns(true);
        _directoryProvider
            .Setup(p => p.GetUserByIdentityAsync(It.IsAny<string>()))
            .ThrowsAsync(new InvalidOperationException("LDAP connection failed"));
        var service = CreateService();

        await service.DetectPermissionsAsync();

        service.CurrentLevel.Should().Be(PermissionLevel.ReadOnly);
    }

    [Fact]
    public async Task DetectPermissionsAsync_WhenGetUserGroupsThrows_DefaultsToReadOnly()
    {
        _directoryProvider.Setup(p => p.IsConnected).Returns(true);
        _directoryProvider
            .Setup(p => p.GetUserByIdentityAsync(It.IsAny<string>()))
            .ReturnsAsync(new DirectoryEntry
            {
                DistinguishedName = "CN=TestUser,DC=test,DC=com"
            });
        _directoryProvider
            .Setup(p => p.GetUserGroupsAsync(It.IsAny<string>()))
            .ThrowsAsync(new InvalidOperationException("Group query failed"));
        var service = CreateService();

        await service.DetectPermissionsAsync();

        service.CurrentLevel.Should().Be(PermissionLevel.ReadOnly);
    }

    [Fact]
    public void BuildMappings_WithInvalidPermissionLevelValue_IgnoresMapping()
    {
        var customMappings = new Dictionary<string, string>
        {
            ["ValidGroup"] = "HelpDesk",
            ["BogusGroup"] = "Bogus"
        };
        SetupUserWithGroups("BogusGroup");
        var service = CreateService(customMappings);

        // The service should be created without error, but BogusGroup mapping is ignored
        service.CurrentLevel.Should().Be(PermissionLevel.ReadOnly);
    }

    [Fact]
    public async Task ExtractCn_WithDnWithoutComma_ReturnsFullCnValue()
    {
        _directoryProvider.Setup(p => p.IsConnected).Returns(true);
        _directoryProvider
            .Setup(p => p.GetUserByIdentityAsync(It.IsAny<string>()))
            .ReturnsAsync(new DirectoryEntry
            {
                DistinguishedName = "CN=TestUser,DC=test,DC=com"
            });
        // Return a DN that has no comma - "CN=OnlyName"
        _directoryProvider
            .Setup(p => p.GetUserGroupsAsync(It.IsAny<string>()))
            .ReturnsAsync(new List<string> { "CN=OnlyName" });
        var service = CreateService();

        await service.DetectPermissionsAsync();

        service.UserGroups.Should().Contain("OnlyName");
    }

    [Fact]
    public async Task ExtractCn_WithDnNotStartingWithCn_ReturnsNullAndFiltersGroup()
    {
        _directoryProvider.Setup(p => p.IsConnected).Returns(true);
        _directoryProvider
            .Setup(p => p.GetUserByIdentityAsync(It.IsAny<string>()))
            .ReturnsAsync(new DirectoryEntry
            {
                DistinguishedName = "CN=TestUser,DC=test,DC=com"
            });
        // Return a DN that does not start with "CN="
        _directoryProvider
            .Setup(p => p.GetUserGroupsAsync(It.IsAny<string>()))
            .ReturnsAsync(new List<string> { "OU=SomeGroup,DC=test,DC=com" });
        var service = CreateService();

        await service.DetectPermissionsAsync();

        service.UserGroups.Should().BeEmpty();
    }

    [Fact]
    public void UserGroups_BeforeDetection_IsEmpty()
    {
        var service = CreateService();

        service.UserGroups.Should().BeEmpty();
    }
}
