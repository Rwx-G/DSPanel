using System.Diagnostics.CodeAnalysis;
using System.Windows;
using DSPanel.Services.Dialog;
using DSPanel.Services.Directory;
using DSPanel.Services.Export;
using DSPanel.Services.Health;
using DSPanel.Services.Navigation;
using DSPanel.Services.Network;
using DSPanel.Services.Notifications;
using DSPanel.Services.Permissions;
using DSPanel.Services.Settings;
using DSPanel.Services.Theme;
using DSPanel.ViewModels;
using DSPanel.Views.Pages;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Serilog;
using Serilog.Events;

namespace DSPanel;

[ExcludeFromCodeCoverage]
public partial class App : Application
{
    private IHost? _host;

    /// <summary>
    /// Provides access to the DI service provider for controls that need to
    /// resolve services outside of constructor injection (e.g. UserControls).
    /// </summary>
    public static IServiceProvider? ServiceProvider { get; private set; }

    protected override async void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);

        _host = Host.CreateDefaultBuilder()
            .UseSerilog((context, services, configuration) =>
            {
                configuration
                    .MinimumLevel.Information()
                    .MinimumLevel.Override("Microsoft", LogEventLevel.Warning)
                    .WriteTo.Console()
                    .WriteTo.File("logs/dspanel-.log",
                        rollingInterval: RollingInterval.Day,
                        retainedFileCountLimit: 30);
            })
            .ConfigureServices((context, services) =>
            {
                // Directory
                services.AddSingleton<ILdapConnectionFactory, LdapConnectionFactory>();
                services.AddSingleton<IDirectoryProvider, LdapDirectoryProvider>();

                // Permissions
                services.Configure<PermissionOptions>(context.Configuration.GetSection("Permissions"));
                services.AddSingleton<IPermissionService, PermissionService>();

                // Settings
                services.AddSingleton<IAppSettingsService, AppSettingsService>();

                // Theme
                services.AddSingleton<IThemeService, ThemeService>();

                // Export
                services.AddSingleton<ICsvExportService, CsvExportService>();

                // Dialog
                services.AddSingleton<IFileDialogService, FileDialogService>();
                services.AddSingleton<IDialogService, DialogService>();

                // Navigation
                services.AddSingleton<INavigationService, NavigationService>();

                // Network
                services.AddSingleton<INetworkService, NetworkService>();

                // Health
                services.AddSingleton<IHealthCheckService, HealthCheckService>();

                // Notifications
                services.AddSingleton<INotificationService>(sp =>
                    new NotificationService(
                        sp.GetRequiredService<Microsoft.Extensions.Logging.ILogger<NotificationService>>(),
                        action => System.Windows.Threading.Dispatcher.CurrentDispatcher.Invoke(action)));

                // ViewModels
                services.AddTransient<MainViewModel>();
                services.AddTransient<UserLookupViewModel>();
                services.AddTransient<ComputerLookupViewModel>();

                // Windows
                services.AddSingleton<MainWindow>();
            })
            .Build();

        await _host.StartAsync();
        ServiceProvider = _host.Services;

        // Register view factories for module navigation
        var navigationService = _host.Services.GetRequiredService<INavigationService>();
        navigationService.RegisterViewFactory("users", () =>
        {
            var view = new UserLookupView();
            view.DataContext = _host.Services.GetRequiredService<UserLookupViewModel>();
            return view;
        });
        navigationService.RegisterViewFactory("computers", () =>
        {
            var view = new ComputerLookupView();
            view.DataContext = _host.Services.GetRequiredService<ComputerLookupViewModel>();
            return view;
        });

        // Restore persisted theme
        var themeService = _host.Services.GetRequiredService<IThemeService>();
        themeService.ApplyTheme(themeService.CurrentTheme);

        Log.Information("DSPanel starting");

        // Connect to AD and detect permissions
        var directoryProvider = _host.Services.GetRequiredService<IDirectoryProvider>();
        await directoryProvider.TestConnectionAsync();

        var permissionService = _host.Services.GetRequiredService<IPermissionService>();
        await permissionService.DetectPermissionsAsync();

        var mainWindow = _host.Services.GetRequiredService<MainWindow>();
        mainWindow.Show();
    }

    protected override async void OnExit(ExitEventArgs e)
    {
        Log.Information("DSPanel shutting down");

        if (_host is not null)
        {
            await _host.StopAsync();
            _host.Dispose();
        }

        await Log.CloseAndFlushAsync();
        base.OnExit(e);
    }
}
