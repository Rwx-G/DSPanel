using System.IO;
using System.Text.Json;
using Microsoft.Extensions.Logging;

namespace DSPanel.Services.Settings;

public sealed class AppSettingsService : IAppSettingsService
{
    private static readonly string DefaultPath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "DSPanel", "settings.json");

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true
    };

    private readonly string _settingsPath;
    private readonly ILogger<AppSettingsService> _logger;

    public AppSettings Current { get; }

    public AppSettingsService(ILogger<AppSettingsService> logger)
        : this(logger, DefaultPath)
    {
    }

    internal AppSettingsService(ILogger<AppSettingsService> logger, string settingsPath)
    {
        _logger = logger;
        _settingsPath = settingsPath;
        Current = Load();
    }

    public void Save()
    {
        try
        {
            var directory = Path.GetDirectoryName(_settingsPath)!;
            System.IO.Directory.CreateDirectory(directory);
            var json = JsonSerializer.Serialize(Current, JsonOptions);
            File.WriteAllText(_settingsPath, json);
            _logger.LogDebug("Settings saved to {Path}", _settingsPath);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to save settings to {Path}", _settingsPath);
        }
    }

    private AppSettings Load()
    {
        try
        {
            if (File.Exists(_settingsPath))
            {
                var json = File.ReadAllText(_settingsPath);
                var settings = JsonSerializer.Deserialize<AppSettings>(json, JsonOptions);
                if (settings is not null)
                {
                    _logger.LogDebug("Settings loaded from {Path}", _settingsPath);
                    return settings;
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to load settings from {Path}", _settingsPath);
        }

        return new AppSettings();
    }
}
