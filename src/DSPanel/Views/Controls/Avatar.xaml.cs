using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace DSPanel.Views.Controls;

/// <summary>
/// Circular avatar that displays an image or falls back to initials
/// with a deterministic background color derived from the display name.
/// </summary>
public partial class Avatar : UserControl
{
    private static readonly Color[] Palette =
    [
        Color.FromRgb(0x3B, 0x82, 0xF6), // Blue
        Color.FromRgb(0x10, 0xB9, 0x81), // Emerald
        Color.FromRgb(0xF5, 0x9E, 0x0B), // Amber
        Color.FromRgb(0xEF, 0x44, 0x44), // Red
        Color.FromRgb(0x8B, 0x5C, 0xF6), // Violet
        Color.FromRgb(0xEC, 0x48, 0x99), // Pink
        Color.FromRgb(0x14, 0xB8, 0xA6), // Teal
        Color.FromRgb(0xF9, 0x73, 0x16), // Orange
    ];

    public static readonly DependencyProperty ImageSourceProperty =
        DependencyProperty.Register(
            nameof(ImageSource),
            typeof(ImageSource),
            typeof(Avatar),
            new PropertyMetadata(null, OnAppearanceChanged));

    public static readonly DependencyProperty DisplayNameProperty =
        DependencyProperty.Register(
            nameof(DisplayName),
            typeof(string),
            typeof(Avatar),
            new PropertyMetadata(string.Empty, OnAppearanceChanged));

    public static readonly DependencyProperty SizeProperty =
        DependencyProperty.Register(
            nameof(Size),
            typeof(double),
            typeof(Avatar),
            new PropertyMetadata(32.0, OnSizeChanged));

    public ImageSource? ImageSource
    {
        get => (ImageSource?)GetValue(ImageSourceProperty);
        set => SetValue(ImageSourceProperty, value);
    }

    public string DisplayName
    {
        get => (string)GetValue(DisplayNameProperty);
        set => SetValue(DisplayNameProperty, value);
    }

    public double Size
    {
        get => (double)GetValue(SizeProperty);
        set => SetValue(SizeProperty, value);
    }

    public Avatar()
    {
        InitializeComponent();
        UpdateAppearance();
    }

    private static void OnAppearanceChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        if (d is Avatar avatar)
            avatar.UpdateAppearance();
    }

    private static void OnSizeChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        if (d is Avatar avatar)
        {
            avatar.ApplySize();
            avatar.UpdateAppearance();
        }
    }

    private void ApplySize()
    {
        var size = Size;
        var radius = size / 2;

        PART_Root.Width = size;
        PART_Root.Height = size;
        PART_InitialsBorder.Width = size;
        PART_InitialsBorder.Height = size;
        PART_InitialsBorder.CornerRadius = new CornerRadius(radius);
        PART_ImageBorder.Width = size;
        PART_ImageBorder.Height = size;
        PART_ImageBorder.CornerRadius = new CornerRadius(radius);
        PART_Initials.FontSize = size * 0.4;
    }

    private void UpdateAppearance()
    {
        if (ImageSource is not null)
        {
            PART_ImageBrush.ImageSource = ImageSource;
            PART_ImageBorder.Visibility = Visibility.Visible;
            PART_InitialsBorder.Visibility = Visibility.Collapsed;
        }
        else
        {
            PART_ImageBorder.Visibility = Visibility.Collapsed;
            PART_InitialsBorder.Visibility = Visibility.Visible;
            PART_Initials.Text = GetInitials(DisplayName);
            PART_InitialsBorder.Background = new SolidColorBrush(GetDeterministicColor(DisplayName));
        }
    }

    /// <summary>
    /// Extracts initials from a display name (first letter of first and last name).
    /// </summary>
    internal static string GetInitials(string? displayName)
    {
        if (string.IsNullOrWhiteSpace(displayName))
            return "?";

        var parts = displayName.Trim().Split(' ', StringSplitOptions.RemoveEmptyEntries);
        return parts.Length switch
        {
            0 => "?",
            1 => parts[0][..1].ToUpperInvariant(),
            _ => $"{parts[0][..1]}{parts[^1][..1]}".ToUpperInvariant()
        };
    }

    /// <summary>
    /// Returns a deterministic color from the palette based on the display name hash.
    /// </summary>
    internal static Color GetDeterministicColor(string? displayName)
    {
        if (string.IsNullOrWhiteSpace(displayName))
            return Palette[0];

        var hash = 0;
        foreach (var c in displayName)
            hash = (hash * 31 + c) & 0x7FFFFFFF;

        return Palette[hash % Palette.Length];
    }
}
