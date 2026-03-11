using System.Collections.ObjectModel;
using DSPanel.Services.Dialog;
using DSPanel.Services.Directory;
using DSPanel.Services.Navigation;
using DSPanel.Services.Notifications;
using DSPanel.Services.Permissions;
using DSPanel.Services.Theme;
using DSPanel.ViewModels;
using FluentAssertions;
using Moq;
using TabItem = DSPanel.Models.TabItem;

namespace DSPanel.Tests.ViewModels;

public class MainViewModelTests
{
    private readonly Mock<INavigationService> _mockNav = new();
    private readonly Mock<IPermissionService> _mockPerm = new();
    private readonly Mock<IThemeService> _mockTheme = new();
    private readonly Mock<IDirectoryProvider> _mockDir = new();
    private readonly Mock<IDialogService> _mockDialog = new();
    private readonly Mock<INotificationService> _mockNotif = new();

    private MainViewModel CreateViewModel(PermissionLevel level = PermissionLevel.DomainAdmin)
    {
        _mockNav.Setup(n => n.Tabs).Returns(new ObservableCollection<TabItem>());
        _mockPerm.Setup(p => p.CurrentLevel).Returns(level);
        _mockPerm.Setup(p => p.HasPermission(It.IsAny<PermissionLevel>()))
            .Returns<PermissionLevel>(required => level >= required);

        return new MainViewModel(
            _mockNav.Object,
            _mockPerm.Object,
            _mockTheme.Object,
            _mockDir.Object,
            _mockDialog.Object,
            _mockNotif.Object);
    }

    // ---- Sidebar ----

    [Fact]
    public void Constructor_BuildsSidebarItems()
    {
        var vm = CreateViewModel();
        vm.SidebarItems.Should().NotBeEmpty();
    }

    [Fact]
    public void Constructor_DomainAdmin_SeesAllItems()
    {
        var vm = CreateViewModel(PermissionLevel.DomainAdmin);
        vm.SidebarItems.Should().HaveCount(7); // All items visible
    }

    [Fact]
    public void Constructor_ReadOnly_SeesOnlyPublicItems()
    {
        var vm = CreateViewModel(PermissionLevel.ReadOnly);
        // ReadOnly should see: users, computers, settings (3 items with no required permission)
        vm.SidebarItems.Should().HaveCount(3);
        vm.SidebarItems.Should().OnlyContain(i => i.RequiredPermission == null);
    }

    [Fact]
    public void SidebarCategories_ContainsExpectedCategories()
    {
        MainViewModel.SidebarCategories.Should().Contain("Lookup");
        MainViewModel.SidebarCategories.Should().Contain("Settings");
        MainViewModel.SidebarCategories.Should().HaveCount(5);
    }

    [Fact]
    public void ToggleSidebar_TogglesExpanded()
    {
        var vm = CreateViewModel();
        vm.IsSidebarExpanded.Should().BeTrue();

        vm.ToggleSidebarCommand.Execute(null);
        vm.IsSidebarExpanded.Should().BeFalse();

        vm.ToggleSidebarCommand.Execute(null);
        vm.IsSidebarExpanded.Should().BeTrue();
    }

    // ---- Theme ----

    [Fact]
    public void ToggleTheme_CallsThemeService()
    {
        var vm = CreateViewModel();
        vm.ToggleThemeCommand.Execute(null);
        _mockTheme.Verify(t => t.ToggleTheme(), Times.Once);
    }

    // ---- Navigation ----

    [Fact]
    public void Navigate_CallsNavigationService()
    {
        var vm = CreateViewModel();
        vm.NavigateCommand.Execute("users");
        _mockNav.Verify(n => n.NavigateTo("users"), Times.Once);
    }

    [Fact]
    public void CloseTab_CallsNavigationService()
    {
        var vm = CreateViewModel();
        vm.CloseTabCommand.Execute("users");
        _mockNav.Verify(n => n.CloseTab("users"), Times.Once);
    }

    [Fact]
    public void CloseAllTabs_CallsNavigationService()
    {
        var vm = CreateViewModel();
        vm.CloseAllTabsCommand.Execute(null);
        _mockNav.Verify(n => n.CloseAllTabs(), Times.Once);
    }

