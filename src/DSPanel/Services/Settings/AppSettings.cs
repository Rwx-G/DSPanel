namespace DSPanel.Services.Settings;

/// <summary>
/// Application-level persisted settings (theme, paths, preferences).
/// Serialized as JSON in %LocalAppData%/DSPanel/settings.json.
/// </summary>
public sealed class AppSettings
{
    public string Theme { get; set; } = "Light";
    public string? PresetsPath { get; set; }
}
