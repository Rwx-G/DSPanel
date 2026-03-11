using System.Globalization;
using System.Windows;
using System.Windows.Data;
using System.Windows.Media;
using DSPanel.Services.Notifications;

namespace DSPanel.Converters;

public class NotificationSeverityToIconConverter : IValueConverter
{
    public object Convert(object value, Type targetType, object parameter, CultureInfo culture)
    {
        if (value is not NotificationSeverity severity)
            return DependencyProperty.UnsetValue;

        var iconKey = severity switch
        {
            NotificationSeverity.Success => "IconSuccess",
            NotificationSeverity.Warning => "IconWarning",
            NotificationSeverity.Error => "IconError",
            _ => "IconInfo"
        };

        return Application.Current.FindResource(iconKey) as Geometry
            ?? Geometry.Empty;
    }

    public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture)
        => throw new NotSupportedException();
}
