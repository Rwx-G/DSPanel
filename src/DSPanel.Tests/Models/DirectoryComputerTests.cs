using DSPanel.Models;
using FluentAssertions;

namespace DSPanel.Tests.Models;

public class DirectoryComputerTests
{
    [Fact]
    public void FromDirectoryEntry_MapsBasicProperties()
    {
        var entry = new DirectoryEntry
        {
            DistinguishedName = "CN=WS01,OU=Workstations,DC=example,DC=com",
            SamAccountName = "WS01$",
            Attributes = new Dictionary<string, string[]>
            {
                ["cn"] = ["WS01"],
                ["dNSHostName"] = ["ws01.example.com"],
                ["operatingSystem"] = ["Windows 11 Enterprise"],
                ["operatingSystemVersion"] = ["10.0 (22631)"],
                ["userAccountControl"] = ["4096"] // Workstation trust account
            }
        };

        var computer = DirectoryComputer.FromDirectoryEntry(entry);

        computer.Name.Should().Be("WS01");
        computer.DnsHostName.Should().Be("ws01.example.com");
        computer.OperatingSystem.Should().Be("Windows 11 Enterprise");
        computer.OperatingSystemVersion.Should().Be("10.0 (22631)");
        computer.DistinguishedName.Should().Be("CN=WS01,OU=Workstations,DC=example,DC=com");
        computer.OrganizationalUnit.Should().Be("OU=Workstations,DC=example,DC=com");
        computer.Enabled.Should().BeTrue();
    }

    [Fact]
    public void FromDirectoryEntry_DisabledComputer()
    {
        var entry = new DirectoryEntry
        {
            DistinguishedName = "CN=OLD-PC,DC=example,DC=com",
            Attributes = new Dictionary<string, string[]>
            {
                ["cn"] = ["OLD-PC"],
                ["userAccountControl"] = ["4098"] // 4096 + 2 (disabled)
            }
        };

        var computer = DirectoryComputer.FromDirectoryEntry(entry);
        computer.Enabled.Should().BeFalse();
    }

    [Fact]
    public void FromDirectoryEntry_NoCnAttribute_FallsBackToSamAccountName()
    {
        var entry = new DirectoryEntry
        {
            DistinguishedName = "CN=SERVER01,DC=example,DC=com",
            SamAccountName = "SERVER01$",
            Attributes = new Dictionary<string, string[]>
            {
                ["userAccountControl"] = ["4096"]
            }
        };

        var computer = DirectoryComputer.FromDirectoryEntry(entry);
        computer.Name.Should().Be("SERVER01"); // Trimmed trailing $
    }

    [Fact]
    public void FromDirectoryEntry_NoNameAttributes_DefaultsToEmpty()
    {
        var entry = new DirectoryEntry
        {
            DistinguishedName = "CN=Unknown,DC=example,DC=com",
            Attributes = new Dictionary<string, string[]>
            {
                ["userAccountControl"] = ["4096"]
            }
        };

        var computer = DirectoryComputer.FromDirectoryEntry(entry);
        computer.Name.Should().BeEmpty();
    }

    [Fact]
    public void FromDirectoryEntry_LastLogon_ParsesValidFileTime()
    {
        var entry = new DirectoryEntry
        {
            DistinguishedName = "CN=WS01,DC=example,DC=com",
            Attributes = new Dictionary<string, string[]>
            {
                ["cn"] = ["WS01"],
                ["userAccountControl"] = ["4096"],
                ["lastLogon"] = ["133515648000000000"]
            }
        };

        var computer = DirectoryComputer.FromDirectoryEntry(entry);
        computer.LastLogon.Should().NotBeNull();
        computer.LastLogon!.Value.Year.Should().BeGreaterThan(2000);
    }

    [Fact]
    public void FromDirectoryEntry_LastLogon_ZeroReturnsNull()
    {
        var entry = new DirectoryEntry
        {
            DistinguishedName = "CN=WS01,DC=example,DC=com",
            Attributes = new Dictionary<string, string[]>
            {
                ["cn"] = ["WS01"],
                ["userAccountControl"] = ["4096"],
                ["lastLogon"] = ["0"]
            }
        };

        var computer = DirectoryComputer.FromDirectoryEntry(entry);
        computer.LastLogon.Should().BeNull();
    }

