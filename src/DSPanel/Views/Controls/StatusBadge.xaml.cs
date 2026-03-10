using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace DSPanel.Views.Controls;

/// <summary>
/// Severity levels for the status badge display.
/// </summary>
public enum BadgeSeverity
{
    Neutral,
    Success,
    Warning,
    Error,
    Info
}

/// <summary>
/// Colored pill/chip that displays a text label with a severity-based color.
/// </summary>
public partial class StatusBadge : UserControl
{
    public static readonly DependencyProperty TextProperty =
        DependencyProperty.Register(
            nameof(Text),
            typeof(string),
            typeof(StatusBadge),
            new PropertyMetadata(string.Empty, OnAppearanceChanged));

    public static readonly DependencyProperty SeverityProperty =
        DependencyProperty.Register(
            nameof(Severity),
            typeof(BadgeSeverity),
            typeof(StatusBadge),
            new PropertyMetadata(BadgeSeverity.Neutral, OnAppearanceChanged));

    public string Text
    {
        get => (string)GetValue(TextProperty);
        set => SetValue(TextProperty, value);
    }

    public BadgeSeverity Severity
    {
        get => (BadgeSeverity)GetValue(SeverityProperty);
        set => SetValue(SeverityProperty, value);
    }

    public StatusBadge()
    {
        InitializeComponent();
        UpdateAppearance();
    }

    private static void OnAppearanceChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        if (d is StatusBadge badge)
        {
            badge.UpdateAppearance();
        }
    }

    private void UpdateAppearance()
    {
        PART_Text.Text = Text;

        var (bgKey, fgKey) = Severity switch
        {
            BadgeSeverity.Success => ("BrushSuccessLight", "BrushSuccess"),
            BadgeSeverity.Warning => ("BrushWarningLight", "BrushWarning"),
            BadgeSeverity.Error => ("BrushErrorLight", "BrushError"),
            BadgeSeverity.Info => ("BrushInfoLight", "BrushInfo"),
            _ => ("BrushRowAlternate", "BrushTextSecondary")
        };

        if (TryFindResource(bgKey) is Brush bg)
            PART_Border.Background = bg;

        if (TryFindResource(fgKey) is Brush fg)
            PART_Text.Foreground = fg;
    }
}
