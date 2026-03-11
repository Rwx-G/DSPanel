using System.ComponentModel.DataAnnotations;
using DSPanel.Validation;
using FluentAssertions;

namespace DSPanel.Tests.Validation;

public class ValidDistinguishedNameAttributeTests
{
    private readonly ValidDistinguishedNameAttribute _attribute = new();

    private ValidationResult? Validate(object? value)
    {
        var context = new ValidationContext(new object()) { MemberName = "Test" };
        return _attribute.GetValidationResult(value, context);
    }

    [Theory]
    [InlineData("CN=User,DC=example,DC=com")]
    [InlineData("OU=Users,DC=corp,DC=local")]
    [InlineData("CN=John Doe,OU=Users,OU=Corp,DC=example,DC=com")]
    public void Valid_DNs_Pass(string value)
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

    [Theory]
    [InlineData("just-a-string")]
    [InlineData("CN=OnlyOneComponent")]
    [InlineData("=NoKey,DC=test")]
    [InlineData("XX=Bad,DC=test")]
    public void Invalid_DNs_Fail(string value)
    {
        Validate(value).Should().NotBe(ValidationResult.Success);
    }

    [Fact]
    public void IsValidDn_ValidInput_ReturnsTrue()
    {
        ValidDistinguishedNameAttribute.IsValidDn("CN=Test,DC=local").Should().BeTrue();
    }

    [Fact]
    public void IsValidDn_Whitespace_ReturnsFalse()
    {
        ValidDistinguishedNameAttribute.IsValidDn("  ").Should().BeFalse();
    }

    [Fact]
    public void NonStringValue_ReturnsError()
    {
        Validate(42).Should().NotBe(ValidationResult.Success);
    }

    [Fact]
    public void IsValidDn_EmptyComponentValue_ReturnsFalse()
    {
        // "CN=" has eq at the end, should fail
        ValidDistinguishedNameAttribute.IsValidDn("CN=,DC=test").Should().BeFalse();
    }

    [Theory]
    [InlineData("O=Org,DC=test")]
    [InlineData("L=City,ST=State,C=US,DC=test")]
    [InlineData("UID=user,DC=test")]
    public void IsValidDn_AllSupportedKeys_ReturnsTrue(string dn)
    {
        ValidDistinguishedNameAttribute.IsValidDn(dn).Should().BeTrue();
    }
}
