using System.Globalization;
using System.Windows;
using System.Windows.Data;
using System.Windows.Media;

namespace DSPanel.Converters;

/// <summary>
/// Converts a resource key string (e.g. "IconUser") to the corresponding
/// <see cref="Geometry"/> from application resources.
/// Used in XAML as a static singleton via <c>x:Static</c>.
/// </summary>
[ValueConversion(typeof(string), typeof(Geometry))]
public class GeometryResourceConverter : IValueConverter
{
    public static readonly GeometryResourceConverter Instance = new();

    public object? Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        if (value is not string key || string.IsNullOrEmpty(key))
            return null;

        return Application.Current.TryFindResource(key) as Geometry;
    }

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        throw new NotSupportedException();
    }
}
