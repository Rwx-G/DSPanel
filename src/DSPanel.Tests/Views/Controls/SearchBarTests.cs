using DSPanel.Services.Debounce;
using FluentAssertions;
using Moq;

namespace DSPanel.Tests.Views.Controls;

/// <summary>
/// Tests the debounce logic via SearchDebounceHandler, which encapsulates
/// the timer-based search behavior used by SearchBar.
/// </summary>
public class SearchBarTests
{
    private readonly Mock<IDebounceTimer> _mockTimer = new();
    private Action? _capturedCallback;
    private TimeSpan _capturedDelay;

    private SearchDebounceHandler CreateHandler(
        Action<string> onSearch,
        TimeSpan? delay = null)
    {
        _mockTimer
            .Setup(t => t.Restart(It.IsAny<TimeSpan>(), It.IsAny<Action>()))
            .Callback<TimeSpan, Action>((d, cb) =>
            {
                _capturedDelay = d;
                _capturedCallback = cb;
            });

        return new SearchDebounceHandler(
            _mockTimer.Object,
            delay ?? TimeSpan.FromMilliseconds(300),
            onSearch);
    }

    [Fact]
    public void OnTextChanged_Restarts_DebounceTimer()
    {
        var handler = CreateHandler(_ => { });

        handler.OnTextChanged("test");

        _mockTimer.Verify(t => t.Restart(
            It.IsAny<TimeSpan>(),
            It.IsAny<Action>()), Times.Once);
    }

    [Fact]
    public void OnTextChanged_Uses_ConfiguredDelay()
    {
        var handler = CreateHandler(_ => { }, TimeSpan.FromMilliseconds(500));

        handler.OnTextChanged("test");

        _capturedDelay.Should().Be(TimeSpan.FromMilliseconds(500));
    }

    [Fact]
    public void OnTextChanged_WhenTimerFires_InvokesSearchWithLatestText()
    {
        string? searchedText = null;
        var handler = CreateHandler(text => searchedText = text);

        handler.OnTextChanged("first");
        handler.OnTextChanged("second");

        // Simulate the timer firing
        _capturedCallback?.Invoke();

        searchedText.Should().Be("second");
    }

    [Fact]
    public void OnTextChanged_MultipleRapidChanges_RestartsTimerEachTime()
    {
        var handler = CreateHandler(_ => { });

        handler.OnTextChanged("a");
        handler.OnTextChanged("ab");
        handler.OnTextChanged("abc");

        _mockTimer.Verify(t => t.Restart(
            It.IsAny<TimeSpan>(),
            It.IsAny<Action>()), Times.Exactly(3));
    }

    [Fact]
    public void Cancel_Stops_DebounceTimer()
    {
        var handler = CreateHandler(_ => { });

        handler.OnTextChanged("test");
        handler.Cancel();

        _mockTimer.Verify(t => t.Stop(), Times.Once);
    }

    [Fact]
    public void OnTextChanged_WithEmptyText_StillRestartsTimer()
    {
        string? searchedText = null;
        var handler = CreateHandler(text => searchedText = text);

        handler.OnTextChanged("");
        _capturedCallback?.Invoke();

        searchedText.Should().Be("");
    }
}