    [Fact]
    public void FromDirectoryEntry_LastLogon_InvalidString_ReturnsNull()
    {
        var entry = new DirectoryEntry
        {
            DistinguishedName = "CN=WS01,DC=example,DC=com",
            Attributes = new Dictionary<string, string[]>
            {
                ["cn"] = ["WS01"],
                ["userAccountControl"] = ["4096"],
                ["lastLogon"] = ["not-a-number"]
            }
        };

        var computer = DirectoryComputer.FromDirectoryEntry(entry);
        computer.LastLogon.Should().BeNull();
    }

    [Fact]
    public void FromDirectoryEntry_LastLogon_MaxValueReturnsNull()
    {
        var entry = new DirectoryEntry
        {
            DistinguishedName = "CN=WS01,DC=example,DC=com",
            Attributes = new Dictionary<string, string[]>
            {
                ["cn"] = ["WS01"],
                ["userAccountControl"] = ["4096"],
                ["lastLogon"] = [long.MaxValue.ToString()]
            }
        };

        var computer = DirectoryComputer.FromDirectoryEntry(entry);
        computer.LastLogon.Should().BeNull();
    }

    [Fact]
    public void FromDirectoryEntry_LastLogon_NegativeReturnsNull()
    {
        var entry = new DirectoryEntry
        {
            DistinguishedName = "CN=WS01,DC=example,DC=com",
            Attributes = new Dictionary<string, string[]>
            {
                ["cn"] = ["WS01"],
                ["userAccountControl"] = ["4096"],
                ["lastLogon"] = ["-1"]
            }
        };

        var computer = DirectoryComputer.FromDirectoryEntry(entry);
        computer.LastLogon.Should().BeNull();
    }

    [Fact]
    public void FromDirectoryEntry_LastLogon_OutOfRangeFileTime_ReturnsNull()
    {
        // This value passes the <= 0 and >= MaxValue.Ticks guards but causes
        // DateTime.FromFileTimeUtc to throw ArgumentOutOfRangeException
        var entry = new DirectoryEntry
        {
            DistinguishedName = "CN=WS01,DC=example,DC=com",
            Attributes = new Dictionary<string, string[]>
            {
                ["cn"] = ["WS01"],
                ["userAccountControl"] = ["4096"],
                ["lastLogon"] = ["2700000000000000000"]
            }
        };

        var computer = DirectoryComputer.FromDirectoryEntry(entry);
        computer.LastLogon.Should().BeNull();
    }

    [Fact]
    public void FromDirectoryEntry_InvalidUac_DefaultsToEnabled()
    {
        var entry = new DirectoryEntry
        {
            DistinguishedName = "CN=WS01,DC=example,DC=com",
            Attributes = new Dictionary<string, string[]>
            {
                ["cn"] = ["WS01"],
                ["userAccountControl"] = ["not-a-number"]
            }
        };

        var computer = DirectoryComputer.FromDirectoryEntry(entry);
        computer.Enabled.Should().BeTrue(); // UAC defaults to 0, disabled flag not set
    }

    [Fact]
    public void FromDirectoryEntry_MemberOf_MapsGroups()
    {
        var groups = new[] { "CN=DomainComputers,DC=example,DC=com" };
        var entry = new DirectoryEntry
        {
            DistinguishedName = "CN=WS01,DC=example,DC=com",
            Attributes = new Dictionary<string, string[]>
            {
                ["cn"] = ["WS01"],
                ["userAccountControl"] = ["4096"],
                ["memberOf"] = groups
            }
        };

        var computer = DirectoryComputer.FromDirectoryEntry(entry);
        computer.MemberOf.Should().HaveCount(1);
        computer.MemberOf.Should().Contain("CN=DomainComputers,DC=example,DC=com");
    }
}
