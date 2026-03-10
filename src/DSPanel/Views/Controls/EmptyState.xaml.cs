using System.Diagnostics.CodeAnalysis;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;

namespace DSPanel.Views.Controls;

/// <summary>
/// Placeholder display for empty data states with an optional icon and action button.
/// </summary>
[ExcludeFromCodeCoverage]
public partial class EmptyState : UserControl
{
    public static readonly DependencyProperty MessageProperty =
        DependencyProperty.Register(
            nameof(Message),
            typeof(string),
            typeof(EmptyState),
            new PropertyMetadata("No items to display"));

    public static readonly DependencyProperty IconKeyProperty =
        DependencyProperty.Register(
            nameof(IconKey),
            typeof(string),
            typeof(EmptyState),
            new PropertyMetadata(null, OnIconKeyChanged));

    public static readonly DependencyProperty ActionTextProperty =
        DependencyProperty.Register(
            nameof(ActionText),
            typeof(string),
            typeof(EmptyState),
            new PropertyMetadata(null));

    public static readonly DependencyProperty ActionCommandProperty =
        DependencyProperty.Register(
            nameof(ActionCommand),
            typeof(ICommand),
            typeof(EmptyState));

    public string Message
    {
        get => (string)GetValue(MessageProperty);
        set => SetValue(MessageProperty, value);
    }

    public string? IconKey
    {
        get => (string?)GetValue(IconKeyProperty);
        set => SetValue(IconKeyProperty, value);
    }

    public string? ActionText
    {
        get => (string?)GetValue(ActionTextProperty);
        set => SetValue(ActionTextProperty, value);
    }

    public ICommand? ActionCommand
    {
        get => (ICommand?)GetValue(ActionCommandProperty);
        set => SetValue(ActionCommandProperty, value);
    }

    public EmptyState()
    {
        InitializeComponent();
    }

    private static void OnIconKeyChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        if (d is EmptyState emptyState)
        {
            emptyState.UpdateIcon();
        }
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
}
