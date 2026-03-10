using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Shapes;

namespace DSPanel.Views.Controls;

public partial class PasswordInput : UserControl
{
    private bool _isPasswordVisible;
    private bool _suppressSync;

    public static readonly DependencyProperty PasswordProperty =
        DependencyProperty.Register(
            nameof(Password),
            typeof(string),
            typeof(PasswordInput),
            new FrameworkPropertyMetadata(
                string.Empty,
                FrameworkPropertyMetadataOptions.BindsTwoWayByDefault,
                OnPasswordPropertyChanged));

    public static readonly DependencyProperty PlaceholderTextProperty =
        DependencyProperty.Register(
            nameof(PlaceholderText),
            typeof(string),
            typeof(PasswordInput),
            new PropertyMetadata("Password"));

    public string Password
    {
        get => (string)GetValue(PasswordProperty);
        set => SetValue(PasswordProperty, value);
    }

    public string PlaceholderText
    {
        get => (string)GetValue(PlaceholderTextProperty);
        set => SetValue(PlaceholderTextProperty, value);
    }

    public PasswordInput()
    {
        InitializeComponent();
    }

    private static void OnPasswordPropertyChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        var control = (PasswordInput)d;
        if (control._suppressSync) return;

        control._suppressSync = true;
        control.PART_PasswordBox.Password = (string)e.NewValue;
        control._suppressSync = false;
    }

    private void OnPasswordChanged(object sender, RoutedEventArgs e)
    {
        if (_suppressSync) return;

        _suppressSync = true;
        Password = PART_PasswordBox.Password;
        _suppressSync = false;
    }

    private void OnToggleVisibility(object sender, RoutedEventArgs e)
    {
        _isPasswordVisible = !_isPasswordVisible;

        var icon = (Path?)PART_ToggleButton.Template.FindName("icon", PART_ToggleButton);

        if (_isPasswordVisible)
        {
            PART_TextBox.Text = Password;
            PART_PasswordBox.Visibility = Visibility.Collapsed;
            PART_TextBox.Visibility = Visibility.Visible;
            if (icon is not null) icon.Data = (Geometry)FindResource("IconEyeOff");
            PART_TextBox.Focus();
            PART_TextBox.CaretIndex = PART_TextBox.Text.Length;
        }
        else
        {
            PART_PasswordBox.Password = Password;
            PART_TextBox.Visibility = Visibility.Collapsed;
            PART_PasswordBox.Visibility = Visibility.Visible;
            if (icon is not null) icon.Data = (Geometry)FindResource("IconEye");
            PART_PasswordBox.Focus();
        }
    }
}
