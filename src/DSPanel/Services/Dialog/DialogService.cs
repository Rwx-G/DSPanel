using System.Windows;
using DSPanel.Models;
using DSPanel.Views.Dialogs;

namespace DSPanel.Services.Dialog;

/// <summary>
/// Dialog service using custom styled dialogs.
/// </summary>
public class DialogService : IDialogService
{
    public Task<bool> ShowConfirmationAsync(string title, string message, string? details = null)
    {
        var dialog = CreateDialog(title, message, details, DialogSeverity.Question);
        var result = dialog.ShowDialog() == true;
        return Task.FromResult(result);
    }

    public Task ShowErrorAsync(string title, string message)
    {
        var dialog = CreateDialog(title, message, null, DialogSeverity.Error);
        dialog.ShowDialog();
        return Task.CompletedTask;
    }

    public Task ShowWarningAsync(string title, string message)
    {
        var dialog = CreateDialog(title, message, null, DialogSeverity.Warning);
        dialog.ShowDialog();
        return Task.CompletedTask;
    }

    public async Task<bool> ShowProgressAsync(
        string title, Func<IProgress<ProgressInfo>, CancellationToken, Task> work)
    {
        var dialog = new ProgressDialog(title)
        {
            Owner = Application.Current.MainWindow
        };
        await dialog.RunAsync(work);
        return dialog.WasSuccessful;
    }

    private static ConfirmationDialog CreateDialog(
        string title, string message, string? details, DialogSeverity severity)
    {
        var dialog = new ConfirmationDialog(title, message, details, severity)
        {
            Owner = Application.Current.MainWindow
        };
        return dialog;
    }
}
