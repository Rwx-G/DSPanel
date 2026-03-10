using System.ComponentModel.DataAnnotations;
using DSPanel.Validation;
using FluentAssertions;

namespace DSPanel.Tests.Validation;

public class ValidSamAccountNameAttributeTests
{
    private readonly ValidSamAccountNameAttribute _attribute = new();

    private ValidationResult? Validate(object? value)
    {
        var context = new ValidationContext(new object()) { MemberName = "Test" };
        return _attribute.GetValidationResult(value, context);
    }

    [Theory]
    [InlineData("jdoe")]
    [InlineData("john.doe")]
    [InlineData("admin_user")]
    [InlineData("test-account")]
    [InlineData("A")]
    [InlineData("12345678901234567890")] // exactly 20
    public void Valid_SamAccountNames_Pass(string value)
    {
        Validate(value).Should().Be(ValidationResult.Success);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    public void NullOrEmpty_Passes(string? value)
    {
        Validate(value).Should().Be(ValidationResult.Success);
    }

    [Fact]
    public void TooLong_Fails()
    {
        Validate("123456789012345678901").Should().NotBe(ValidationResult.Success);
    }

    [Theory]
    [InlineData("user name")]     // space
    [InlineData("user@domain")]   // @
    [InlineData("user=name")]     // =
    [InlineData("user,name")]     // comma
    public void InvalidCharacters_Fail(string value)
    {
        Validate(value).Should().NotBe(ValidationResult.Success);
    }
}
