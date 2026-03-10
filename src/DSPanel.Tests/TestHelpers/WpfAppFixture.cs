using System.Windows;
using System.Windows.Media;

namespace DSPanel.Tests.TestHelpers;

/// <summary>
/// Shared fixture that ensures a WPF Application instance exists for tests
/// that need to resolve resources via Application.Current.
/// </summary>
public class WpfAppFixture
{
    private static readonly object Lock = new();
    private static bool _initialized;

    public WpfAppFixture()
    {
        lock (Lock)
        {
            if (_initialized) return;

            if (Application.Current is null)
            {
                var app = new Application { ShutdownMode = ShutdownMode.OnExplicitShutdown };
                RegisterTestResources(app);
            }
            else
            {
                RegisterTestResources(Application.Current);
            }

            _initialized = true;
        }
    }

    private static void RegisterTestResources(Application app)
    {
        // Brush resources used by NotificationSeverityToBrushConverter
        app.Resources["BrushSuccess"] = new SolidColorBrush(Color.FromRgb(22, 163, 74));
        app.Resources["BrushWarning"] = new SolidColorBrush(Color.FromRgb(217, 119, 6));
        app.Resources["BrushError"] = new SolidColorBrush(Color.FromRgb(220, 38, 38));
        app.Resources["BrushInfo"] = new SolidColorBrush(Color.FromRgb(37, 99, 235));

        // Icon geometry resources used by NotificationSeverityToIconConverter and GeometryResourceConverter
        app.Resources["IconSuccess"] = Geometry.Parse("M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z");
        app.Resources["IconWarning"] = Geometry.Parse("M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z");
        app.Resources["IconError"] = Geometry.Parse("M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z");
        app.Resources["IconInfo"] = Geometry.Parse("M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z");
        app.Resources["IconUser"] = Geometry.Parse("M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4z");
    }
}

[CollectionDefinition("WpfApp")]
public class WpfAppCollection : ICollectionFixture<WpfAppFixture>;
