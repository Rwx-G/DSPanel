using System.Windows;
using System.Windows.Media;

namespace DSPanel.Views.Dialogs;

public partial class ConfirmationDialog : Window
{
    public ConfirmationDialog(string title, string message, string? details, DialogSeverity severity)
    {
        InitializeComponent();
        DataContext = new ConfirmationDialogModel(title, message, details);

        ApplySeverityStyle(severity);
    }

    private void ApplySeverityStyle(DialogSeverity severity)
    {
        var (iconKey, brushKey) = severity switch
        {
            DialogSeverity.Warning => ("IconWarning", "BrushWarning"),
            DialogSeverity.Error => ("IconError", "BrushError"),
            _ => ("IconQuestion", "BrushPrimary")
        };

        IconPath.Data = (Geometry)FindResource(iconKey);
        IconPath.Fill = (Brush)FindResource(brushKey);
    }

    private void OnConfirmClick(object sender, RoutedEventArgs e)
    {
        DialogResult = true;
        Close();
    }

    private void OnCancelClick(object sender, RoutedEventArgs e)
    {
        DialogResult = false;
        Close();
    }

    protected override void OnMouseLeftButtonDown(System.Windows.Input.MouseButtonEventArgs e)
    {
        base.OnMouseLeftButtonDown(e);
        DragMove();
    }
}

public enum DialogSeverity
{
    Question,
    Warning,
    Error
}

public sealed class ConfirmationDialogModel
{
    public string Title { get; }
    public string Message { get; }
    public string? Details { get; }
    public bool HasDetails => !string.IsNullOrEmpty(Details);

    public ConfirmationDialogModel(string title, string message, string? details)
    {
        Title = title;
        Message = message;
        Details = details;
    }
}
