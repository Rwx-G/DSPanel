using System.Diagnostics.CodeAnalysis;
using Microsoft.Win32;

namespace DSPanel.Services.Dialog;

/// <summary>
/// Wraps WPF SaveFileDialog behind <see cref="IFileDialogService"/>.
/// </summary>
[ExcludeFromCodeCoverage]
public class FileDialogService : IFileDialogService
{
    public string? ShowSaveFileDialog(string filter, string defaultExt, string fileName)
    {
        var dialog = new SaveFileDialog
        {
            Filter = filter,
            DefaultExt = defaultExt,
            FileName = fileName
        };
        return dialog.ShowDialog() == true ? dialog.FileName : null;
    }
}
