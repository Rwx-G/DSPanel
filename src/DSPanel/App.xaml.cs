using System.Windows;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Serilog;
using Serilog.Events;
using DSPanel.Services.Directory;
using DSPanel.Services.Navigation;
using DSPanel.Services.Permissions;
using DSPanel.Services.Theme;
using DSPanel.ViewModels;

namespace DSPanel;

public partial class App : Application
{
    private IHost? _host;

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

                // Theme
                services.AddSingleton<IThemeService, ThemeService>();

                // Navigation
                services.AddSingleton<INavigationService, NavigationService>();

                // ViewModels
                services.AddTransient<MainViewModel>();

                // Windows
                services.AddSingleton<MainWindow>();
            })
            .Build();

        await _host.StartAsync();

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
