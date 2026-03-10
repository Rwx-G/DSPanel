using System.Windows;
using System.Windows.Controls;
using DSPanel.Services.Notifications;

namespace DSPanel.Views.Controls;

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
}
