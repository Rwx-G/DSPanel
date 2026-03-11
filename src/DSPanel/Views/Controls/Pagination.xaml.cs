using System.Diagnostics.CodeAnalysis;
using System.Windows;
using System.Windows.Controls;
using DSPanel.Helpers;

namespace DSPanel.Views.Controls;

[ExcludeFromCodeCoverage]
public partial class Pagination : UserControl
{
    public static readonly DependencyProperty CurrentPageProperty =
        DependencyProperty.Register(nameof(CurrentPage), typeof(int), typeof(Pagination),
            new PropertyMetadata(1, OnPagingChanged));

    public static readonly DependencyProperty PageSizeProperty =
        DependencyProperty.Register(nameof(PageSize), typeof(int), typeof(Pagination),
            new PropertyMetadata(25, OnPagingChanged));

    public static readonly DependencyProperty TotalItemsProperty =
        DependencyProperty.Register(nameof(TotalItems), typeof(int), typeof(Pagination),
            new PropertyMetadata(0, OnPagingChanged));

    public static readonly RoutedEvent PageChangedEvent =
        EventManager.RegisterRoutedEvent(nameof(PageChanged), RoutingStrategy.Bubble,
            typeof(RoutedEventHandler), typeof(Pagination));

    public int CurrentPage
    {
        get => (int)GetValue(CurrentPageProperty);
        set => SetValue(CurrentPageProperty, value);
    }

    public int PageSize
    {
        get => (int)GetValue(PageSizeProperty);
        set => SetValue(PageSizeProperty, value);
    }

    public int TotalItems
    {
        get => (int)GetValue(TotalItemsProperty);
        set => SetValue(TotalItemsProperty, value);
    }

    public int TotalPages => PaginationHelper.CalculateTotalPages(TotalItems, PageSize);

    public event RoutedEventHandler PageChanged
    {
        add => AddHandler(PageChangedEvent, value);
        remove => RemoveHandler(PageChangedEvent, value);
    }

    public Pagination()
    {
        InitializeComponent();
        UpdateDisplay();
    }

    private static void OnPagingChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        ((Pagination)d).UpdateDisplay();
    }

    private void UpdateDisplay()
    {
        var total = TotalPages;
        var page = PaginationHelper.ClampPage(CurrentPage, total);

        PART_InfoLabel.Text = PaginationHelper.FormatDisplayRange(CurrentPage, PageSize, TotalItems);
        PART_PageLabel.Text = $"{page} / {total}";

        PART_First.IsEnabled = page > 1;
        PART_Prev.IsEnabled = page > 1;
        PART_Next.IsEnabled = page < total;
        PART_Last.IsEnabled = page < total;
    }

    private void OnFirst(object sender, RoutedEventArgs e) => GoToPage(1);
    private void OnPrev(object sender, RoutedEventArgs e) => GoToPage(CurrentPage - 1);
    private void OnNext(object sender, RoutedEventArgs e) => GoToPage(CurrentPage + 1);
    private void OnLast(object sender, RoutedEventArgs e) => GoToPage(TotalPages);

    private void GoToPage(int page)
    {
        CurrentPage = Math.Clamp(page, 1, TotalPages);
        RaiseEvent(new RoutedEventArgs(PageChangedEvent));
    }

    private void OnPageSizeChanged(object sender, SelectionChangedEventArgs e)
    {
        if (PART_PageSize.SelectedItem is ComboBoxItem item &&
            int.TryParse(item.Content?.ToString(), out var size))
        {
            PageSize = size;
            CurrentPage = 1;
            RaiseEvent(new RoutedEventArgs(PageChangedEvent));
        }
    }
}
