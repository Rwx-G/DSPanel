using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using DSPanel.Models;

namespace DSPanel.Views.Controls;

/// <summary>
/// Displays a colored dot/pill indicating the health status of an account.
/// Shows a tooltip listing all active health flags.
/// </summary>
public partial class HealthBadge : UserControl
{
    public static readonly DependencyProperty HealthStatusProperty =
        DependencyProperty.Register(
            nameof(HealthStatus),
            typeof(AccountHealthStatus),
            typeof(HealthBadge),
            new PropertyMetadata(null, OnHealthStatusChanged));

    public AccountHealthStatus? HealthStatus
    {
        get => (AccountHealthStatus?)GetValue(HealthStatusProperty);
        set => SetValue(HealthStatusProperty, value);
    }

    public HealthBadge()
    {
        InitializeComponent();
    }

    private static void OnHealthStatusChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        if (d is HealthBadge badge)
        {
            badge.UpdateAppearance();
        }
    }

    private void UpdateAppearance()
    {
        if (HealthStatus is null)
        {
            Visibility = Visibility.Collapsed;
            return;
        }

        Visibility = Visibility.Visible;
        PART_Text.Text = HealthStatus.StatusText;

        var (bgKey, fgKey, dotBrush) = HealthStatus.OverallLevel switch
        {
            HealthLevel.Healthy => ("BrushSuccessLight", "BrushSuccess", Brushes.Green),
            HealthLevel.Info => ("BrushInfoLight", "BrushInfo", Brushes.DodgerBlue),
            HealthLevel.Warning => ("BrushWarningLight", "BrushWarning", Brushes.Orange),
            HealthLevel.Critical => ("BrushErrorLight", "BrushError", Brushes.Red),
            _ => ("BrushRowAlternate", "BrushTextSecondary", Brushes.Gray)
        };

        PART_Dot.Fill = TryFindResource(fgKey) is Brush fg ? fg : dotBrush;

        if (TryFindResource(bgKey) is Brush bg)
            PART_Border.Background = bg;

        if (TryFindResource(fgKey) is Brush textFg)
            PART_Text.Foreground = textFg;

        // Update tooltip with active flags
        if (HealthStatus.ActiveFlags.Count > 0)
        {
            PART_FlagsList.ItemsSource = HealthStatus.ActiveFlags;
            PART_ToolTip.Visibility = Visibility.Visible;
        }
        else
        {
            PART_FlagsList.ItemsSource = null;
            PART_ToolTip.Visibility = Visibility.Collapsed;
        }
    }
}
