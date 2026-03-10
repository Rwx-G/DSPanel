using System.Windows;
using System.Windows.Controls;
using DSPanel.Services.Permissions;
using Microsoft.Extensions.DependencyInjection;

namespace DSPanel.Views.Controls;

/// <summary>
/// ContentControl wrapper that shows or collapses its content
/// based on the current user's permission level.
/// </summary>
public partial class PermissionGate : ContentControl
{
    public static readonly DependencyProperty RequiredLevelProperty =
        DependencyProperty.Register(
            nameof(RequiredLevel),
            typeof(PermissionLevel),
            typeof(PermissionGate),
            new PropertyMetadata(PermissionLevel.ReadOnly, OnRequiredLevelChanged));

    public PermissionLevel RequiredLevel
    {
        get => (PermissionLevel)GetValue(RequiredLevelProperty);
        set => SetValue(RequiredLevelProperty, value);
    }

    /// <summary>
    /// Optional externally injected permission service for testing.
    /// When null, the control resolves from DI at load time.
    /// </summary>
    internal IPermissionService? PermissionServiceOverride { get; set; }

    public PermissionGate()
    {
        InitializeComponent();
        Loaded += OnLoaded;
    }

    private static void OnRequiredLevelChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        if (d is PermissionGate gate)
        {
            gate.EvaluateVisibility();
        }
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        EvaluateVisibility();
    }

    private void EvaluateVisibility()
    {
        var service = PermissionServiceOverride ?? ResolvePermissionService();

        if (service is null)
        {
            // If no service is available, hide protected content by default
            Visibility = Visibility.Collapsed;
            return;
        }

        Visibility = service.HasPermission(RequiredLevel)
            ? Visibility.Visible
            : Visibility.Collapsed;
    }

    private static IPermissionService? ResolvePermissionService()
    {
        return App.ServiceProvider?.GetService<IPermissionService>();
    }
}
