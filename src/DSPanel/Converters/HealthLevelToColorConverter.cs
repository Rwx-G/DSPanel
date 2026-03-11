using System.Globalization;
using System.Windows.Data;
using System.Windows.Media;
using DSPanel.Models;

namespace DSPanel.Converters;

/// <summary>
/// Converts a <see cref="HealthLevel"/> enum value to the corresponding theme brush.
/// Falls back to a gray brush when the resource is not available.
/// </summary>
[ValueConversion(typeof(HealthLevel), typeof(Brush))]
public class HealthLevelToColorConverter : IValueConverter
{
    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        if (value is not HealthLevel level)
            return Brushes.Gray;

        var brushKey = level switch
        {
            HealthLevel.Healthy => "BrushSuccess",
            HealthLevel.Info => "BrushInfo",
            HealthLevel.Warning => "BrushWarning",
            HealthLevel.Critical => "BrushError",
            _ => "BrushTextSecondary"
        };

        if (System.Windows.Application.Current?.TryFindResource(brushKey) is Brush brush)
            return brush;

        // Fallback colors when theme resources are not available
        return level switch
        {
            HealthLevel.Healthy => Brushes.Green,
            HealthLevel.Info => Brushes.DodgerBlue,
            HealthLevel.Warning => Brushes.Orange,
            HealthLevel.Critical => Brushes.Red,
            _ => Brushes.Gray
        };
    }

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        throw new NotSupportedException();
    }
}
