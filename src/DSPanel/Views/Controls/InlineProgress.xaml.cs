using System.Windows;
using System.Windows.Controls;

namespace DSPanel.Views.Controls;

public partial class InlineProgress : UserControl
{
    public static readonly DependencyProperty IsActiveProperty =
        DependencyProperty.Register(nameof(IsActive), typeof(bool), typeof(InlineProgress),
            new PropertyMetadata(false, OnIsActiveChanged));

    public static readonly DependencyProperty ProgressProperty =
        DependencyProperty.Register(nameof(Progress), typeof(double), typeof(InlineProgress),
            new PropertyMetadata(0.0, OnProgressChanged));

    public static readonly DependencyProperty StatusMessageProperty =
        DependencyProperty.Register(nameof(StatusMessage), typeof(string), typeof(InlineProgress),
            new PropertyMetadata(string.Empty, OnStatusMessageChanged));

    public static readonly DependencyProperty IsIndeterminateProperty =
        DependencyProperty.Register(nameof(IsIndeterminate), typeof(bool), typeof(InlineProgress),
            new PropertyMetadata(true, OnIsIndeterminateChanged));

    public bool IsActive
    {
        get => (bool)GetValue(IsActiveProperty);
        set => SetValue(IsActiveProperty, value);
    }

    public double Progress
    {
        get => (double)GetValue(ProgressProperty);
        set => SetValue(ProgressProperty, value);
    }

    public string StatusMessage
    {
        get => (string)GetValue(StatusMessageProperty);
        set => SetValue(StatusMessageProperty, value);
    }

    public bool IsIndeterminate
    {
        get => (bool)GetValue(IsIndeterminateProperty);
        set => SetValue(IsIndeterminateProperty, value);
    }

    public InlineProgress()
    {
        InitializeComponent();
        Visibility = Visibility.Collapsed;
    }

    private static void OnIsActiveChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        var control = (InlineProgress)d;
        control.Visibility = (bool)e.NewValue ? Visibility.Visible : Visibility.Collapsed;
    }

    private static void OnProgressChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        var control = (InlineProgress)d;
        control.PART_ProgressBar.Value = (double)e.NewValue;
    }

    private static void OnStatusMessageChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        var control = (InlineProgress)d;
        control.PART_StatusText.Text = (string)e.NewValue;
    }

    private static void OnIsIndeterminateChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        var control = (InlineProgress)d;
        control.PART_ProgressBar.IsIndeterminate = (bool)e.NewValue;
    }
}
