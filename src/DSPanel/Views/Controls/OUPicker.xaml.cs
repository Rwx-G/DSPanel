using System.Collections.ObjectModel;
using System.Diagnostics.CodeAnalysis;
using System.Windows;
using System.Windows.Controls;
using DSPanel.Models;

namespace DSPanel.Views.Controls;

/// <summary>
/// TreeView-based picker for selecting an Active Directory Organizational Unit.
/// Bind <see cref="OUItems"/> to populate and read <see cref="SelectedOU"/> for the selection.
/// </summary>
[ExcludeFromCodeCoverage]
public partial class OUPicker : UserControl
{
    public static readonly DependencyProperty OUItemsProperty =
        DependencyProperty.Register(
            nameof(OUItems),
            typeof(ObservableCollection<OrganizationalUnit>),
            typeof(OUPicker),
            new PropertyMetadata(null, OnOUItemsChanged));

    public static readonly DependencyProperty SelectedOUProperty =
        DependencyProperty.Register(
            nameof(SelectedOU),
            typeof(OrganizationalUnit),
            typeof(OUPicker),
            new FrameworkPropertyMetadata(null, FrameworkPropertyMetadataOptions.BindsTwoWayByDefault));

    public ObservableCollection<OrganizationalUnit>? OUItems
    {
        get => (ObservableCollection<OrganizationalUnit>?)GetValue(OUItemsProperty);
        set => SetValue(OUItemsProperty, value);
    }

    public OrganizationalUnit? SelectedOU
    {
        get => (OrganizationalUnit?)GetValue(SelectedOUProperty);
        set => SetValue(SelectedOUProperty, value);
    }

    public OUPicker()
    {
        InitializeComponent();
    }

    private static void OnOUItemsChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        if (d is OUPicker picker)
        {
            picker.PART_Tree.ItemsSource = e.NewValue as ObservableCollection<OrganizationalUnit>;
            picker.UpdateEmptyState();
        }
    }

    private void OnSelectedItemChanged(object sender, RoutedPropertyChangedEventArgs<object> e)
    {
        if (e.NewValue is OrganizationalUnit ou)
            SelectedOU = ou;
    }

    private void UpdateEmptyState()
    {
        var hasItems = OUItems is { Count: > 0 };
        PART_Empty.Visibility = hasItems ? Visibility.Collapsed : Visibility.Visible;
        PART_Tree.Visibility = hasItems ? Visibility.Visible : Visibility.Collapsed;
    }
}
