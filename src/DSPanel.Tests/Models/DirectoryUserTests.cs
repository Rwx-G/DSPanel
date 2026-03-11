using DSPanel.Models;
using FluentAssertions;

namespace DSPanel.Tests.Models;

public class DirectoryUserTests
{
    // ---- ExtractOuFromDn ----

    [Theory]
    [InlineData("CN=John Doe,OU=Users,DC=example,DC=com", "OU=Users,DC=example,DC=com")]
    [InlineData("CN=Test,DC=corp,DC=local", "DC=corp,DC=local")]
    public void ExtractOuFromDn_ValidDn_ReturnsParentContainer(string dn, string expected)
    {
        DirectoryUser.ExtractOuFromDn(dn).Should().Be(expected);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void ExtractOuFromDn_NullOrEmpty_ReturnsNull(string? dn)
    {
        DirectoryUser.ExtractOuFromDn(dn).Should().BeNull();
    }

    [Fact]
    public void ExtractOuFromDn_NoComma_ReturnsNull()
    {
        DirectoryUser.ExtractOuFromDn("CN=Orphan").Should().BeNull();
    }

    [Fact]
    public void ExtractOuFromDn_TrailingComma_ReturnsNull()
    {
        DirectoryUser.ExtractOuFromDn("CN=Test,").Should().BeNull();
    }

    // ---- FromDirectoryEntry ----

    [Fact]
    public void FromDirectoryEntry_MapsBasicProperties()
    {
        var entry = new DirectoryEntry
        {
            DistinguishedName = "CN=John Doe,OU=Users,DC=example,DC=com",
            SamAccountName = "jdoe",
            DisplayName = "John Doe",
            Attributes = new Dictionary<string, string[]>
            {
                ["userPrincipalName"] = ["jdoe@example.com"],
                ["givenName"] = ["John"],
                ["sn"] = ["Doe"],
                ["mail"] = ["john.doe@example.com"],
                ["department"] = ["IT"],
                ["title"] = ["Engineer"],
                ["userAccountControl"] = ["512"], // Normal account, enabled
                ["badPwdCount"] = ["3"]
            }
        };

        var user = DirectoryUser.FromDirectoryEntry(entry);

        user.SamAccountName.Should().Be("jdoe");
        user.DisplayName.Should().Be("John Doe");
        user.UserPrincipalName.Should().Be("jdoe@example.com");
        user.GivenName.Should().Be("John");
        user.Surname.Should().Be("Doe");
        user.Email.Should().Be("john.doe@example.com");
        user.Department.Should().Be("IT");
        user.Title.Should().Be("Engineer");
        user.DistinguishedName.Should().Be("CN=John Doe,OU=Users,DC=example,DC=com");
        user.OrganizationalUnit.Should().Be("OU=Users,DC=example,DC=com");
        user.BadPasswordCount.Should().Be(3);
    }

    [Fact]
    public void FromDirectoryEntry_DisabledAccount_EnabledIsFalse()
    {
        var entry = new DirectoryEntry
        {
            DistinguishedName = "CN=Test,DC=example,DC=com",
            Attributes = new Dictionary<string, string[]>
            {
                ["userAccountControl"] = ["514"] // 512 + 2 (disabled)
            }
        };

        var user = DirectoryUser.FromDirectoryEntry(entry);
        user.Enabled.Should().BeFalse();
    }

    [Fact]
    public void FromDirectoryEntry_EnabledAccount_EnabledIsTrue()
    {
        var entry = new DirectoryEntry
        {
            DistinguishedName = "CN=Test,DC=example,DC=com",
            Attributes = new Dictionary<string, string[]>
            {
                ["userAccountControl"] = ["512"] // Normal account
            }
        };

        var user = DirectoryUser.FromDirectoryEntry(entry);
        user.Enabled.Should().BeTrue();
    }

    [Fact]
    public void FromDirectoryEntry_PasswordNeverExpires_FlagIsSet()
    {
        var entry = new DirectoryEntry
        {
            DistinguishedName = "CN=Test,DC=example,DC=com",
            Attributes = new Dictionary<string, string[]>
            {
                ["userAccountControl"] = ["66048"] // 512 + 65536 (DONT_EXPIRE_PASSWORD)
            }
        };

        var user = DirectoryUser.FromDirectoryEntry(entry);
        user.PasswordNeverExpires.Should().BeTrue();
    }

    [Fact]
    public void FromDirectoryEntry_PasswordExpired_FlagIsSet()
    {
        var entry = new DirectoryEntry
        {
            DistinguishedName = "CN=Test,DC=example,DC=com",
            Attributes = new Dictionary<string, string[]>
            {
                ["userAccountControl"] = ["8389120"] // 512 + 8388608 (PASSWORD_EXPIRED)
            }
        };

        var user = DirectoryUser.FromDirectoryEntry(entry);
        user.PasswordExpired.Should().BeTrue();
    }

    [Fact]
    public void FromDirectoryEntry_LockedOut_WhenLockoutTimeNonZero()
    {
        var entry = new DirectoryEntry
        {
            DistinguishedName = "CN=Test,DC=example,DC=com",
            Attributes = new Dictionary<string, string[]>
            {
                ["userAccountControl"] = ["512"],
                ["lockoutTime"] = ["133515648000000000"]
            }
        };

        var user = DirectoryUser.FromDirectoryEntry(entry);
        user.LockedOut.Should().BeTrue();
    }

    [Fact]
    public void FromDirectoryEntry_NotLockedOut_WhenLockoutTimeZero()
    {
        var entry = new DirectoryEntry
        {
            DistinguishedName = "CN=Test,DC=example,DC=com",
            Attributes = new Dictionary<string, string[]>
            {
                ["userAccountControl"] = ["512"],
                ["lockoutTime"] = ["0"]
            }
        };

        var user = DirectoryUser.FromDirectoryEntry(entry);
        user.LockedOut.Should().BeFalse();
    }

    [Fact]
    public void FromDirectoryEntry_FileTimeAttribute_ParsesValidDate()
    {
        // 133515648000000000 = 2024-01-15 00:00:00 UTC (approximately)
        var entry = new DirectoryEntry
        {
            DistinguishedName = "CN=Test,DC=example,DC=com",
            Attributes = new Dictionary<string, string[]>
            {
                ["userAccountControl"] = ["512"],
                ["pwdLastSet"] = ["133515648000000000"]
            }
        };

        var user = DirectoryUser.FromDirectoryEntry(entry);
        user.PasswordLastSet.Should().NotBeNull();
        user.PasswordLastSet!.Value.Year.Should().BeGreaterThan(2000);
    }

    [Theory]
    [InlineData("0")]
    [InlineData("")]
    [InlineData(null)]
    public void FromDirectoryEntry_FileTimeAttribute_NullOrZero_ReturnsNull(string? value)
    {
        var attrs = new Dictionary<string, string[]> { ["userAccountControl"] = ["512"] };
        if (value is not null) attrs["accountExpires"] = [value];

        var entry = new DirectoryEntry
        {
            DistinguishedName = "CN=Test,DC=example,DC=com",
            Attributes = attrs
        };

        var user = DirectoryUser.FromDirectoryEntry(entry);
        user.AccountExpires.Should().BeNull();
    }

    [Fact]
    public void FromDirectoryEntry_GeneralizedTime_ParsesValidDate()
    {
        var entry = new DirectoryEntry
        {
            DistinguishedName = "CN=Test,DC=example,DC=com",
            Attributes = new Dictionary<string, string[]>
            {
                ["userAccountControl"] = ["512"],
                ["whenCreated"] = ["20240115120000.0Z"]
            }
        };

        var user = DirectoryUser.FromDirectoryEntry(entry);
        user.WhenCreated.Should().NotBeNull();
        user.WhenCreated!.Value.Year.Should().Be(2024);
        user.WhenCreated!.Value.Month.Should().Be(1);
        user.WhenCreated!.Value.Day.Should().Be(15);
    }

    [Fact]
    public void FromDirectoryEntry_MemberOf_MapsGroups()
    {
        var groups = new[] { "CN=Admins,DC=example,DC=com", "CN=Users,DC=example,DC=com" };
        var entry = new DirectoryEntry
        {
            DistinguishedName = "CN=Test,DC=example,DC=com",
            Attributes = new Dictionary<string, string[]>
            {
                ["userAccountControl"] = ["512"],
                ["memberOf"] = groups
            }
        };

        var user = DirectoryUser.FromDirectoryEntry(entry);
        user.MemberOf.Should().HaveCount(2);
        user.MemberOf.Should().Contain("CN=Admins,DC=example,DC=com");
    }

    [Fact]
    public void FromDirectoryEntry_NoUac_DefaultsToEnabled()
    {
        var entry = new DirectoryEntry
        {
            DistinguishedName = "CN=Test,DC=example,DC=com",
            Attributes = new Dictionary<string, string[]>()
        };

        var user = DirectoryUser.FromDirectoryEntry(entry);
        user.Enabled.Should().BeTrue(); // UAC 0 means disabled flag not set
    }

    [Fact]
    public void FromDirectoryEntry_GeneralizedTime_InvalidFormat_ReturnsNull()
    {
        var entry = new DirectoryEntry
        {
            DistinguishedName = "CN=Test,DC=example,DC=com",
            Attributes = new Dictionary<string, string[]>
            {
                ["userAccountControl"] = ["512"],
                ["whenCreated"] = ["not-a-date"]
            }
        };

        var user = DirectoryUser.FromDirectoryEntry(entry);
        user.WhenCreated.Should().BeNull();
    }

    [Fact]
    public void FromDirectoryEntry_GeneralizedTime_WithoutFraction_Parses()
    {
        var entry = new DirectoryEntry
        {
            DistinguishedName = "CN=Test,DC=example,DC=com",
            Attributes = new Dictionary<string, string[]>
            {
                ["userAccountControl"] = ["512"],
                ["whenCreated"] = ["20240115120000Z"]
            }
        };

        var user = DirectoryUser.FromDirectoryEntry(entry);
        user.WhenCreated.Should().NotBeNull();
    }

    [Fact]
    public void FromDirectoryEntry_FileTimeAttribute_MaxValue_ReturnsNull()
    {
        var entry = new DirectoryEntry
        {
            DistinguishedName = "CN=Test,DC=example,DC=com",
            Attributes = new Dictionary<string, string[]>
            {
                ["userAccountControl"] = ["512"],
                ["accountExpires"] = [long.MaxValue.ToString()]
            }
        };

        var user = DirectoryUser.FromDirectoryEntry(entry);
        user.AccountExpires.Should().BeNull();
    }

    [Fact]
    public void FromDirectoryEntry_FileTimeAttribute_InvalidString_ReturnsNull()
    {
        var entry = new DirectoryEntry
        {
            DistinguishedName = "CN=Test,DC=example,DC=com",
            Attributes = new Dictionary<string, string[]>
            {
                ["userAccountControl"] = ["512"],
                ["accountExpires"] = ["not-a-number"]
            }
        };

        var user = DirectoryUser.FromDirectoryEntry(entry);
        user.AccountExpires.Should().BeNull();
    }

    [Fact]
    public void FromDirectoryEntry_LockoutTime_InvalidString_NotLocked()
    {
        var entry = new DirectoryEntry
        {
            DistinguishedName = "CN=Test,DC=example,DC=com",
            Attributes = new Dictionary<string, string[]>
            {
                ["userAccountControl"] = ["512"],
                ["lockoutTime"] = ["not-a-number"]
            }
        };

        var user = DirectoryUser.FromDirectoryEntry(entry);
        user.LockedOut.Should().BeFalse();
    }

    [Fact]
    public void FromDirectoryEntry_FileTimeAttribute_OutOfRange_ReturnsNull()
    {
        // Value passes guards but causes ArgumentOutOfRangeException in FromFileTimeUtc
        var entry = new DirectoryEntry
        {
            DistinguishedName = "CN=Test,DC=example,DC=com",
            Attributes = new Dictionary<string, string[]>
            {
                ["userAccountControl"] = ["512"],
                ["accountExpires"] = ["2700000000000000000"]
            }
        };

        var user = DirectoryUser.FromDirectoryEntry(entry);
        user.AccountExpires.Should().BeNull();
    }

    [Fact]
    public void FromDirectoryEntry_GeneralizedTime_LowercaseZ_Parses()
    {
        var entry = new DirectoryEntry
        {
            DistinguishedName = "CN=Test,DC=example,DC=com",
            Attributes = new Dictionary<string, string[]>
            {
                ["userAccountControl"] = ["512"],
                ["whenCreated"] = ["20240115120000.0z"]
            }
        };

        var user = DirectoryUser.FromDirectoryEntry(entry);
        user.WhenCreated.Should().NotBeNull();
        user.WhenCreated!.Value.Year.Should().Be(2024);
    }

    [Fact]
    public void FromDirectoryEntry_InvalidBadPwdCount_DefaultsToZero()
    {
        var entry = new DirectoryEntry
        {
            DistinguishedName = "CN=Test,DC=example,DC=com",
            Attributes = new Dictionary<string, string[]>
            {
                ["userAccountControl"] = ["512"],
                ["badPwdCount"] = ["notanumber"]
            }
        };

        var user = DirectoryUser.FromDirectoryEntry(entry);
        user.BadPasswordCount.Should().Be(0);
    }
}
