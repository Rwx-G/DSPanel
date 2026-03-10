namespace DSPanel.Services.Dialog;

/// <summary>
/// Abstracts file dialog interactions for testability.
/// </summary>
public interface IFileDialogService
{
    /// <summary>
    /// Shows a save-file dialog. Returns the chosen path, or null if cancelled.
    /// </summary>
    string? ShowSaveFileDialog(string filter, string defaultExt, string fileName);
}
