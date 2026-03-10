using System.Diagnostics.CodeAnalysis;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Threading;

namespace DSPanel.Views.Controls;

/// <summary>
/// Button that copies text to the clipboard and shows a brief checkmark confirmation.
/// </summary>
[ExcludeFromCodeCoverage]
public partial class CopyButton : UserControl
{
    private readonly DispatcherTimer _feedbackTimer;

    public static readonly DependencyProperty TextToCopyProperty =
        DependencyProperty.Register(
            nameof(TextToCopy),
            typeof(string),
            typeof(CopyButton));

    public string? TextToCopy
    {
        get => (string?)GetValue(TextToCopyProperty);
        set => SetValue(TextToCopyProperty, value);
    }

    public CopyButton()
    {
        _feedbackTimer = new DispatcherTimer
        {
            Interval = TimeSpan.FromMilliseconds(1500)
        };
        _feedbackTimer.Tick += OnFeedbackTimerTick;

        InitializeComponent();
    }

    private void OnCopyClick(object sender, RoutedEventArgs e)
    {
        if (string.IsNullOrEmpty(TextToCopy))
            return;

        try
        {
            Clipboard.SetText(TextToCopy);
        }
        catch
        {
            // Clipboard access can fail in restricted environments
            return;
        }

        // Show checkmark feedback
        PART_CopyIcon.Visibility = Visibility.Collapsed;
        PART_CheckIcon.Visibility = Visibility.Visible;

        _feedbackTimer.Stop();
        _feedbackTimer.Start();
    }

    private void OnFeedbackTimerTick(object? sender, EventArgs e)
    {
        _feedbackTimer.Stop();
        PART_CopyIcon.Visibility = Visibility.Visible;
        PART_CheckIcon.Visibility = Visibility.Collapsed;
    }
}
