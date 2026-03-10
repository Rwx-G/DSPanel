using System.Windows;
using DSPanel.ViewModels;

namespace DSPanel;

public partial class MainWindow : Window
{
    public MainWindow(MainViewModel viewModel)
    {
        InitializeComponent();
        DataContext = viewModel;
    }
}
