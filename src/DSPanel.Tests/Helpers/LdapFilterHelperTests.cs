using DSPanel.Helpers;
using FluentAssertions;

namespace DSPanel.Tests.Helpers;

public class LdapFilterHelperTests
{
    // === EscapeFilter - Basic RFC 4515 ===

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
    public void EscapeFilter_ForwardSlash_IsEscaped()
    {
        LdapFilterHelper.EscapeFilter("OU=test/dept").Should().Be("OU=test\\2fdept");
    }

    [Fact]
    public void EscapeFilter_MultipleSpecialChars_AllEscaped()
    {
        LdapFilterHelper.EscapeFilter("a*b(c)d\\e").Should().Be("a\\2ab\\28c\\29d\\5ce");
    }

    [Fact]
    public void EscapeFilter_EmptyString_ReturnsEmpty()
    {
        LdapFilterHelper.EscapeFilter("").Should().BeEmpty();
    }

    [Fact]
    public void EscapeFilter_NullInput_ReturnsEmpty()
    {
        LdapFilterHelper.EscapeFilter(null!).Should().BeEmpty();
    }

    // === EscapeFilter - LDAP Injection Patterns ===

    [Fact]
    public void EscapeFilter_InjectionCloseAndReopenFilter_IsNeutralized()
    {
        // Attacker tries to close the filter and add objectClass=*
        var input = ")(objectClass=*)";
        var escaped = LdapFilterHelper.EscapeFilter(input);

        escaped.Should().Be("\\29\\28objectClass=\\2a\\29");
        escaped.Should().NotContain(")(");
    }

    [Fact]
    public void EscapeFilter_InjectionOrClause_IsNeutralized()
    {
        // Attacker tries to inject an OR clause to dump all users
        var input = "*)(|(objectClass=*";
        var escaped = LdapFilterHelper.EscapeFilter(input);

        escaped.Should().NotContain("(|");
        escaped.Should().NotContain("*)");
    }

    [Fact]
    public void EscapeFilter_InjectionNotClause_IsNeutralized()
    {
        // Attacker tries to inject NOT to bypass filters
        var input = "*)(!(objectClass=*";
        var escaped = LdapFilterHelper.EscapeFilter(input);

        escaped.Should().NotContain("(!");
    }

    [Fact]
    public void EscapeFilter_InjectionWildcardDump_IsNeutralized()
    {
        // Attacker tries plain wildcard to dump all entries
        var input = "*";
        var escaped = LdapFilterHelper.EscapeFilter(input);

        escaped.Should().Be("\\2a");
    }

    [Fact]
    public void EscapeFilter_InjectionNullByteTermination_IsNeutralized()
    {
        // Attacker tries null byte to truncate the filter
        var input = "admin\0)(objectClass=*)";
        var escaped = LdapFilterHelper.EscapeFilter(input);

        escaped.Should().Contain("\\00");
        escaped.Should().NotContain("\0");
    }

    [Fact]
    public void EscapeFilter_InjectionNestedParens_IsNeutralized()
    {
        var input = "((((test))))";
        var escaped = LdapFilterHelper.EscapeFilter(input);

        escaped.Should().NotContain("(");
        escaped.Should().NotContain(")");
    }

    [Fact]
    public void EscapeFilter_InjectionBackslashEscape_IsNeutralized()
    {
        // Attacker tries to use backslash to escape the escaping
        var input = "test\\28real-paren";
        var escaped = LdapFilterHelper.EscapeFilter(input);

        // Backslash is escaped first, so \\28 becomes \\5c28, not an actual paren
        escaped.Should().Be("test\\5c28real-paren");
    }

    // === EscapeFilter - Unicode and Special Characters ===

    [Fact]
    public void EscapeFilter_UnicodeCharacters_PreservedUnchanged()
    {
        LdapFilterHelper.EscapeFilter("Jean-Pierre").Should().Be("Jean-Pierre");
    }

    [Fact]
    public void EscapeFilter_AccentedCharacters_PreservedUnchanged()
    {
        LdapFilterHelper.EscapeFilter("Rene Dupont").Should().Be("Rene Dupont");
    }

    [Fact]
    public void EscapeFilter_CJKCharacters_PreservedUnchanged()
    {
        LdapFilterHelper.EscapeFilter("\u7530\u4E2D").Should().Be("\u7530\u4E2D");
    }

