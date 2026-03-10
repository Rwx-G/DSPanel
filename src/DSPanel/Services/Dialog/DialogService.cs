using System.Windows;

namespace DSPanel.Services.Dialog;

/// <summary>
/// Simple dialog service implementation using WPF MessageBox.
/// Will be replaced with custom styled dialogs in a future story.
/// </summary>
public class DialogService : IDialogService
{
    public Task<bool> ShowConfirmationAsync(string title, string message, string? details = null)
    {
        var fullMessage = details is not null
            ? $"{message}\n\n{details}"
            : message;

        var result = MessageBox.Show(
            fullMessage,
            title,
            MessageBoxButton.YesNo,
            MessageBoxImage.Question);

        return Task.FromResult(result == MessageBoxResult.Yes);
    }

    public Task ShowErrorAsync(string title, string message)
    {
        MessageBox.Show(
            message,
            title,
            MessageBoxButton.OK,
            MessageBoxImage.Error);

        return Task.CompletedTask;
    }

    public Task ShowWarningAsync(string title, string message)
    {
        MessageBox.Show(
            message,
            title,
            MessageBoxButton.OK,
            MessageBoxImage.Warning);

        return Task.CompletedTask;
    }
}
