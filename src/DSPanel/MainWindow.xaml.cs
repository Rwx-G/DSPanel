using System.Diagnostics.CodeAnalysis;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using DSPanel.Services.Settings;
using DSPanel.ViewModels;
using Microsoft.Extensions.DependencyInjection;

namespace DSPanel;

[ExcludeFromCodeCoverage]
public partial class MainWindow : Window
{
    private readonly MainViewModel _viewModel;
    private Point _dragStartPoint;
    private int _dragCurrentIndex = -1;
    private bool _isDragging;
    private bool _sidebarAutoCollapsed;
    private bool _userSidebarState;

    private const double DragThreshold = 8;

    public MainWindow(MainViewModel viewModel)
    {
        InitializeComponent();
        _viewModel = viewModel;
        DataContext = _viewModel;
        RestoreWindowState();
        _userSidebarState = _viewModel.IsSidebarExpanded;
        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        SizeChanged += OnWindowSizeChanged;
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

        // Ctrl+W - close current tab
        if (e.Key == Key.W && Keyboard.Modifiers == ModifierKeys.Control)
        {
            if (_viewModel.ActiveTabKey is not null)
            {
                _viewModel.CloseTabCommand.Execute(_viewModel.ActiveTabKey);
                e.Handled = true;
            }
        }
        // Ctrl+Tab - next tab
        else if (e.Key == Key.Tab && Keyboard.Modifiers == ModifierKeys.Control)
        {
            _viewModel.NextTabCommand.Execute(null);
            e.Handled = true;
        }
        // Ctrl+Shift+Tab - previous tab
        else if (e.Key == Key.Tab && Keyboard.Modifiers == (ModifierKeys.Control | ModifierKeys.Shift))
        {
            _viewModel.PreviousTabCommand.Execute(null);
            e.Handled = true;
        }
        // Ctrl+B - toggle sidebar
        else if (e.Key == Key.B && Keyboard.Modifiers == ModifierKeys.Control)
        {
            _viewModel.ToggleSidebarCommand.Execute(null);
            e.Handled = true;
        }
        // Ctrl+1 through Ctrl+9 - switch to tab by index
        else if (Keyboard.Modifiers == ModifierKeys.Control && e.Key >= Key.D1 && e.Key <= Key.D9)
        {
            _viewModel.ActivateTabByIndexCommand.Execute(e.Key - Key.D1);
            e.Handled = true;
        }
    }

    // ---- Window state persistence ----

    private void RestoreWindowState()
    {
        var settings = App.ServiceProvider?.GetService<IAppSettingsService>()?.Current;
        if (settings is null) return;

        if (settings.WindowLeft >= 0 && settings.WindowTop >= 0)
        {
            // Validate position is within screen bounds
            var left = settings.WindowLeft;
            var top = settings.WindowTop;
            var screenWidth = SystemParameters.VirtualScreenWidth;
            var screenHeight = SystemParameters.VirtualScreenHeight;

            if (left >= 0 && left < screenWidth - 100 && top >= 0 && top < screenHeight - 100)
            {
                WindowStartupLocation = WindowStartupLocation.Manual;
                Left = left;
                Top = top;
            }
        }

        Width = Math.Max(800, settings.WindowWidth);
        Height = Math.Max(600, settings.WindowHeight);

        if (Enum.TryParse<WindowState>(settings.WindowState, out var state))
            WindowState = state;

        _viewModel.IsSidebarExpanded = settings.SidebarExpanded;
    }

    protected override void OnClosing(System.ComponentModel.CancelEventArgs e)
    {
        base.OnClosing(e);
        SaveWindowState();
    }

    private void SaveWindowState()
    {
        var settingsService = App.ServiceProvider?.GetService<IAppSettingsService>();
        if (settingsService is null) return;

        var settings = settingsService.Current;

        // Save normal bounds (not maximized bounds)
        settings.WindowLeft = WindowState == WindowState.Normal ? Left : RestoreBounds.Left;
        settings.WindowTop = WindowState == WindowState.Normal ? Top : RestoreBounds.Top;
        settings.WindowWidth = WindowState == WindowState.Normal ? Width : RestoreBounds.Width;
        settings.WindowHeight = WindowState == WindowState.Normal ? Height : RestoreBounds.Height;
        settings.WindowState = WindowState.ToString();
        settings.SidebarExpanded = _viewModel.IsSidebarExpanded;

        settingsService.Save();
    }

    // ---- Responsive sidebar ----

    private const double SidebarAutoCollapseThreshold = 900;

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(MainViewModel.IsSidebarExpanded) && !_sidebarAutoCollapsed)
            _userSidebarState = _viewModel.IsSidebarExpanded;
    }

    private void OnWindowSizeChanged(object sender, SizeChangedEventArgs e)
    {
        var isNarrow = e.NewSize.Width < SidebarAutoCollapseThreshold;

        if (isNarrow && _viewModel.IsSidebarExpanded)
        {
            _sidebarAutoCollapsed = true;
            _viewModel.IsSidebarExpanded = false;
            _sidebarAutoCollapsed = false;
        }
        else if (!isNarrow && !_viewModel.IsSidebarExpanded && _userSidebarState)
        {
            _sidebarAutoCollapsed = true;
            _viewModel.IsSidebarExpanded = true;
            _sidebarAutoCollapsed = false;
        }
    }

    // ---- Tab real-time reordering (no DragDrop API) ----

    private void TabHost_PreviewMouseDown(object sender, MouseButtonEventArgs e)
    {
        if (e.ChangedButton != MouseButton.Middle)
            return;

        var index = GetTabIndexAtPosition(e.OriginalSource as DependencyObject);
        if (index >= 0 && index < _viewModel.Tabs.Count)
        {
            _viewModel.CloseTabCommand.Execute(_viewModel.Tabs[index].Key);
            e.Handled = true;
        }
    }

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
