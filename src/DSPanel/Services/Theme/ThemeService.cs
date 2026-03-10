using System.Windows;
using CommunityToolkit.Mvvm.ComponentModel;
using DSPanel.Services.Settings;
using Microsoft.Extensions.Logging;

namespace DSPanel.Services.Theme;

public partial class ThemeService : ObservableObject, IThemeService
{
    private const int ThemeDictionaryIndex = 1;

    private readonly IAppSettingsService _settingsService;
    private readonly ILogger<ThemeService> _logger;

    [ObservableProperty]
    private ThemeMode _currentTheme;

    public ThemeService(IAppSettingsService settingsService, ILogger<ThemeService> logger)
    {
        _settingsService = settingsService;
        _logger = logger;
        _currentTheme = Enum.TryParse<ThemeMode>(_settingsService.Current.Theme, out var mode)
            ? mode
            : ThemeMode.Light;
    }

    public void ApplyTheme(ThemeMode mode)
    {
        var dictionaries = Application.Current.Resources.MergedDictionaries;
        var themeUri = mode switch
        {
            ThemeMode.Dark => new Uri("Resources/Styles/DarkTheme.xaml", UriKind.Relative),
            _ => new Uri("Resources/Styles/LightTheme.xaml", UriKind.Relative)
        };

        if (ThemeDictionaryIndex < dictionaries.Count)
        {
            dictionaries[ThemeDictionaryIndex] = new ResourceDictionary { Source = themeUri };
        }

        CurrentTheme = mode;
        _settingsService.Current.Theme = mode.ToString();
        _settingsService.Save();
        _logger.LogInformation("Theme changed to {Theme}", mode);
    }

    public void ToggleTheme()
    {
        ApplyTheme(CurrentTheme == ThemeMode.Light ? ThemeMode.Dark : ThemeMode.Light);
    }
}
