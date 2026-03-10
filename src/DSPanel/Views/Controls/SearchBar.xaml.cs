using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Threading;

namespace DSPanel.Views.Controls;

/// <summary>
/// Search bar with debounced search command execution.
/// </summary>
public partial class SearchBar : UserControl
{
    private readonly DispatcherTimer _debounceTimer;

    public static readonly DependencyProperty TextProperty =
        DependencyProperty.Register(
            nameof(Text),
            typeof(string),
            typeof(SearchBar),
            new FrameworkPropertyMetadata(
                string.Empty,
                FrameworkPropertyMetadataOptions.BindsTwoWayByDefault,
                OnTextChanged));

    public static readonly DependencyProperty SearchCommandProperty =
        DependencyProperty.Register(
            nameof(SearchCommand),
            typeof(ICommand),
            typeof(SearchBar));

    public static readonly DependencyProperty PlaceholderTextProperty =
        DependencyProperty.Register(
            nameof(PlaceholderText),
            typeof(string),
            typeof(SearchBar),
            new PropertyMetadata("Search..."));

    public static readonly DependencyProperty DebounceDelayProperty =
        DependencyProperty.Register(
            nameof(DebounceDelay),
            typeof(int),
            typeof(SearchBar),
            new PropertyMetadata(300, OnDebounceDelayChanged));

    public string Text
    {
        get => (string)GetValue(TextProperty);
        set => SetValue(TextProperty, value);
    }

    public ICommand? SearchCommand
    {
        get => (ICommand?)GetValue(SearchCommandProperty);
        set => SetValue(SearchCommandProperty, value);
    }

    public string PlaceholderText
    {
        get => (string)GetValue(PlaceholderTextProperty);
        set => SetValue(PlaceholderTextProperty, value);
    }

    public int DebounceDelay
    {
        get => (int)GetValue(DebounceDelayProperty);
        set => SetValue(DebounceDelayProperty, value);
    }

    public SearchBar()
    {
        _debounceTimer = new DispatcherTimer();
        _debounceTimer.Tick += OnDebounceTimerTick;
        _debounceTimer.Interval = TimeSpan.FromMilliseconds(300);

        InitializeComponent();
    }

    private static void OnTextChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        if (d is SearchBar searchBar)
        {
            searchBar.RestartDebounce();
        }
    }

    private static void OnDebounceDelayChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        if (d is SearchBar searchBar)
        {
            searchBar._debounceTimer.Interval = TimeSpan.FromMilliseconds((int)e.NewValue);
        }
    }

    private void RestartDebounce()
    {
        _debounceTimer.Stop();
        _debounceTimer.Start();
    }

    private void OnDebounceTimerTick(object? sender, EventArgs e)
    {
        _debounceTimer.Stop();
        ExecuteSearch();
    }

    private void ExecuteSearch()
    {
        if (SearchCommand?.CanExecute(Text) == true)
        {
            SearchCommand.Execute(Text);
        }
    }

    private void OnClearClick(object sender, RoutedEventArgs e)
    {
        Text = string.Empty;
    }

    private void OnSearchBoxGotFocus(object sender, RoutedEventArgs e)
    {
        PART_Border.BorderBrush = (System.Windows.Media.Brush)FindResource("BrushBorderFocus");
    }

    private void OnSearchBoxLostFocus(object sender, RoutedEventArgs e)
    {
        PART_Border.BorderBrush = (System.Windows.Media.Brush)FindResource("BrushBorderDefault");
    }

    private void OnSearchBoxKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Escape)
        {
            // Move focus away from the search box
            Keyboard.ClearFocus();
            FocusManager.SetFocusedElement(FocusManager.GetFocusScope(this), null);
            e.Handled = true;
        }
    }
}
