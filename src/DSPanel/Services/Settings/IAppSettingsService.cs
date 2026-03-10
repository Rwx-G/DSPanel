namespace DSPanel.Services.Settings;

/// <summary>
/// Reads and writes application settings to a local JSON file.
/// </summary>
public interface IAppSettingsService
{
    AppSettings Current { get; }
    void Save();
}
