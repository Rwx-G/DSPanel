using System.Diagnostics.CodeAnalysis;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace DSPanel.Views.Controls;

/// <summary>
/// Card with a header, optional icon, and collapsible content area.
/// </summary>
[ExcludeFromCodeCoverage]
public partial class InfoCard : UserControl
{
    public static readonly DependencyProperty HeaderProperty =
        DependencyProperty.Register(
            nameof(Header),
            typeof(string),
            typeof(InfoCard),
            new PropertyMetadata(string.Empty, OnHeaderChanged));

    public static readonly DependencyProperty IconKeyProperty =
        DependencyProperty.Register(
            nameof(IconKey),
            typeof(string),
            typeof(InfoCard),
            new PropertyMetadata(null, OnIconKeyChanged));

    public static readonly DependencyProperty IsExpandedProperty =
        DependencyProperty.Register(
            nameof(IsExpanded),
            typeof(bool),
            typeof(InfoCard),
            new PropertyMetadata(true, OnIsExpandedChanged));

    public static readonly DependencyProperty IsCollapsibleProperty =
        DependencyProperty.Register(
            nameof(IsCollapsible),
            typeof(bool),
            typeof(InfoCard),
            new PropertyMetadata(true, OnIsCollapsibleChanged));

    public static readonly DependencyProperty CardContentProperty =
        DependencyProperty.Register(
            nameof(CardContent),
            typeof(object),
            typeof(InfoCard),
            new PropertyMetadata(null, OnCardContentChanged));

    public string Header
    {
        get => (string)GetValue(HeaderProperty);
        set => SetValue(HeaderProperty, value);
    }

    public string? IconKey
    {
        get => (string?)GetValue(IconKeyProperty);
        set => SetValue(IconKeyProperty, value);
    }

    public bool IsExpanded
    {
        get => (bool)GetValue(IsExpandedProperty);
        set => SetValue(IsExpandedProperty, value);
    }

    public bool IsCollapsible
    {
        get => (bool)GetValue(IsCollapsibleProperty);
        set => SetValue(IsCollapsibleProperty, value);
    }

    public object? CardContent
    {
        get => GetValue(CardContentProperty);
        set => SetValue(CardContentProperty, value);
    }

    public InfoCard()
    {
        InitializeComponent();
        UpdateExpandedState();
        UpdateCollapsibleState();
    }

    private static void OnHeaderChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        if (d is InfoCard card)
            card.PART_HeaderText.Text = (string)e.NewValue;
    }

    private static void OnIconKeyChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        if (d is InfoCard card)
            card.UpdateIcon();
    }

    private static void OnIsExpandedChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        if (d is InfoCard card)
            card.UpdateExpandedState();
    }

    private static void OnIsCollapsibleChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        if (d is InfoCard card)
            card.UpdateCollapsibleState();
    }

    private static void OnCardContentChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        if (d is InfoCard card)
            card.PART_Content.Content = e.NewValue;
    }

    private void OnHeaderClick(object sender, RoutedEventArgs e)
    {
        if (IsCollapsible)
            IsExpanded = !IsExpanded;
    }

    private void UpdateIcon()
    {
        if (string.IsNullOrEmpty(IconKey))
        {
            PART_Icon.Visibility = Visibility.Collapsed;
            return;
        }

        if (TryFindResource(IconKey) is Geometry geometry)
        {
            PART_Icon.Data = geometry;
            PART_Icon.Visibility = Visibility.Visible;
        }
        else
        {
            PART_Icon.Visibility = Visibility.Collapsed;
        }
    }

    private void UpdateExpandedState()
    {
        PART_ContentBorder.Visibility = IsExpanded ? Visibility.Visible : Visibility.Collapsed;
        PART_ChevronRotation.Angle = IsExpanded ? 0 : -90;
    }

    private void UpdateCollapsibleState()
    {
        PART_Chevron.Visibility = IsCollapsible ? Visibility.Visible : Visibility.Collapsed;
        PART_HeaderButton.Cursor = IsCollapsible
            ? System.Windows.Input.Cursors.Hand
            : System.Windows.Input.Cursors.Arrow;
    }
}
