using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;

namespace DSPanel.Views.Controls;

/// <summary>
/// Small rounded chip displaying a text label with an optional remove button.
/// </summary>
public partial class TagChip : UserControl
{
    public static readonly DependencyProperty TextProperty =
        DependencyProperty.Register(
            nameof(Text),
            typeof(string),
            typeof(TagChip),
            new PropertyMetadata(string.Empty, OnTextChanged));

    public static readonly DependencyProperty IsRemovableProperty =
        DependencyProperty.Register(
            nameof(IsRemovable),
            typeof(bool),
            typeof(TagChip),
            new PropertyMetadata(true, OnIsRemovableChanged));

    public static readonly DependencyProperty RemoveCommandProperty =
        DependencyProperty.Register(
            nameof(RemoveCommand),
            typeof(ICommand),
            typeof(TagChip));

    public static readonly DependencyProperty RemoveCommandParameterProperty =
        DependencyProperty.Register(
            nameof(RemoveCommandParameter),
            typeof(object),
            typeof(TagChip));

    public string Text
    {
        get => (string)GetValue(TextProperty);
        set => SetValue(TextProperty, value);
    }

    public bool IsRemovable
    {
        get => (bool)GetValue(IsRemovableProperty);
        set => SetValue(IsRemovableProperty, value);
    }

    public ICommand? RemoveCommand
    {
        get => (ICommand?)GetValue(RemoveCommandProperty);
        set => SetValue(RemoveCommandProperty, value);
    }

    public object? RemoveCommandParameter
    {
        get => GetValue(RemoveCommandParameterProperty);
        set => SetValue(RemoveCommandParameterProperty, value);
    }

    public TagChip()
    {
        InitializeComponent();
        UpdateAppearance();
    }

    private static void OnTextChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        if (d is TagChip chip)
            chip.PART_Text.Text = (string)e.NewValue;
    }

    private static void OnIsRemovableChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        if (d is TagChip chip)
            chip.UpdateRemoveButtonVisibility();
    }

    private void UpdateAppearance()
    {
        PART_Text.Text = Text;
        UpdateRemoveButtonVisibility();
    }

    private void UpdateRemoveButtonVisibility()
    {
        PART_RemoveButton.Visibility = IsRemovable ? Visibility.Visible : Visibility.Collapsed;
    }

    private void OnRemoveClick(object sender, RoutedEventArgs e)
    {
        var param = RemoveCommandParameter ?? Text;
        if (RemoveCommand?.CanExecute(param) == true)
            RemoveCommand.Execute(param);
    }
}