    [Fact]
    public void CloseOtherTabs_CallsNavigationService()
    {
        var vm = CreateViewModel();
        vm.CloseOtherTabsCommand.Execute("users");
        _mockNav.Verify(n => n.CloseOtherTabs("users"), Times.Once);
    }

    [Fact]
    public void NextTab_CallsNavigationService()
    {
        var vm = CreateViewModel();
        vm.NextTabCommand.Execute(null);
        _mockNav.Verify(n => n.ActivateNextTab(), Times.Once);
    }

    [Fact]
    public void PreviousTab_CallsNavigationService()
    {
        var vm = CreateViewModel();
        vm.PreviousTabCommand.Execute(null);
        _mockNav.Verify(n => n.ActivatePreviousTab(), Times.Once);
    }

    [Fact]
    public void ActivateTabByIndex_CallsNavigationService()
    {
        var vm = CreateViewModel();
        vm.ActivateTabByIndexCommand.Execute(2);
        _mockNav.Verify(n => n.ActivateTabByIndex(2), Times.Once);
    }

    [Fact]
    public void MoveTab_CallsNavigationService()
    {
        var vm = CreateViewModel();
        vm.MoveTab(0, 2);
        _mockNav.Verify(n => n.MoveTab(0, 2), Times.Once);
    }

    // ---- Status bar ----

    [Fact]
    public void DomainName_ReturnsDash_WhenNull()
    {
        _mockDir.Setup(d => d.DomainName).Returns((string?)null);
        var vm = CreateViewModel();
        vm.DomainName.Should().Be("-");
    }

    [Fact]
    public void DomainName_ReturnsDomainValue()
    {
        _mockDir.Setup(d => d.DomainName).Returns("example.com");
        var vm = CreateViewModel();
        vm.DomainName.Should().Be("example.com");
    }

    [Fact]
    public void ConnectedDc_ReturnsDash_WhenNull()
    {
        _mockDir.Setup(d => d.ConnectedDc).Returns((string?)null);
        var vm = CreateViewModel();
        vm.ConnectedDc.Should().Be("-");
    }

    [Fact]
    public void IsConnected_ReturnsProviderValue()
    {
        _mockDir.Setup(d => d.IsConnected).Returns(true);
        var vm = CreateViewModel();
        vm.IsConnected.Should().BeTrue();
    }

    [Fact]
    public void PermissionLevel_ReturnsServiceValue()
    {
        var vm = CreateViewModel(PermissionLevel.HelpDesk);
        vm.PermissionLevel.Should().Be(PermissionLevel.HelpDesk);
    }

    // ---- Tabs ----

    [Fact]
    public void SelectedTabIndex_NoActiveTab_ReturnsMinusOne()
    {
        _mockNav.Setup(n => n.ActiveTabKey).Returns((string?)null);
        var vm = CreateViewModel();
        vm.SelectedTabIndex.Should().Be(-1);
    }

    [Fact]
    public void Title_DefaultsToAppName()
    {
        var vm = CreateViewModel();
        vm.Title.Should().Be("DSPanel");
    }

    // ---- ActiveTabTitle ----

    [Fact]
    public void ActiveTabTitle_ReturnsMatchingTabTitle()
    {
        var tabs = new ObservableCollection<TabItem>
        {
            new() { Key = "users", Title = "Users" },
            new() { Key = "groups", Title = "Groups" }
        };
        _mockNav.Setup(n => n.Tabs).Returns(tabs);
        _mockNav.Setup(n => n.ActiveTabKey).Returns("users");

        var vm = CreateViewModel();

        // Override the Tabs setup done by CreateViewModel
        _mockNav.Setup(n => n.Tabs).Returns(tabs);
        _mockNav.Setup(n => n.ActiveTabKey).Returns("users");

        vm.ActiveTabTitle.Should().Be("Users");
    }

    [Fact]
    public void ActiveTabTitle_ReturnsNull_WhenNoMatch()
    {
        var tabs = new ObservableCollection<TabItem>
        {
            new() { Key = "users", Title = "Users" }
        };
        _mockNav.Setup(n => n.Tabs).Returns(tabs);
        _mockNav.Setup(n => n.ActiveTabKey).Returns("nonexistent");

        var vm = CreateViewModel();

        _mockNav.Setup(n => n.Tabs).Returns(tabs);
        _mockNav.Setup(n => n.ActiveTabKey).Returns("nonexistent");

        vm.ActiveTabTitle.Should().BeNull();
    }

