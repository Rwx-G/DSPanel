using DSPanel.Models;
using DSPanel.Services.Health;
using FluentAssertions;

namespace DSPanel.Tests.Services.Health;

public class HealthCheckServiceTests
{
    private readonly HealthCheckService _service = new();

    /// <summary>
    /// Sentinel value used to distinguish "not specified" from explicit null.
    /// </summary>
    private static readonly DateTime Sentinel = new(9999, 1, 1, 0, 0, 0, DateTimeKind.Utc);

    private static DirectoryUser CreateUser(
        bool enabled = true,
        bool lockedOut = false,
        DateTime? accountExpires = null,
        DateTime? passwordLastSet = null,
        bool passwordExpired = false,
        bool passwordNeverExpires = false,
        DateTime? lastLogon = null,
        DateTime? whenCreated = null,
        bool setLastLogon = true)
    {
        return new DirectoryUser
        {
            SamAccountName = "jdoe",
            Enabled = enabled,
            LockedOut = lockedOut,
            AccountExpires = accountExpires ?? DateTime.UtcNow.AddYears(1),
            PasswordLastSet = passwordLastSet ?? DateTime.UtcNow.AddDays(-10),
            PasswordExpired = passwordExpired,
            PasswordNeverExpires = passwordNeverExpires,
            LastLogon = setLastLogon ? (lastLogon ?? DateTime.UtcNow.AddHours(-1)) : null,
            WhenCreated = whenCreated ?? DateTime.UtcNow.AddYears(-1),
            WhenChanged = DateTime.UtcNow.AddDays(-1)
        };
    }

    [Fact]
    public void Evaluate_HealthyUser_ReturnsHealthy()
    {
        var user = CreateUser();

        var result = _service.Evaluate(user);

        result.OverallLevel.Should().Be(HealthLevel.Healthy);
        result.ActiveFlags.Should().BeEmpty();
    }

    [Fact]
    public void Evaluate_DisabledAccount_ReturnsCritical()
    {
        var user = CreateUser(enabled: false);

        var result = _service.Evaluate(user);

        result.OverallLevel.Should().Be(HealthLevel.Critical);
        result.ActiveFlags.Should().Contain(f => f.Name == "Disabled");
    }

    [Fact]
    public void Evaluate_LockedOutAccount_ReturnsCritical()
    {
        var user = CreateUser(lockedOut: true);

        var result = _service.Evaluate(user);

        result.OverallLevel.Should().Be(HealthLevel.Critical);
        result.ActiveFlags.Should().Contain(f => f.Name == "LockedOut");
    }

    [Fact]
    public void Evaluate_ExpiredAccount_ReturnsCritical()
    {
        var user = CreateUser(accountExpires: DateTime.UtcNow.AddDays(-1));

        var result = _service.Evaluate(user);

        result.OverallLevel.Should().Be(HealthLevel.Critical);
        result.ActiveFlags.Should().Contain(f => f.Name == "AccountExpired");
    }

    [Fact]
    public void Evaluate_ExpiredPassword_ReturnsCritical()
    {
        var user = CreateUser(passwordExpired: true);

        var result = _service.Evaluate(user);

        result.OverallLevel.Should().Be(HealthLevel.Critical);
        result.ActiveFlags.Should().Contain(f => f.Name == "PasswordExpired");
    }

    [Fact]
    public void Evaluate_PasswordNeverExpires_ReturnsWarning()
    {
        var user = CreateUser(passwordNeverExpires: true);

        var result = _service.Evaluate(user);

        result.ActiveFlags.Should().Contain(f => f.Name == "PasswordNeverExpires");
        result.ActiveFlags.First(f => f.Name == "PasswordNeverExpires").Severity
            .Should().Be(HealthLevel.Warning);
    }

    [Fact]
    public void Evaluate_Inactive30Days_ReturnsWarning()
    {
        var user = CreateUser(lastLogon: DateTime.UtcNow.AddDays(-45));

        var result = _service.Evaluate(user);

        result.ActiveFlags.Should().Contain(f => f.Name == "Inactive30Days");
        result.ActiveFlags.First(f => f.Name == "Inactive30Days").Severity
            .Should().Be(HealthLevel.Warning);
    }

    [Fact]
    public void Evaluate_Inactive90Days_ReturnsCritical()
    {
        var user = CreateUser(lastLogon: DateTime.UtcNow.AddDays(-100));

        var result = _service.Evaluate(user);

        result.ActiveFlags.Should().Contain(f => f.Name == "Inactive90Days");
        result.ActiveFlags.Should().NotContain(f => f.Name == "Inactive30Days");
    }

    [Fact]
    public void Evaluate_NeverLoggedOn_ReturnsInfo()
    {
        var user = CreateUser(setLastLogon: false);

        var result = _service.Evaluate(user);

        result.ActiveFlags.Should().Contain(f => f.Name == "NeverLoggedOn");
        result.ActiveFlags.First(f => f.Name == "NeverLoggedOn").Severity
            .Should().Be(HealthLevel.Info);
    }

    [Fact]
    public void Evaluate_PasswordNeverChanged_ReturnsWarning()
    {
        var created = DateTime.UtcNow.AddDays(-30);
        var user = CreateUser(
            whenCreated: created,
            passwordLastSet: created.AddSeconds(10));

        var result = _service.Evaluate(user);

        result.ActiveFlags.Should().Contain(f => f.Name == "PasswordNeverChanged");
    }

    [Fact]
    public void Evaluate_OverallLevel_IsWorstSeverity()
    {
        var user = CreateUser(lockedOut: true, passwordNeverExpires: true);

        var result = _service.Evaluate(user);

        result.OverallLevel.Should().Be(HealthLevel.Critical);
        result.ActiveFlags.Should().HaveCountGreaterThanOrEqualTo(2);
    }

    [Fact]
    public void Evaluate_MultipleFlags_AllPresent()
    {
        var user = CreateUser(enabled: false, lockedOut: true, passwordExpired: true);

        var result = _service.Evaluate(user);

        result.ActiveFlags.Should().Contain(f => f.Name == "Disabled");
        result.ActiveFlags.Should().Contain(f => f.Name == "LockedOut");
        result.ActiveFlags.Should().Contain(f => f.Name == "PasswordExpired");
    }
}
