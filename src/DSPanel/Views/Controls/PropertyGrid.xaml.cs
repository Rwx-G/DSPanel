using System.Collections;
using System.Diagnostics.CodeAnalysis;
using System.Windows;
using System.Windows.Controls;

namespace DSPanel.Views.Controls;

/// <summary>
/// Two-column label-value grid for displaying object properties.
/// Supports click-to-copy on values marked as copyable.
/// </summary>
[ExcludeFromCodeCoverage]
public partial class PropertyGrid : UserControl
{
    public static readonly DependencyProperty ItemsProperty =
        DependencyProperty.Register(
            nameof(Items),
            typeof(IEnumerable),
            typeof(PropertyGrid),
            new PropertyMetadata(null));

    public IEnumerable? Items
    {
        get => (IEnumerable?)GetValue(ItemsProperty);
        set => SetValue(ItemsProperty, value);
    }

    public PropertyGrid()
    {
        InitializeComponent();
    }
}
