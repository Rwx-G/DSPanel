using FluentAssertions;
using TabItem = DSPanel.Models.TabItem;

namespace DSPanel.Tests.Models;

public class TabItemTests
{
    [Fact]
    public void Default_Key_IsEmpty()
    {
        var tab = new TabItem();
        tab.Key.Should().BeEmpty();
    }

    [Fact]
    public void Default_CanClose_IsTrue()
    {
        var tab = new TabItem();
        tab.CanClose.Should().BeTrue();
    }

    [Fact]
    public void Default_IsActive_IsFalse()
    {
        var tab = new TabItem();
        tab.IsActive.Should().BeFalse();
    }

    [Fact]
    public void Default_Content_IsNull()
    {
        var tab = new TabItem();
        tab.Content.Should().BeNull();
    }

    [Fact]
    public void PropertyChanged_Fires_OnKeyChange()
    {
        var tab = new TabItem();
        var changed = false;
        tab.PropertyChanged += (_, e) =>
        {
            if (e.PropertyName == nameof(TabItem.Key)) changed = true;
        };

        tab.Key = "users";

        changed.Should().BeTrue();
        tab.Key.Should().Be("users");
    }

    [Fact]
    public void PropertyChanged_Fires_OnTitleChange()
    {
        var tab = new TabItem();
        var changed = false;
        tab.PropertyChanged += (_, e) =>
        {
            if (e.PropertyName == nameof(TabItem.Title)) changed = true;
        };

        tab.Title = "Users";

        changed.Should().BeTrue();
        tab.Title.Should().Be("Users");
    }
}
