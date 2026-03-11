using System.Globalization;
using System.Windows;
using System.Windows.Data;

namespace DSPanel.Converters;

/// <summary>
/// Multi-value converter that returns <see cref="Visibility.Visible"/> when the first
/// two bound values are equal (using string comparison, case-insensitive), and
/// <see cref="Visibility.Collapsed"/> otherwise.
/// </summary>
public class EqualityToVisibilityConverter : IMultiValueConverter
{
    public object Convert(object?[] values, Type targetType, object? parameter, CultureInfo culture)
    {
        if (values.Length < 2)
            return Visibility.Collapsed;

        var a = values[0]?.ToString();
        var b = values[1]?.ToString();

        return string.Equals(a, b, StringComparison.OrdinalIgnoreCase)
            ? Visibility.Visible
            : Visibility.Collapsed;
    }

    public object[] ConvertBack(object? value, Type[] targetTypes, object? parameter, CultureInfo culture)
    {
        throw new NotSupportedException();
    }
}
