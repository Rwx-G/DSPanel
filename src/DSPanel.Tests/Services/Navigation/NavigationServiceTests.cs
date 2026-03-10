using DSPanel.Services.Navigation;
using FluentAssertions;
using Microsoft.Extensions.Logging;
using Moq;

namespace DSPanel.Tests.Services.Navigation;

public class NavigationServiceTests
{
    private readonly Mock<ILogger<NavigationService>> _logger = new();

    private NavigationService CreateService() => new(_logger.Object);

    [Fact]
    public void OpenTab_AddsTabToCollection()
    {
        var service = CreateService();

        service.OpenTab("users", "Users", "content");

        service.Tabs.Should().HaveCount(1);
        service.Tabs[0].Key.Should().Be("users");
        service.Tabs[0].Title.Should().Be("Users");
        service.Tabs[0].Content.Should().Be("content");
    }

    [Fact]
    public void OpenTab_SetsActiveTabKey()
    {
        var service = CreateService();

        service.OpenTab("users", "Users", "content");

        service.ActiveTabKey.Should().Be("users");
    }

    [Fact]
    public void OpenTab_WithExistingKey_ActivatesExistingTab()
    {
        var service = CreateService();
        service.OpenTab("users", "Users", "content1");
        service.OpenTab("groups", "Groups", "content2");

        // Open "users" again - should not duplicate
        service.OpenTab("users", "Users", "new content");

        service.Tabs.Should().HaveCount(2);
        service.ActiveTabKey.Should().Be("users");
        // Content should remain the original
        service.Tabs[0].Content.Should().Be("content1");
    }

    [Fact]
    public void OpenTab_WithExistingKey_CaseInsensitive_ActivatesExistingTab()
    {
        var service = CreateService();
        service.OpenTab("users", "Users", "content");

        service.OpenTab("USERS", "Users", "other");

        service.Tabs.Should().HaveCount(1);
        service.ActiveTabKey.Should().Be("users");
    }

    [Fact]
    public void CloseTab_RemovesTabFromCollection()
    {
        var service = CreateService();
        service.OpenTab("users", "Users", "content");

        service.CloseTab("users");

        service.Tabs.Should().BeEmpty();
    }

    [Fact]
    public void CloseTab_ActiveTab_ActivatesAdjacentTab()
    {
        var service = CreateService();
        service.OpenTab("users", "Users", "c1");
        service.OpenTab("groups", "Groups", "c2");
        service.OpenTab("computers", "Computers", "c3");

        // Activate groups then close it
        service.ActiveTabKey = "groups";
        service.CloseTab("groups");

        service.Tabs.Should().HaveCount(2);
        // Should activate the tab at the same index (computers, which shifted to index 1)
        service.ActiveTabKey.Should().Be("computers");
    }

    [Fact]
    public void CloseTab_LastTab_SetsActiveTabKeyToNull()
    {
        var service = CreateService();
        service.OpenTab("users", "Users", "content");

        service.CloseTab("users");

        service.ActiveTabKey.Should().BeNull();
    }

    [Fact]
    public void CloseTab_NonExistentKey_DoesNothing()
    {
        var service = CreateService();
        service.OpenTab("users", "Users", "content");

        service.CloseTab("nonexistent");

        service.Tabs.Should().HaveCount(1);
    }

    [Fact]
    public void NavigateTo_OpensTabWithCorrectTitle()
    {
        var service = CreateService();

        service.NavigateTo("users");

        service.Tabs.Should().HaveCount(1);
        service.Tabs[0].Key.Should().Be("users");
        service.Tabs[0].Title.Should().Be("Users");
        service.ActiveTabKey.Should().Be("users");
    }

    [Fact]
    public void NavigateTo_ExistingModule_ActivatesExistingTab()
    {
        var service = CreateService();
        service.NavigateTo("users");
        service.NavigateTo("groups");

        // Navigate to users again
        service.NavigateTo("users");

        service.Tabs.Should().HaveCount(2);
        service.ActiveTabKey.Should().Be("users");
    }

