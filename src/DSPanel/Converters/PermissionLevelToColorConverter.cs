using System.Globalization;
using System.Windows.Data;
using System.Windows.Media;
using DSPanel.Services.Permissions;

namespace DSPanel.Converters;

/// <summary>
/// Converts a <see cref="PermissionLevel"/> to a <see cref="SolidColorBrush"/> for badge display.
/// </summary>
[ValueConversion(typeof(PermissionLevel), typeof(SolidColorBrush))]
public class PermissionLevelToColorConverter : IValueConverter
{
    private static readonly SolidColorBrush ReadOnlyBrush = new(Color.FromRgb(107, 114, 128));   // Gray
    private static readonly SolidColorBrush HelpDeskBrush = new(Color.FromRgb(37, 99, 235));     // Blue
    private static readonly SolidColorBrush AccountOpsBrush = new(Color.FromRgb(217, 119, 6));   // Amber
    private static readonly SolidColorBrush DomainAdminBrush = new(Color.FromRgb(220, 38, 38));  // Red

    static PermissionLevelToColorConverter()
    {
        ReadOnlyBrush.Freeze();
        HelpDeskBrush.Freeze();
        AccountOpsBrush.Freeze();
        DomainAdminBrush.Freeze();
    }

    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        return value is PermissionLevel level
            ? level switch
            {
                PermissionLevel.ReadOnly => ReadOnlyBrush,
                PermissionLevel.HelpDesk => HelpDeskBrush,
                PermissionLevel.AccountOperator => AccountOpsBrush,
                PermissionLevel.DomainAdmin => DomainAdminBrush,
                _ => ReadOnlyBrush
            }
            : ReadOnlyBrush;
    }

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        throw new NotSupportedException();
    }
}
