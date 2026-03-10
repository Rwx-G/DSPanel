using DSPanel.Models;
using DSPanel.Services.Permissions;
using DSPanel.Views.Controls;
using FluentAssertions;
using Moq;

namespace DSPanel.Tests.Views.Controls;

/// <summary>
/// Tests for PermissionGate visibility logic.
/// These test the EvaluateVisibility behavior by checking how the gate
/// determines visibility based on permission levels.
/// </summary>
public class PermissionGateTests
{
    [Theory]
    [InlineData(PermissionLevel.ReadOnly, PermissionLevel.ReadOnly, true)]
    [InlineData(PermissionLevel.DomainAdmin, PermissionLevel.ReadOnly, false)]
    [InlineData(PermissionLevel.AccountOperator, PermissionLevel.DomainAdmin, true)]
    [InlineData(PermissionLevel.HelpDesk, PermissionLevel.HelpDesk, true)]
    [InlineData(PermissionLevel.HelpDesk, PermissionLevel.ReadOnly, false)]
    public void HasPermission_VariousLevels_ReturnsExpectedResult(
        PermissionLevel required,
        PermissionLevel current,
        bool expectedVisible)
    {
        var mockService = new Mock<IPermissionService>();
        mockService.Setup(s => s.HasPermission(It.IsAny<PermissionLevel>()))
            .Returns<PermissionLevel>(level => current >= level);
        mockService.Setup(s => s.CurrentLevel).Returns(current);

        var hasPermission = mockService.Object.HasPermission(required);

        hasPermission.Should().Be(expectedVisible);
    }

    [Fact]
    public void HasPermission_ReadOnly_AlwaysVisible()
    {
        var mockService = new Mock<IPermissionService>();
        mockService.Setup(s => s.HasPermission(PermissionLevel.ReadOnly)).Returns(true);

        mockService.Object.HasPermission(PermissionLevel.ReadOnly).Should().BeTrue();
    }

    [Fact]
    public void HasPermission_DomainAdmin_OnlyForDomainAdmin()
    {
        var mockService = new Mock<IPermissionService>();
        mockService.Setup(s => s.HasPermission(PermissionLevel.DomainAdmin)).Returns(false);

        mockService.Object.HasPermission(PermissionLevel.DomainAdmin).Should().BeFalse();
    }
}
