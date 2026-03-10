using System.Windows;
using System.Windows.Input;
using System.Windows.Media;
using DSPanel.Models;

namespace DSPanel.Views.Dialogs;

public partial class ProgressDialog : Window
{
    private CancellationTokenSource? _cts;
    private bool _completed;

    /// <summary>
    /// True if the operation completed successfully (not cancelled).
    /// </summary>
    public bool WasSuccessful { get; private set; }

    public ProgressDialog(string title)
    {
        InitializeComponent();
        TitleText.Text = title;
    }

    /// <summary>
    /// Runs the async work function while displaying progress.
    /// Shows a completion state and waits for user to close.
    /// </summary>
    public async Task RunAsync(
        Func<IProgress<ProgressInfo>, CancellationToken, Task> work)
    {
        _cts = new CancellationTokenSource();
        var progress = new Progress<ProgressInfo>(OnProgressReport);
        var userClosed = new TaskCompletionSource();

        Closed += (_, _) => userClosed.TrySetResult();

        Show();

        try
        {
            await work(progress, _cts.Token);
            WasSuccessful = true;
            ShowCompletion(success: true);
        }
        catch (OperationCanceledException)
        {
            WasSuccessful = false;
            ShowCompletion(success: false);
        }
        finally
        {
            _cts.Dispose();
            _cts = null;
        }

        // Wait for user to acknowledge by clicking Close
        await userClosed.Task;
    }

    private void ShowCompletion(bool success)
    {
        _completed = true;

        if (success)
        {
            CompletionIcon.Data = (Geometry)FindResource("IconSuccess");
            CompletionIcon.Fill = (Brush)FindResource("BrushSuccess");
            CompletionIcon.Visibility = Visibility.Visible;
            TitleText.Text = "Completed";
            StatusText.Text = "Operation completed successfully.";
            ProgressBarControl.IsIndeterminate = false;
            ProgressBarControl.Value = 100;
            ProgressBarControl.Foreground = (Brush)FindResource("BrushSuccess");
            PercentageText.Visibility = Visibility.Collapsed;
        }
        else
        {
            CompletionIcon.Data = (Geometry)FindResource("IconWarning");
            CompletionIcon.Fill = (Brush)FindResource("BrushWarning");
            CompletionIcon.Visibility = Visibility.Visible;
            TitleText.Text = "Cancelled";
            StatusText.Text = "Operation was cancelled.";
            ProgressBarControl.IsIndeterminate = false;
            ProgressBarControl.Value = 0;
            PercentageText.Visibility = Visibility.Collapsed;
        }

        CancelButton.Content = "Close";
        CancelButton.IsEnabled = true;
    }

    private void OnProgressReport(ProgressInfo info)
    {
        StatusText.Text = info.StatusMessage;

        if (info.IsIndeterminate)
        {
            ProgressBarControl.IsIndeterminate = true;
            PercentageText.Visibility = Visibility.Collapsed;
        }
        else
        {
            ProgressBarControl.IsIndeterminate = false;
            ProgressBarControl.Value = info.Percentage;
            PercentageText.Text = $"{info.Percentage:F0}%";
            PercentageText.Visibility = Visibility.Visible;
        }
    }

    private void OnCancelClick(object sender, RoutedEventArgs e)
    {
        if (_completed)
        {
            Close();
            return;
        }

        CancelButton.IsEnabled = false;
        CancelButton.Content = "Cancelling...";
        _cts?.Cancel();
    }

    protected override void OnMouseLeftButtonDown(MouseButtonEventArgs e)
    {
        base.OnMouseLeftButtonDown(e);
        DragMove();
    }
}
