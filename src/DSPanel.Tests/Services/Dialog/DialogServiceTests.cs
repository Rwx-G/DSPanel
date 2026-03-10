using DSPanel.Services.Dialog;
using FluentAssertions;
using Moq;

namespace DSPanel.Tests.Services.Dialog;

/// <summary>
/// Verifies that IDialogService contract is testable via mock.
/// The concrete DialogService uses WPF MessageBox which cannot be unit-tested
/// without a running UI thread, so we verify the interface contract instead.
/// </summary>
public class DialogServiceTests
{
    [Fact]
    public async Task ShowConfirmationAsync_WhenMockedTrue_ReturnsTrue()
    {
        var mock = new Mock<IDialogService>();
        mock.Setup(d => d.ShowConfirmationAsync(
                It.IsAny<string>(),
                It.IsAny<string>(),
                It.IsAny<string?>()))
            .ReturnsAsync(true);

        var result = await mock.Object.ShowConfirmationAsync("Title", "Message");

        result.Should().BeTrue();
    }

    [Fact]
    public async Task ShowConfirmationAsync_WhenMockedFalse_ReturnsFalse()
    {
        var mock = new Mock<IDialogService>();
        mock.Setup(d => d.ShowConfirmationAsync(
                It.IsAny<string>(),
                It.IsAny<string>(),
                It.IsAny<string?>()))
            .ReturnsAsync(false);

        var result = await mock.Object.ShowConfirmationAsync("Delete?", "Are you sure?", "Details here");

        result.Should().BeFalse();
    }

    [Fact]
    public async Task ShowErrorAsync_CanBeMocked()
    {
        var mock = new Mock<IDialogService>();
        mock.Setup(d => d.ShowErrorAsync(It.IsAny<string>(), It.IsAny<string>()))
            .Returns(Task.CompletedTask);

        await mock.Object.ShowErrorAsync("Error", "Something went wrong");

        mock.Verify(d => d.ShowErrorAsync("Error", "Something went wrong"), Times.Once);
    }

    [Fact]
    public async Task ShowWarningAsync_CanBeMocked()
    {
        var mock = new Mock<IDialogService>();
        mock.Setup(d => d.ShowWarningAsync(It.IsAny<string>(), It.IsAny<string>()))
            .Returns(Task.CompletedTask);

        await mock.Object.ShowWarningAsync("Warning", "Be careful");

        mock.Verify(d => d.ShowWarningAsync("Warning", "Be careful"), Times.Once);
    }

    [Fact]
    public async Task ShowConfirmationAsync_WithDetails_PassesDetailsToImplementation()
    {
        var mock = new Mock<IDialogService>();
        string? capturedDetails = null;
        mock.Setup(d => d.ShowConfirmationAsync(
                It.IsAny<string>(),
                It.IsAny<string>(),
                It.IsAny<string?>()))
            .Callback<string, string, string?>((_, _, details) => capturedDetails = details)
            .ReturnsAsync(true);

        await mock.Object.ShowConfirmationAsync("Title", "Message", "Extra details");

        capturedDetails.Should().Be("Extra details");
    }

    [Fact]
    public async Task ShowConfirmationAsync_WithoutDetails_DefaultsToNull()
    {
        var mock = new Mock<IDialogService>();
        string? capturedDetails = "not-null";
        mock.Setup(d => d.ShowConfirmationAsync(
                It.IsAny<string>(),
                It.IsAny<string>(),
                It.IsAny<string?>()))
            .Callback<string, string, string?>((_, _, details) => capturedDetails = details)
            .ReturnsAsync(true);

        await mock.Object.ShowConfirmationAsync("Title", "Message");

        capturedDetails.Should().BeNull();
    }
}
