using System.DirectoryServices.Protocols;
using DSPanel.Services.Directory;
using FluentAssertions;
using Microsoft.Extensions.Logging;
using Moq;

namespace DSPanel.Tests.Services.Directory;

public class LdapDirectoryProviderTests
{
    private readonly Mock<ILdapConnectionFactory> _connectionFactory = new();
    private readonly Mock<ILogger<LdapDirectoryProvider>> _logger = new();

    private LdapDirectoryProvider CreateProvider() =>
        new(_connectionFactory.Object, _logger.Object);

    [Fact]
    public void IsConnected_Initially_ReturnsFalse()
    {
        var provider = CreateProvider();

        provider.IsConnected.Should().BeFalse();
    }

    [Fact]
    public void DomainName_Initially_ReturnsNull()
    {
        var provider = CreateProvider();

        provider.DomainName.Should().BeNull();
    }

    [Fact]
    public void BaseDn_Initially_ReturnsNull()
    {
        var provider = CreateProvider();

        provider.BaseDn.Should().BeNull();
    }

    [Fact]
    public async Task SearchUsersAsync_WhenNotConnected_ReturnsEmptyList()
    {
        var provider = CreateProvider();

        var result = await provider.SearchUsersAsync("test");

        result.Should().BeEmpty();
    }

    [Fact]
    public async Task SearchComputersAsync_WhenNotConnected_ReturnsEmptyList()
    {
        var provider = CreateProvider();

        var result = await provider.SearchComputersAsync("test");

        result.Should().BeEmpty();
    }

    [Fact]
    public async Task SearchGroupsAsync_WhenNotConnected_ReturnsEmptyList()
    {
        var provider = CreateProvider();

        var result = await provider.SearchGroupsAsync("test");

        result.Should().BeEmpty();
    }

    [Fact]
    public async Task GetUserByIdentityAsync_WhenNotConnected_ReturnsNull()
    {
        var provider = CreateProvider();

        var result = await provider.GetUserByIdentityAsync("john.doe");

        result.Should().BeNull();
    }

    [Fact]
    public async Task GetGroupMembersAsync_WhenNotConnected_ReturnsEmptyList()
    {
        var provider = CreateProvider();

        var result = await provider.GetGroupMembersAsync("CN=TestGroup,DC=test,DC=com");

        result.Should().BeEmpty();
    }

    [Fact]
    public async Task GetUserGroupsAsync_WhenNotConnected_ReturnsEmptyList()
    {
        var provider = CreateProvider();

        var result = await provider.GetUserGroupsAsync("CN=TestUser,DC=test,DC=com");

        result.Should().BeEmpty();
    }

    [Fact]
    public void Dispose_WhenCalled_DoesNotThrow()
    {
        var provider = CreateProvider();

        var act = () => provider.Dispose();

        act.Should().NotThrow();
    }
}
