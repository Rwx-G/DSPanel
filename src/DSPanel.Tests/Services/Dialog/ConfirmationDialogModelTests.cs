using DSPanel.Views.Dialogs;
using FluentAssertions;

namespace DSPanel.Tests.Services.Dialog;

public class ConfirmationDialogModelTests
{
    [Fact]
    public void HasDetails_WhenDetailsProvided_ReturnsTrue()
    {
        var model = new ConfirmationDialogModel("Title", "Message", "Some details");

        model.HasDetails.Should().BeTrue();
    }

    [Fact]
    public void HasDetails_WhenDetailsNull_ReturnsFalse()
    {
        var model = new ConfirmationDialogModel("Title", "Message", null);

        model.HasDetails.Should().BeFalse();
    }

    [Fact]
    public void HasDetails_WhenDetailsEmpty_ReturnsFalse()
    {
        var model = new ConfirmationDialogModel("Title", "Message", "");

        model.HasDetails.Should().BeFalse();
    }

    [Fact]
    public void Constructor_SetsAllProperties()
    {
        var model = new ConfirmationDialogModel("My Title", "My Message", "My Details");

        model.Title.Should().Be("My Title");
        model.Message.Should().Be("My Message");
        model.Details.Should().Be("My Details");
    }
}
