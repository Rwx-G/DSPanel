using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using DSPanel.ViewModels;

namespace DSPanel;

public partial class MainWindow : Window
{
    private readonly MainViewModel _viewModel;
    private Point _dragStartPoint;
    private int _dragCurrentIndex = -1;
    private bool _isDragging;

    private const double DragThreshold = 8;

    public MainWindow(MainViewModel viewModel)
    {
        InitializeComponent();
        _viewModel = viewModel;
        DataContext = _viewModel;
    }

    protected override void OnMouseDown(MouseButtonEventArgs e)
    {
        base.OnMouseDown(e);

        // Click on non-focusable area clears focus from TextBoxes
        if (Keyboard.FocusedElement is TextBox)
        {
            Keyboard.ClearFocus();
            FocusManager.SetFocusedElement(this, null);
        }
    }

    protected override void OnKeyDown(KeyEventArgs e)
    {
        base.OnKeyDown(e);

        if (e.Key == Key.W && Keyboard.Modifiers == ModifierKeys.Control)
        {
            if (_viewModel.ActiveTabKey is not null)
            {
                _viewModel.CloseTabCommand.Execute(_viewModel.ActiveTabKey);
                e.Handled = true;
            }
        }
    }

    // ---- Tab real-time reordering (no DragDrop API) ----

    private void TabHost_PreviewMouseLeftButtonDown(object sender, MouseButtonEventArgs e)
    {
        var index = GetTabIndexAtPosition(e.OriginalSource as DependencyObject);
        if (index < 0)
            return;

        _dragStartPoint = e.GetPosition(TabHost);
        _dragCurrentIndex = index;
        _isDragging = false;
    }

    private void TabHost_PreviewMouseMove(object sender, MouseEventArgs e)
    {
        if (e.LeftButton != MouseButtonState.Pressed || _dragCurrentIndex < 0)
            return;

        var currentPos = e.GetPosition(TabHost);

        if (!_isDragging)
        {
            var diff = currentPos - _dragStartPoint;
            if (Math.Abs(diff.X) < DragThreshold && Math.Abs(diff.Y) < DragThreshold)
                return;

            _isDragging = true;
            TabHost.CaptureMouse();
            Cursor = Cursors.SizeWE;
        }

        // Find which tab the mouse is currently over and swap if needed
        var targetIndex = GetTabIndexAtScreenPosition(currentPos);
        if (targetIndex >= 0 && targetIndex != _dragCurrentIndex)
        {
            _viewModel.MoveTab(_dragCurrentIndex, targetIndex);
            _dragCurrentIndex = targetIndex;
        }
    }

    private void TabHost_PreviewMouseLeftButtonUp(object sender, MouseButtonEventArgs e)
    {
        if (_isDragging)
        {
            TabHost.ReleaseMouseCapture();
            Cursor = Cursors.Arrow;
        }

        _dragCurrentIndex = -1;
        _isDragging = false;
    }

    private int GetTabIndexAtPosition(DependencyObject? element)
    {
        var tabItem = FindAncestor<TabItem>(element);
        if (tabItem is null)
            return -1;

        return TabHost.ItemContainerGenerator.IndexFromContainer(tabItem);
    }

    private int GetTabIndexAtScreenPosition(Point posRelativeToTabHost)
    {
        for (var i = 0; i < TabHost.Items.Count; i++)
        {
            if (TabHost.ItemContainerGenerator.ContainerFromIndex(i) is not TabItem container)
                continue;

            var topLeft = container.TranslatePoint(new Point(0, 0), TabHost);
            var bounds = new Rect(topLeft, container.RenderSize);

            // Use center threshold: swap when mouse passes the midpoint
            var centerX = bounds.Left + bounds.Width / 2;
            if (posRelativeToTabHost.X >= bounds.Left && posRelativeToTabHost.X < bounds.Right)
            {
                // Mouse is within this tab's bounds
                if (_dragCurrentIndex < i && posRelativeToTabHost.X > centerX)
                    return i;
                if (_dragCurrentIndex > i && posRelativeToTabHost.X < centerX)
                    return i;
                // Mouse is on the correct side of center, no swap yet
                return _dragCurrentIndex;
            }
        }

        // Mouse is beyond the last tab or before the first - clamp to edges
        if (TabHost.Items.Count > 0 && posRelativeToTabHost.X > 0)
        {
            if (TabHost.ItemContainerGenerator.ContainerFromIndex(0) is TabItem first)
            {
                var firstLeft = first.TranslatePoint(new Point(0, 0), TabHost).X;
                if (posRelativeToTabHost.X < firstLeft)
                    return 0;
            }

            var lastIndex = TabHost.Items.Count - 1;
            if (TabHost.ItemContainerGenerator.ContainerFromIndex(lastIndex) is TabItem last)
            {
                var lastRight = last.TranslatePoint(new Point(0, 0), TabHost).X + last.RenderSize.Width;
                if (posRelativeToTabHost.X > lastRight)
                    return lastIndex;
            }
        }

        return -1;
    }

    private static T? FindAncestor<T>(DependencyObject? current) where T : DependencyObject
    {
        while (current is not null)
        {
            if (current is T match)
                return match;
            current = VisualTreeHelper.GetParent(current);
        }
        return null;
    }
}
