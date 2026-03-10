using DSPanel.Models;
using DSPanel.Services.Permissions;
using FluentAssertions;

namespace DSPanel.Tests.Models;

public class SidebarItemTests
{
    [Fact]
    public void Default_AllStringsAreEmpty()
    {
        var item = new SidebarItem();

        item.Key.Should().BeEmpty();
        item.Label.Should().BeEmpty();
        item.IconGeometryKey.Should().BeEmpty();
        item.Category.Should().BeEmpty();
    }

    [Fact]
    public void Default_RequiredPermission_IsNull()
    {
        var item = new SidebarItem();
        item.RequiredPermission.Should().BeNull();
    }

    [Fact]
    public void Init_SetsAllProperties()
    {
        var item = new SidebarItem
        {
            Key = "users",
            Label = "Users",
            IconGeometryKey = "IconUser",
            Category = "Lookup",
            RequiredPermission = PermissionLevel.HelpDesk
        };

        item.Key.Should().Be("users");
        item.Label.Should().Be("Users");
        item.IconGeometryKey.Should().Be("IconUser");
        item.Category.Should().Be("Lookup");
        item.RequiredPermission.Should().Be(PermissionLevel.HelpDesk);
    }
}
