using System.Collections.ObjectModel;
using System.Diagnostics.CodeAnalysis;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Threading;
using CommunityToolkit.Mvvm.ComponentModel;

namespace DSPanel.Views.Controls;

/// <summary>
/// Searchable multi-select group picker with chip display for selected groups.
/// </summary>
[ExcludeFromCodeCoverage]
public partial class GroupPicker : UserControl
{
    private readonly DispatcherTimer _debounceTimer;

    public static readonly DependencyProperty SelectedGroupsProperty =
        DependencyProperty.Register(
            nameof(SelectedGroups),
            typeof(ObservableCollection<string>),
            typeof(GroupPicker),
            new FrameworkPropertyMetadata(null, FrameworkPropertyMetadataOptions.BindsTwoWayByDefault));

    public static readonly DependencyProperty SearchCommandProperty =
        DependencyProperty.Register(
            nameof(SearchCommand),
            typeof(System.Windows.Input.ICommand),
            typeof(GroupPicker));

    public ObservableCollection<string>? SelectedGroups
    {
        get => (ObservableCollection<string>?)GetValue(SelectedGroupsProperty);
        set => SetValue(SelectedGroupsProperty, value);
    }

    public System.Windows.Input.ICommand? SearchCommand
    {
        get => (System.Windows.Input.ICommand?)GetValue(SearchCommandProperty);
        set => SetValue(SearchCommandProperty, value);
    }

    /// <summary>
    /// Bindable search results. Set this from the ViewModel after SearchCommand executes.
    /// </summary>
    public ObservableCollection<GroupPickerItem> SearchResults { get; } = [];

    public GroupPicker()
    {
        _debounceTimer = new DispatcherTimer
        {
            Interval = TimeSpan.FromMilliseconds(300)
        };
        _debounceTimer.Tick += OnDebounceTimerTick;

        InitializeComponent();
        PART_ResultsList.ItemsSource = SearchResults;
        SearchResults.CollectionChanged += (_, _) => UpdateResultsVisibility();

        SelectedGroups ??= [];
    }

    private void UpdateResultsVisibility()
    {
        PART_ResultsList.Visibility = SearchResults.Count > 0
            ? Visibility.Visible
            : Visibility.Collapsed;
    }

    private void OnSearchTextChanged(object sender, TextChangedEventArgs e)
    {
        _debounceTimer.Stop();
        _debounceTimer.Start();
    }

    private void OnDebounceTimerTick(object? sender, EventArgs e)
    {
        _debounceTimer.Stop();
        var query = PART_SearchBox.Text;

        if (string.IsNullOrWhiteSpace(query))
        {
            PART_ResultsList.Visibility = Visibility.Collapsed;
            return;
        }

        if (SearchCommand?.CanExecute(query) == true)
            SearchCommand.Execute(query);

        PART_ResultsList.Visibility = SearchResults.Count > 0
            ? Visibility.Visible
            : Visibility.Collapsed;
    }

    private void OnGroupChecked(object sender, RoutedEventArgs e)
    {
        if (sender is CheckBox { DataContext: GroupPickerItem item })
        {
            SelectedGroups ??= [];
            if (!SelectedGroups.Contains(item.DisplayName))
            {
                SelectedGroups.Add(item.DisplayName);
                RefreshChips();
            }
        }
    }

    private void OnGroupUnchecked(object sender, RoutedEventArgs e)
    {
        if (sender is CheckBox { DataContext: GroupPickerItem item })
        {
            SelectedGroups?.Remove(item.DisplayName);
            RefreshChips();
        }
    }

    private void RefreshChips()
    {
        PART_SelectedChips.Children.Clear();
        if (SelectedGroups is null) return;

        foreach (var group in SelectedGroups)
        {
            var chip = new TagChip
            {
                Text = group,
                IsRemovable = true,
                Margin = new Thickness(0, 0, 6, 6)
            };
            chip.RemoveCommand = new CommunityToolkit.Mvvm.Input.RelayCommand<object>(param =>
            {
                SelectedGroups.Remove(group);
                // Uncheck in results list
                var item = SearchResults.FirstOrDefault(r => r.DisplayName == group);
                if (item is not null)
                    item.IsSelected = false;
                RefreshChips();
            });
            PART_SelectedChips.Children.Add(chip);
        }
    }
}

/// <summary>
/// Item model for group picker search results with selection state.
/// </summary>
[ExcludeFromCodeCoverage]
public partial class GroupPickerItem : ObservableObject
{
    [ObservableProperty]
    private string _displayName = string.Empty;

    [ObservableProperty]
    private string _distinguishedName = string.Empty;

    [ObservableProperty]
    private bool _isSelected;
}
