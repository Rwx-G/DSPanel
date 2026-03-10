using CommunityToolkit.Mvvm.ComponentModel;

namespace DSPanel.ViewModels;

public partial class MainViewModel : ObservableObject
{
    [ObservableProperty]
    private string _title = "DSPanel";
}
