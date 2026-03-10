namespace DSPanel.Services.Dialog;

/// <summary>
/// Provides dialog and notification capabilities for user feedback.
/// </summary>
public interface IDialogService
{
    /// <summary>
    /// Shows a confirmation dialog with OK/Cancel or Yes/No buttons.
    /// Returns true when the user confirms, false otherwise.
    /// </summary>
    Task<bool> ShowConfirmationAsync(string title, string message, string? details = null);

    /// <summary>
    /// Shows an error dialog with a message.
    /// </summary>
    Task ShowErrorAsync(string title, string message);

    /// <summary>
    /// Shows a warning dialog with a message.
    /// </summary>
    Task ShowWarningAsync(string title, string message);
}
