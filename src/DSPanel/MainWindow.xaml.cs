using System.Windows;
using System.Windows.Input;
using DSPanel.ViewModels;

namespace DSPanel;

public partial class MainWindow : Window
{
    private readonly MainViewModel _viewModel;

    public MainWindow(MainViewModel viewModel)
    {
        InitializeComponent();
        _viewModel = viewModel;
        DataContext = _viewModel;
    }

    protected override void OnKeyDown(KeyEventArgs e)
    {
        base.OnKeyDown(e);

        // Ctrl+W closes the active tab
        if (e.Key == Key.W && Keyboard.Modifiers == ModifierKeys.Control)
        {
            if (_viewModel.ActiveTabKey is not null)
            {
                _viewModel.CloseTabCommand.Execute(_viewModel.ActiveTabKey);
                e.Handled = true;
            }
        }
    }
}
