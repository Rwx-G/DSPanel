using System.Globalization;
using System.Windows;
using System.Windows.Data;
using System.Windows.Media;
using DSPanel.Services.Notifications;

namespace DSPanel.Converters;

public class NotificationSeverityToBrushConverter : IValueConverter
{
    public object Convert(object value, Type targetType, object parameter, CultureInfo culture)
    {
        if (value is not NotificationSeverity severity)
            return DependencyProperty.UnsetValue;

        var resourceKey = severity switch
        {
            NotificationSeverity.Success => "BrushSuccess",
            NotificationSeverity.Warning => "BrushWarning",
            NotificationSeverity.Error => "BrushError",
            _ => "BrushInfo"
        };

        return Application.Current.FindResource(resourceKey) as Brush
            ?? Brushes.Gray;
    }

    public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture)
        => throw new NotSupportedException();
}