    // ---- SelectedTabIndex getter ----

    [Fact]
    public void SelectedTabIndex_ReturnsCorrectIndex_WhenActiveTabKeyMatches()
    {
        var tabs = new ObservableCollection<TabItem>
        {
            new() { Key = "users", Title = "Users" },
            new() { Key = "groups", Title = "Groups" }
        };
        _mockNav.Setup(n => n.Tabs).Returns(tabs);
        _mockNav.Setup(n => n.ActiveTabKey).Returns("groups");

        var vm = CreateViewModel();

        _mockNav.Setup(n => n.Tabs).Returns(tabs);
        _mockNav.Setup(n => n.ActiveTabKey).Returns("groups");

        vm.SelectedTabIndex.Should().Be(1);
    }

    [Fact]
    public void SelectedTabIndex_ReturnsMinusOne_WhenActiveTabKeyDoesNotMatch()
    {
        var tabs = new ObservableCollection<TabItem>
        {
            new() { Key = "users", Title = "Users" }
        };
        _mockNav.Setup(n => n.Tabs).Returns(tabs);
        _mockNav.Setup(n => n.ActiveTabKey).Returns("nonexistent");

        var vm = CreateViewModel();

        _mockNav.Setup(n => n.Tabs).Returns(tabs);
        _mockNav.Setup(n => n.ActiveTabKey).Returns("nonexistent");

        vm.SelectedTabIndex.Should().Be(-1);
    }

    // ---- SelectedTabIndex setter ----

    [Fact]
    public void SelectedTabIndex_Setter_ValidIndex_SetsActiveTabKey()
    {
        var tabs = new ObservableCollection<TabItem>
        {
            new() { Key = "users", Title = "Users" },
            new() { Key = "groups", Title = "Groups" }
        };
        _mockNav.Setup(n => n.Tabs).Returns(tabs);

        var vm = CreateViewModel();

        _mockNav.Setup(n => n.Tabs).Returns(tabs);

        vm.SelectedTabIndex = 1;

        _mockNav.VerifySet(n => n.ActiveTabKey = "groups", Times.Once);
    }

    [Fact]
    public void SelectedTabIndex_Setter_NegativeIndex_DoesNothing()
    {
        var tabs = new ObservableCollection<TabItem>
        {
            new() { Key = "users", Title = "Users" }
        };
        _mockNav.Setup(n => n.Tabs).Returns(tabs);

        var vm = CreateViewModel();

        _mockNav.Setup(n => n.Tabs).Returns(tabs);

        vm.SelectedTabIndex = -1;

        _mockNav.VerifySet(n => n.ActiveTabKey = It.IsAny<string?>(), Times.Never);
    }

    [Fact]
    public void SelectedTabIndex_Setter_IndexOutOfRange_DoesNothing()
    {
        var tabs = new ObservableCollection<TabItem>
        {
            new() { Key = "users", Title = "Users" }
        };
        _mockNav.Setup(n => n.Tabs).Returns(tabs);

        var vm = CreateViewModel();

        _mockNav.Setup(n => n.Tabs).Returns(tabs);

        vm.SelectedTabIndex = 5;

        _mockNav.VerifySet(n => n.ActiveTabKey = It.IsAny<string?>(), Times.Never);
    }

    // ---- ConnectedDc non-null ----

    [Fact]
    public void ConnectedDc_ReturnsValue_WhenNonNull()
    {
        _mockDir.Setup(d => d.ConnectedDc).Returns("dc01.contoso.com");
        var vm = CreateViewModel();
        vm.ConnectedDc.Should().Be("dc01.contoso.com");
    }

    // ---- ActiveTabKey same value ----

    [Fact]
    public void ActiveTabKey_SetToSameValue_DoesNotRaisePropertyChanged()
    {
        _mockNav.Setup(n => n.ActiveTabKey).Returns("users");

        var vm = CreateViewModel();

        _mockNav.Setup(n => n.ActiveTabKey).Returns("users");

        var propertyChangedRaised = false;
        vm.PropertyChanged += (_, args) =>
        {
            if (args.PropertyName == nameof(vm.ActiveTabKey))
                propertyChangedRaised = true;
        };

        vm.ActiveTabKey = "users";

        propertyChangedRaised.Should().BeFalse();
    }
}