    [Fact]
    public void NavigateTo_UnknownModule_UsesKeyAsTitle()
    {
        var service = CreateService();

        service.NavigateTo("custom-module");

        service.Tabs.Should().HaveCount(1);
        service.Tabs[0].Title.Should().Be("custom-module");
    }

    [Fact]
    public void ActiveTabKey_SetsIsActiveOnTabs()
    {
        var service = CreateService();
        service.OpenTab("users", "Users", "c1");
        service.OpenTab("groups", "Groups", "c2");

        service.ActiveTabKey = "users";

        service.Tabs[0].IsActive.Should().BeTrue();
        service.Tabs[1].IsActive.Should().BeFalse();
    }

    [Fact]
    public void CloseTab_ClosingLastTabInList_ActivatesPreviousTab()
    {
        var service = CreateService();
        service.OpenTab("users", "Users", "c1");
        service.OpenTab("groups", "Groups", "c2");

        service.ActiveTabKey = "groups";
        service.CloseTab("groups");

        service.ActiveTabKey.Should().Be("users");
    }

    [Fact]
    public void Tabs_NewlyCreated_AreClosable()
    {
        var service = CreateService();

        service.OpenTab("users", "Users", "content");

        service.Tabs[0].CanClose.Should().BeTrue();
    }

    [Fact]
    public void CloseAllTabs_RemovesAllClosableTabs()
    {
        var service = CreateService();
        service.OpenTab("users", "Users", "c1");
        service.OpenTab("groups", "Groups", "c2");

        service.CloseAllTabs();

        service.Tabs.Should().BeEmpty();
        service.ActiveTabKey.Should().BeNull();
    }

    [Fact]
    public void CloseOtherTabs_KeepsOnlySpecifiedTab()
    {
        var service = CreateService();
        service.OpenTab("users", "Users", "c1");
        service.OpenTab("groups", "Groups", "c2");
        service.OpenTab("computers", "Computers", "c3");

        service.CloseOtherTabs("groups");

        service.Tabs.Should().HaveCount(1);
        service.Tabs[0].Key.Should().Be("groups");
        service.ActiveTabKey.Should().Be("groups");
    }

    [Fact]
    public void ActivateNextTab_WrapsAround()
    {
        var service = CreateService();
        service.OpenTab("users", "Users", "c1");
        service.OpenTab("groups", "Groups", "c2");
        service.ActiveTabKey = "groups";

        service.ActivateNextTab();

        service.ActiveTabKey.Should().Be("users");
    }

    [Fact]
    public void ActivatePreviousTab_WrapsAround()
    {
        var service = CreateService();
        service.OpenTab("users", "Users", "c1");
        service.OpenTab("groups", "Groups", "c2");
        service.ActiveTabKey = "users";

        service.ActivatePreviousTab();

        service.ActiveTabKey.Should().Be("groups");
    }

    [Fact]
    public void ActivateTabByIndex_ValidIndex_ActivatesTab()
    {
        var service = CreateService();
        service.OpenTab("users", "Users", "c1");
        service.OpenTab("groups", "Groups", "c2");

        service.ActivateTabByIndex(1);

        service.ActiveTabKey.Should().Be("groups");
    }

    [Fact]
    public void ActivateTabByIndex_InvalidIndex_DoesNothing()
    {
        var service = CreateService();
        service.OpenTab("users", "Users", "c1");
        service.ActiveTabKey = "users";

        service.ActivateTabByIndex(5);

        service.ActiveTabKey.Should().Be("users");
    }

    [Fact]
    public void MoveTab_SwapsTabPositions()
    {
        var service = CreateService();
        service.OpenTab("users", "Users", "c1");
        service.OpenTab("groups", "Groups", "c2");

        service.MoveTab(0, 1);

        service.Tabs[0].Key.Should().Be("groups");
        service.Tabs[1].Key.Should().Be("users");
    }
}
