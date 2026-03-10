using System.Diagnostics.CodeAnalysis;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media.Animation;
using DSPanel.Services.Notifications;

namespace DSPanel.Views.Controls;

[ExcludeFromCodeCoverage]
public partial class NotificationHost : UserControl
{
    public NotificationHost()
    {
        InitializeComponent();
        Loaded += OnLoaded;
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        var service = App.ServiceProvider?.GetService(typeof(INotificationService)) as INotificationService;
        if (service is not null)
        {
            PART_Items.ItemsSource = service.Notifications;
        }
    }

    private void CountdownBar_Loaded(object sender, RoutedEventArgs e)
    {
        if (sender is not Border bar)
            return;

        // Get the NotificationItem from DataContext
        if (bar.DataContext is not NotificationItem item || item.DurationMs <= 0)
            return;

        var animation = new DoubleAnimation
        {
            From = bar.Width,
            To = 0,
            Duration = new Duration(TimeSpan.FromMilliseconds(item.DurationMs))
        };

        bar.BeginAnimation(WidthProperty, animation);
    }
}
