using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Moq;
using Serilog;
using Serilog.Events;
using DSPanel.Services.Dialog;
using DSPanel.Services.Directory;
using DSPanel.Services.Navigation;
using DSPanel.Services.Notifications;
using DSPanel.Services.Permissions;
using DSPanel.Services.Theme;
using DSPanel.ViewModels;

namespace DSPanel.Tests;

public class BootstrapTests
{
    private static IHost BuildTestHost()
    {
        return Host.CreateDefaultBuilder()
            .UseSerilog((context, services, configuration) =>
            {
                configuration
                    .MinimumLevel.Information()
                    .MinimumLevel.Override("Microsoft", LogEventLevel.Warning)
                    .WriteTo.Console();
            })
            .ConfigureServices((context, services) =>
            {
                services.AddSingleton<IDialogService>(new Mock<IDialogService>().Object);
                services.AddSingleton<INavigationService, NavigationService>();
                services.AddSingleton<IPermissionService>(new Mock<IPermissionService>().Object);
                services.AddSingleton<IThemeService>(new Mock<IThemeService>().Object);
                services.AddSingleton<IDirectoryProvider>(new Mock<IDirectoryProvider>().Object);
                services.AddSingleton<INotificationService>(new Mock<INotificationService>().Object);
                services.AddTransient<MainViewModel>();
            })
            .Build();
    }

    [Fact]
    public void Host_Builds_WithoutExceptions()
    {
        var host = BuildTestHost();

        host.Should().NotBeNull();
        host.Dispose();
    }

    [Fact]
    public void MainViewModel_Resolves_FromDI()
    {
        using var host = BuildTestHost();

        var viewModel = host.Services.GetRequiredService<MainViewModel>();

        viewModel.Should().NotBeNull();
        viewModel.Title.Should().Be("DSPanel");
    }

    [Fact]
    public void SerilogLogger_Resolves_FromDI()
    {
        using var host = BuildTestHost();

        var logger = host.Services.GetRequiredService<ILogger<BootstrapTests>>();

        logger.Should().NotBeNull();
    }
}
