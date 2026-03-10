using System.Collections.ObjectModel;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Threading;

namespace DSPanel.Views.Controls;

public partial class FilterBar : UserControl
{
    private readonly DispatcherTimer _debounce;
    private readonly ObservableCollection<FilterChip> _chips = [];

    public static readonly DependencyProperty FilterTextProperty =
        DependencyProperty.Register(nameof(FilterText), typeof(string), typeof(FilterBar),
            new PropertyMetadata(string.Empty));

    public static readonly RoutedEvent FilterChangedEvent =
        EventManager.RegisterRoutedEvent(nameof(FilterChanged), RoutingStrategy.Bubble,
            typeof(RoutedEventHandler), typeof(FilterBar));

    public string FilterText
    {
        get => (string)GetValue(FilterTextProperty);
        set => SetValue(FilterTextProperty, value);
    }

    public event RoutedEventHandler FilterChanged
    {
        add => AddHandler(FilterChangedEvent, value);
        remove => RemoveHandler(FilterChangedEvent, value);
    }

    public ObservableCollection<FilterChip> Chips => _chips;

    public FilterBar()
    {
        InitializeComponent();
        PART_Chips.ItemsSource = _chips;
        _debounce = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(300) };
        _debounce.Tick += (_, _) =>
        {
            _debounce.Stop();
            FilterText = PART_FilterInput.Text;
            RaiseEvent(new RoutedEventArgs(FilterChangedEvent));
        };
    }

    public void AddChip(string key, string label)
    {
        if (_chips.Any(c => c.Key == key)) return;
        _chips.Add(new FilterChip(key, label));
        UpdateClearAllVisibility();
        RaiseEvent(new RoutedEventArgs(FilterChangedEvent));
    }

    public void RemoveChip(string key)
    {
        var chip = _chips.FirstOrDefault(c => c.Key == key);
        if (chip is not null)
        {
            _chips.Remove(chip);
            UpdateClearAllVisibility();
            RaiseEvent(new RoutedEventArgs(FilterChangedEvent));
        }
    }

    public void ClearAll()
    {
        _chips.Clear();
        PART_FilterInput.Text = string.Empty;
        FilterText = string.Empty;
        UpdateClearAllVisibility();
        RaiseEvent(new RoutedEventArgs(FilterChangedEvent));
    }

    private void OnFilterTextChanged(object sender, TextChangedEventArgs e)
    {
        _debounce.Stop();
        _debounce.Start();
    }

    private void OnRemoveChip(object sender, RoutedEventArgs e)
    {
        if (sender is Button { Tag: FilterChip chip })
            RemoveChip(chip.Key);
    }

    private void OnClearAll(object sender, RoutedEventArgs e) => ClearAll();

    private void UpdateClearAllVisibility()
    {
        PART_ClearAll.Visibility = _chips.Count > 0 ? Visibility.Visible : Visibility.Collapsed;
    }
}

public sealed record FilterChip(string Key, string Label);
