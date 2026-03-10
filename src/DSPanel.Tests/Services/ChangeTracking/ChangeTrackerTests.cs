using DSPanel.Services.ChangeTracking;
using FluentAssertions;

namespace DSPanel.Tests.Services.ChangeTracking;

public class ChangeTrackerTests
{
    private string _name = "Alice";
    private int _age = 30;

    private ChangeTracker CreateTracker()
    {
        return new ChangeTracker(() => new Dictionary<string, object?>
        {
            ["Name"] = _name,
            ["Age"] = _age
        });
    }

    [Fact]
    public void IsDirty_BeforeMarkClean_ReturnsFalse()
    {
        var tracker = CreateTracker();
        tracker.IsDirty.Should().BeFalse();
    }

    [Fact]
    public void IsDirty_AfterMarkClean_NoChanges_ReturnsFalse()
    {
        var tracker = CreateTracker();
        tracker.MarkClean();

        tracker.IsDirty.Should().BeFalse();
    }

    [Fact]
    public void IsDirty_AfterPropertyChange_ReturnsTrue()
    {
        var tracker = CreateTracker();
        tracker.MarkClean();

        _name = "Bob";

        tracker.IsDirty.Should().BeTrue();
    }

    [Fact]
    public void IsDirty_AfterRevertingChange_ReturnsFalse()
    {
        var tracker = CreateTracker();
        tracker.MarkClean();

        _name = "Bob";
        _name = "Alice"; // revert

        tracker.IsDirty.Should().BeFalse();
    }

    [Fact]
    public void MarkClean_ResetsBaseline()
    {
        var tracker = CreateTracker();
        tracker.MarkClean();

        _name = "Bob";
        tracker.MarkClean(); // new baseline

        tracker.IsDirty.Should().BeFalse();
    }

    [Fact]
    public void Snapshot_ContainsCleanValues()
    {
        var tracker = CreateTracker();
        tracker.MarkClean();

        tracker.Snapshot["Name"].Should().Be("Alice");
        tracker.Snapshot["Age"].Should().Be(30);
    }
}
