using DSPanel.Helpers;
using FluentAssertions;

namespace DSPanel.Tests.Helpers;

public class LdapFilterHelperTests
{
    [Fact]
    public void EscapeFilter_PlainText_ReturnsUnchanged()
    {
        LdapFilterHelper.EscapeFilter("john.doe").Should().Be("john.doe");
    }

    [Fact]
    public void EscapeFilter_Asterisk_IsEscaped()
    {
        LdapFilterHelper.EscapeFilter("test*").Should().Be("test\\2a");
    }

    [Fact]
    public void EscapeFilter_Parentheses_AreEscaped()
    {
        LdapFilterHelper.EscapeFilter("test(1)").Should().Be("test\\281\\29");
    }

    [Fact]
    public void EscapeFilter_Backslash_IsEscaped()
    {
        LdapFilterHelper.EscapeFilter("test\\value").Should().Be("test\\5cvalue");
    }

    [Fact]
    public void EscapeFilter_NullChar_IsEscaped()
    {
        LdapFilterHelper.EscapeFilter("test\0").Should().Be("test\\00");
    }

    [Fact]
    public void EscapeFilter_MultipleSpecialChars_AllEscaped()
    {
        LdapFilterHelper.EscapeFilter("a*b(c)d\\e").Should().Be("a\\2ab\\28c\\29d\\5ce");
    }
}
