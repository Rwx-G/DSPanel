namespace DSPanel.Services.Settings;

/// <summary>
/// Application-level persisted settings (theme, paths, preferences, window state).
/// Serialized as JSON in %LocalAppData%/DSPanel/settings.json.
/// </summary>
public sealed class AppSettings
{
    public string Theme { get; set; } = "Light";
    public string? PresetsPath { get; set; }

    // Window state
    public double WindowLeft { get; set; } = -1;
    public double WindowTop { get; set; } = -1;
    public double WindowWidth { get; set; } = 1280;
    public double WindowHeight { get; set; } = 720;
    public string WindowState { get; set; } = "Normal";
    public bool SidebarExpanded { get; set; } = true;
}
