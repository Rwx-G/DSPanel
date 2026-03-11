namespace DSPanel.Services.Theme;

public interface IThemeService
{
    ThemeMode CurrentTheme { get; }
    void ApplyTheme(ThemeMode mode);
    void ToggleTheme();
}