    [Fact]
    public void EscapeFilter_EmailFormat_PreservedExceptSpecials()
    {
        LdapFilterHelper.EscapeFilter("user@domain.com").Should().Be("user@domain.com");
    }

    // === ValidateSearchInput ===

    [Fact]
    public void ValidateSearchInput_NormalText_ReturnsTrimmed()
    {
        LdapFilterHelper.ValidateSearchInput("  john.doe  ").Should().Be("john.doe");
    }

    [Fact]
    public void ValidateSearchInput_Null_ReturnsNull()
    {
        LdapFilterHelper.ValidateSearchInput(null).Should().BeNull();
    }

    [Fact]
    public void ValidateSearchInput_Empty_ReturnsNull()
    {
        LdapFilterHelper.ValidateSearchInput("").Should().BeNull();
    }

    [Fact]
    public void ValidateSearchInput_WhitespaceOnly_ReturnsNull()
    {
        LdapFilterHelper.ValidateSearchInput("   ").Should().BeNull();
    }

    [Fact]
    public void ValidateSearchInput_ExceedsMaxLength_ReturnsNull()
    {
        var longInput = new string('a', LdapFilterHelper.MaxSearchInputLength + 1);
        LdapFilterHelper.ValidateSearchInput(longInput).Should().BeNull();
    }

    [Fact]
    public void ValidateSearchInput_ExactMaxLength_ReturnsInput()
    {
        var input = new string('a', LdapFilterHelper.MaxSearchInputLength);
        LdapFilterHelper.ValidateSearchInput(input).Should().Be(input);
    }

    [Fact]
    public void ValidateSearchInput_ControlCharacters_ReturnsNull()
    {
        LdapFilterHelper.ValidateSearchInput("test\x01value").Should().BeNull();
        LdapFilterHelper.ValidateSearchInput("test\u0007value").Should().BeNull();
        LdapFilterHelper.ValidateSearchInput("test\nvalue").Should().BeNull();
        LdapFilterHelper.ValidateSearchInput("test\rvalue").Should().BeNull();
    }

    [Fact]
    public void ValidateSearchInput_TabCharacter_IsAllowed()
    {
        LdapFilterHelper.ValidateSearchInput("test\tvalue").Should().Be("test\tvalue");
    }

    [Fact]
    public void ValidateSearchInput_NullByte_ReturnsNull()
    {
        LdapFilterHelper.ValidateSearchInput("test\0value").Should().BeNull();
    }

    [Fact]
    public void ValidateSearchInput_SpecialLdapChars_AreAllowed()
    {
        // ValidateSearchInput allows special chars - escaping is done later by EscapeFilter
        LdapFilterHelper.ValidateSearchInput("test*value").Should().Be("test*value");
        LdapFilterHelper.ValidateSearchInput("test(value)").Should().Be("test(value)");
    }

    // === End-to-end: ValidateSearchInput + EscapeFilter ===

    [Fact]
    public void FullPipeline_InjectionAttempt_IsNeutralized()
    {
        var malicious = "  )(objectClass=*)  ";

        var validated = LdapFilterHelper.ValidateSearchInput(malicious);
        validated.Should().NotBeNull();

        var escaped = LdapFilterHelper.EscapeFilter(validated!);
        escaped.Should().NotContain(")(");
        escaped.Should().NotContain("objectClass=*");

        // Simulate what LdapDirectoryProvider would build
        var ldapFilter = $"(&(objectClass=user)(objectCategory=person)(|(sAMAccountName=*{escaped}*)))";
        ldapFilter.Should().NotContain(")(objectClass=*)");
    }

    [Fact]
    public void FullPipeline_NullByteInjection_IsNeutralized()
    {
        var malicious = "admin\0)(objectClass=*)";

        // Control character makes validation reject it
        var validated = LdapFilterHelper.ValidateSearchInput(malicious);
        validated.Should().BeNull("null byte should be rejected at validation layer");
    }

    [Fact]
    public void FullPipeline_OversizedPayload_IsRejected()
    {
        var payload = new string('x', 10000);

        var validated = LdapFilterHelper.ValidateSearchInput(payload);
        validated.Should().BeNull("oversized input should be rejected as DoS protection");
    }
}
