using System.IO;
using System.Text.Json;
using System.Windows;
using CommunityToolkit.Mvvm.ComponentModel;
using Microsoft.Extensions.Logging;

namespace DSPanel.Services.Theme;

public partial class ThemeService : ObservableObject, IThemeService
{
    private const int ThemeDictionaryIndex = 1;
    private static readonly string SettingsPath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "DSPanel", "theme.json");

    private readonly ILogger<ThemeService> _logger;

    [ObservableProperty]
    private ThemeMode _currentTheme;

    public ThemeService(ILogger<ThemeService> logger)
    {
        _logger = logger;
        _currentTheme = LoadPersistedTheme();
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
        PersistTheme(mode);
        _logger.LogInformation("Theme changed to {Theme}", mode);
    }

    public void ToggleTheme()
    {
        ApplyTheme(CurrentTheme == ThemeMode.Light ? ThemeMode.Dark : ThemeMode.Light);
    }

    private ThemeMode LoadPersistedTheme()
    {
        try
        {
            if (File.Exists(SettingsPath))
            {
                var json = File.ReadAllText(SettingsPath);
                var settings = JsonSerializer.Deserialize<ThemeSettings>(json);
                if (settings is not null && Enum.TryParse<ThemeMode>(settings.Theme, out var mode))
                    return mode;
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to load theme preference");
        }

        return ThemeMode.Light;
    }

    private void PersistTheme(ThemeMode mode)
    {
        try
        {
            var directory = Path.GetDirectoryName(SettingsPath)!;
            System.IO.Directory.CreateDirectory(directory);
            var json = JsonSerializer.Serialize(new ThemeSettings { Theme = mode.ToString() });
            File.WriteAllText(SettingsPath, json);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to persist theme preference");
        }
    }

    private sealed class ThemeSettings
    {
        public string Theme { get; set; } = nameof(ThemeMode.Light);
    }
}
