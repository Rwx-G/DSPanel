using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Diagnostics.CodeAnalysis;
using System.Windows;
using System.Windows.Controls;

namespace DSPanel.Views.Controls;

/// <summary>
/// Aggregates and displays all validation errors from a bound ViewModel
/// implementing <see cref="INotifyDataErrorInfo"/>.
/// </summary>
[ExcludeFromCodeCoverage]
public partial class ValidationSummary : UserControl
{
    private INotifyDataErrorInfo? _currentSource;

    public static readonly DependencyProperty ErrorSourceProperty =
        DependencyProperty.Register(
            nameof(ErrorSource),
            typeof(INotifyDataErrorInfo),
            typeof(ValidationSummary),
            new PropertyMetadata(null, OnErrorSourceChanged));

    public INotifyDataErrorInfo? ErrorSource
    {
        get => (INotifyDataErrorInfo?)GetValue(ErrorSourceProperty);
        set => SetValue(ErrorSourceProperty, value);
    }

    public ObservableCollection<string> Errors { get; } = [];

    public ValidationSummary()
    {
        InitializeComponent();
        PART_ErrorList.ItemsSource = Errors;
    }

    private static void OnErrorSourceChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        if (d is ValidationSummary summary)
        {
            summary.Detach();
            summary.Attach(e.NewValue as INotifyDataErrorInfo);
        }
    }

    private void Attach(INotifyDataErrorInfo? source)
    {
        _currentSource = source;
        if (_currentSource is not null)
        {
            _currentSource.ErrorsChanged += OnErrorsChanged;
            RefreshErrors();
        }
    }

    private void Detach()
    {
        if (_currentSource is not null)
        {
            _currentSource.ErrorsChanged -= OnErrorsChanged;
            _currentSource = null;
        }
        Errors.Clear();
        PART_Border.Visibility = Visibility.Collapsed;
    }

    private void OnErrorsChanged(object? sender, DataErrorsChangedEventArgs e)
    {
        Dispatcher.Invoke(RefreshErrors);
    }

    internal void RefreshErrors()
    {
        Errors.Clear();

        if (_currentSource is null)
        {
            PART_Border.Visibility = Visibility.Collapsed;
            return;
        }

        if (_currentSource.HasErrors)
        {
            CollectAllErrors();
        }

        PART_Border.Visibility = Errors.Count > 0 ? Visibility.Visible : Visibility.Collapsed;
    }

    private void CollectAllErrors()
    {
        if (_currentSource is null) return;

        // Try to get errors for all properties by getting errors with empty string
        // (entity-level) and then from HasErrors
        var entityErrors = _currentSource.GetErrors(null);
        if (entityErrors is not null)
        {
            foreach (var error in entityErrors)
            {
                var msg = error?.ToString();
                if (!string.IsNullOrEmpty(msg) && !Errors.Contains(msg))
                    Errors.Add(msg);
            }
        }

        var emptyErrors = _currentSource.GetErrors(string.Empty);
        if (emptyErrors is not null)
        {
            foreach (var error in emptyErrors)
            {
                var msg = error?.ToString();
                if (!string.IsNullOrEmpty(msg) && !Errors.Contains(msg))
                    Errors.Add(msg);
            }
        }
    }
}
