using DSPanel.Models;
using FluentAssertions;

namespace DSPanel.Tests.Models;

public class AccountHealthStatusTests
{
    [Theory]
    [InlineData(HealthLevel.Healthy, "Healthy")]
    [InlineData(HealthLevel.Info, "Info")]
    [InlineData(HealthLevel.Warning, "Warning")]
    [InlineData(HealthLevel.Critical, "Critical")]
    public void StatusText_ReturnsExpectedString(HealthLevel level, string expected)
    {
        var status = new AccountHealthStatus { OverallLevel = level };
        status.StatusText.Should().Be(expected);
    }

    [Fact]
    public void Default_OverallLevel_IsHealthy()
    {
        var status = new AccountHealthStatus();
        status.OverallLevel.Should().Be(HealthLevel.Healthy);
    }

    [Fact]
    public void Default_ActiveFlags_IsEmpty()
    {
        var status = new AccountHealthStatus();
        status.ActiveFlags.Should().BeEmpty();
    }

    [Fact]
    public void StatusText_UnknownLevel_ReturnsUnknown()
    {
        var status = new AccountHealthStatus { OverallLevel = (HealthLevel)99 };
        status.StatusText.Should().Be("Unknown");
    }

    [Fact]
    public void HealthFlag_Record_StoresValues()
    {
        var flag = new HealthFlag("PasswordExpired", HealthLevel.Warning, "Password has expired");
        flag.Name.Should().Be("PasswordExpired");
        flag.Severity.Should().Be(HealthLevel.Warning);
        flag.Description.Should().Be("Password has expired");
    }

    [Fact]
    public void HealthFlag_Equality()
    {
        var a = new HealthFlag("Test", HealthLevel.Info, "Desc");
        var b = new HealthFlag("Test", HealthLevel.Info, "Desc");
        a.Should().Be(b);
    }
}
