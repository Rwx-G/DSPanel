using System.Globalization;
using System.Windows;
using System.Windows.Data;

namespace DSPanel.Converters;

/// <summary>
/// Converts a boolean value to a <see cref="Visibility"/> value.
/// True maps to Visible, False maps to Collapsed.
/// Pass "Invert" as the converter parameter to reverse the logic.
/// </summary>
[ValueConversion(typeof(bool), typeof(Visibility))]
public class BoolToVisibilityConverter : IValueConverter
{
    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        var flag = value is true;
        var invert = parameter is string s && s.Equals("Invert", StringComparison.OrdinalIgnoreCase);

        if (invert)
            flag = !flag;

        return flag ? Visibility.Visible : Visibility.Collapsed;
    }

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        var isVisible = value is Visibility.Visible;
        var invert = parameter is string s && s.Equals("Invert", StringComparison.OrdinalIgnoreCase);

        return invert ? !isVisible : isVisible;
    }
}
