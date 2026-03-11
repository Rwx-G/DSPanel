using System.Globalization;
using System.Windows;
using System.Windows.Data;

namespace DSPanel.Converters;

/// <summary>
/// Returns Visible when the string value is non-null and non-empty,
/// otherwise Collapsed.
/// </summary>
[ValueConversion(typeof(string), typeof(Visibility))]
public class NonEmptyStringToVisibilityConverter : IValueConverter
{
    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        return string.IsNullOrEmpty(value as string) ? Visibility.Collapsed : Visibility.Visible;
    }

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        throw new NotSupportedException();
    }
}
