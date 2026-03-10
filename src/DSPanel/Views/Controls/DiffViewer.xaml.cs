using System.Collections.Generic;
using System.Windows;
using System.Windows.Controls;
using DSPanel.Models;

namespace DSPanel.Views.Controls;

public partial class DiffViewer : UserControl
{
    private bool _isSideBySide;
    private bool _syncing;

    public static readonly DependencyProperty LinesProperty =
        DependencyProperty.Register(nameof(Lines), typeof(IReadOnlyList<DiffLine>), typeof(DiffViewer),
            new PropertyMetadata(null, OnLinesChanged));

    public IReadOnlyList<DiffLine>? Lines
    {
        get => (IReadOnlyList<DiffLine>?)GetValue(LinesProperty);
        set => SetValue(LinesProperty, value);
    }

    public DiffViewer()
    {
        InitializeComponent();
    }

    private static void OnLinesChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        var viewer = (DiffViewer)d;
        var lines = e.NewValue as IReadOnlyList<DiffLine>;
        viewer.UpdateDisplay(lines);
    }

    private void UpdateDisplay(IReadOnlyList<DiffLine>? lines)
    {
        lines ??= [];
        PART_InlineItems.ItemsSource = lines;

        // Side-by-side: left shows old (Removed + Unchanged), right shows new (Added + Unchanged)
        var left = new List<DiffLine>();
        var right = new List<DiffLine>();

        foreach (var line in lines)
        {
            if (line.Type is DiffLineType.Removed or DiffLineType.Unchanged)
                left.Add(line);
            if (line.Type is DiffLineType.Added or DiffLineType.Unchanged)
                right.Add(line);
        }

        PART_LeftItems.ItemsSource = left;
        PART_RightItems.ItemsSource = right;
    }

    private void OnToggleMode(object sender, RoutedEventArgs e)
    {
        _isSideBySide = !_isSideBySide;

        PART_InlineView.Visibility = _isSideBySide ? Visibility.Collapsed : Visibility.Visible;
        PART_SideBySideView.Visibility = _isSideBySide ? Visibility.Visible : Visibility.Collapsed;
        PART_ToggleMode.Content = _isSideBySide ? "Inline" : "Side by side";
    }

    private void OnLeftScrollChanged(object sender, ScrollChangedEventArgs e)
    {
        if (_syncing) return;
        _syncing = true;
        PART_RightScroll.ScrollToVerticalOffset(PART_LeftScroll.VerticalOffset);
        PART_RightScroll.ScrollToHorizontalOffset(PART_LeftScroll.HorizontalOffset);
        _syncing = false;
    }

    private void OnRightScrollChanged(object sender, ScrollChangedEventArgs e)
    {
        if (_syncing) return;
        _syncing = true;
        PART_LeftScroll.ScrollToVerticalOffset(PART_RightScroll.VerticalOffset);
        PART_LeftScroll.ScrollToHorizontalOffset(PART_RightScroll.HorizontalOffset);
        _syncing = false;
    }
}
