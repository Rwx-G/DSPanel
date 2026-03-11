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

    [Fact]
    public void MoveTab_WithNegativeFromIndex_DoesNothing()
    {
        var service = CreateService();
        service.OpenTab("users", "Users", "c1");
        service.OpenTab("groups", "Groups", "c2");

        service.MoveTab(-1, 1);

        service.Tabs[0].Key.Should().Be("users");
        service.Tabs[1].Key.Should().Be("groups");
    }

    [Fact]
    public void MoveTab_WithFromIndexExceedingCount_DoesNothing()
    {
        var service = CreateService();
        service.OpenTab("users", "Users", "c1");
        service.OpenTab("groups", "Groups", "c2");

        service.MoveTab(5, 0);

        service.Tabs[0].Key.Should().Be("users");
        service.Tabs[1].Key.Should().Be("groups");
    }

    [Fact]
    public void MoveTab_WithNegativeToIndex_DoesNothing()
    {
        var service = CreateService();
        service.OpenTab("users", "Users", "c1");
        service.OpenTab("groups", "Groups", "c2");

        service.MoveTab(0, -1);

        service.Tabs[0].Key.Should().Be("users");
        service.Tabs[1].Key.Should().Be("groups");
    }

    [Fact]
    public void MoveTab_WithToIndexExceedingCount_DoesNothing()
    {
        var service = CreateService();
        service.OpenTab("users", "Users", "c1");
        service.OpenTab("groups", "Groups", "c2");

        service.MoveTab(0, 5);

        service.Tabs[0].Key.Should().Be("users");
        service.Tabs[1].Key.Should().Be("groups");
    }

    [Fact]
    public void MoveTab_WithSameFromAndToIndex_DoesNothing()
    {
        var service = CreateService();
        service.OpenTab("users", "Users", "c1");
        service.OpenTab("groups", "Groups", "c2");

        service.MoveTab(0, 0);

        service.Tabs[0].Key.Should().Be("users");
        service.Tabs[1].Key.Should().Be("groups");
    }

    [Fact]
    public void ActivateNextTab_WithNoTabs_DoesNothing()
    {
        var service = CreateService();

        service.ActivateNextTab();

        service.ActiveTabKey.Should().BeNull();
    }

    [Fact]
    public void ActivatePreviousTab_WithNoTabs_DoesNothing()
    {
        var service = CreateService();

        service.ActivatePreviousTab();

        service.ActiveTabKey.Should().BeNull();
    }

    [Fact]
    public void ActivateNextTab_WhenActiveTabKeyIsNull_ActivatesFirstTab()
    {
        var service = CreateService();
        service.OpenTab("users", "Users", "c1");
        service.OpenTab("groups", "Groups", "c2");
        // Force ActiveTabKey to null without clearing tabs
        service.Tabs[0].IsActive = false;
        service.Tabs[1].IsActive = false;

        // Use reflection to bypass the setter guard and set _activeTabKey to null
        var field = typeof(NavigationService).GetField("_activeTabKey",
            System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance)!;
        field.SetValue(service, null);

        service.ActivateNextTab();

        // When ActiveTabKey is null, index resolves to -1, so next = (-1 + 1) % 2 = 0
        service.ActiveTabKey.Should().Be("users");
    }

    [Fact]
    public void CloseTab_InactiveTab_KeepsCurrentActiveTab()
    {
        var service = CreateService();
        service.OpenTab("users", "Users", "c1");
        service.OpenTab("groups", "Groups", "c2");
        service.OpenTab("computers", "Computers", "c3");
        service.ActiveTabKey = "users";

        service.CloseTab("groups");

        service.Tabs.Should().HaveCount(2);
        service.ActiveTabKey.Should().Be("users");
    }

    [Fact]
    public void CloseAllTabs_WithNonClosableTabs_KeepsThoseTabs()
    {
        var service = CreateService();
        service.OpenTab("dashboard", "Dashboard", "c1");
        service.Tabs[0].CanClose = false;
        service.OpenTab("users", "Users", "c2");
        service.OpenTab("groups", "Groups", "c3");

        service.CloseAllTabs();

        service.Tabs.Should().HaveCount(1);
        service.Tabs[0].Key.Should().Be("dashboard");
        service.ActiveTabKey.Should().Be("dashboard");
    }

    [Fact]
    public void ActiveTabKey_SetToSameValue_DoesNotReprocess()
    {
        var service = CreateService();
        service.OpenTab("users", "Users", "c1");
        service.ActiveTabKey = "users";

        // Setting the same value again should early return
        service.ActiveTabKey = "users";

        service.ActiveTabKey.Should().Be("users");
        service.Tabs[0].IsActive.Should().BeTrue();
    }

    [Fact]
    public void NavigateTo_WithRegisteredViewFactory_UsesFactoryContent()
    {
        var service = CreateService();
        var expectedContent = new object();
        service.RegisterViewFactory("users", () => expectedContent);

        service.NavigateTo("users");

        service.Tabs.Should().HaveCount(1);
        service.Tabs[0].Content.Should().BeSameAs(expectedContent);
    }

    [Fact]
    public void ActivatePreviousTab_WhenActiveTabKeyIsNull_ActivatesFirstTab()
    {
        var service = CreateService();
        service.OpenTab("users", "Users", "c1");
        service.OpenTab("groups", "Groups", "c2");

        // Force ActiveTabKey to null via reflection
        var field = typeof(NavigationService).GetField("_activeTabKey",
            System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance)!;
        field.SetValue(service, null);

        service.ActivatePreviousTab();

        // When ActiveTabKey is null, index resolves to 0, so prev = (0 - 1 + 2) % 2 = 1
        service.ActiveTabKey.Should().Be("groups");
    }

    [Fact]
    public void ActivateTabByIndex_WithNegativeIndex_DoesNothing()
    {
        var service = CreateService();
        service.OpenTab("users", "Users", "c1");
        service.ActiveTabKey = "users";

        service.ActivateTabByIndex(-1);

        service.ActiveTabKey.Should().Be("users");
    }
}
