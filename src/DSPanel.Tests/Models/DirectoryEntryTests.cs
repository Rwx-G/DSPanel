using DSPanel.Models;
using FluentAssertions;

namespace DSPanel.Tests.Models;

public class DirectoryEntryTests
{
    private static DirectoryEntry CreateEntry(Dictionary<string, string[]>? attributes = null)
    {
        return new DirectoryEntry
        {
            DistinguishedName = "CN=Test,DC=example,DC=com",
            SamAccountName = "testuser",
            DisplayName = "Test User",
            ObjectClass = "user",
            Attributes = attributes ?? new Dictionary<string, string[]>()
        };
    }

    [Fact]
    public void GetAttribute_ExistingKey_ReturnsFirstValue()
    {
        var entry = CreateEntry(new Dictionary<string, string[]>
        {
            ["mail"] = ["user@example.com", "alias@example.com"]
        });

        entry.GetAttribute("mail").Should().Be("user@example.com");
    }

    [Fact]
    public void GetAttribute_MissingKey_ReturnsNull()
    {
        var entry = CreateEntry();
        entry.GetAttribute("nonexistent").Should().BeNull();
    }

    [Fact]
    public void GetAttribute_EmptyArray_ReturnsNull()
    {
        var entry = CreateEntry(new Dictionary<string, string[]>
        {
            ["mail"] = []
        });

        entry.GetAttribute("mail").Should().BeNull();
    }

    [Fact]
    public void GetAttributes_ExistingKey_ReturnsAllValues()
    {
        var groups = new[] { "CN=Group1,DC=example,DC=com", "CN=Group2,DC=example,DC=com" };
        var entry = CreateEntry(new Dictionary<string, string[]>
        {
            ["memberOf"] = groups
        });

        entry.GetAttributes("memberOf").Should().BeEquivalentTo(groups);
    }

    [Fact]
    public void GetAttributes_MissingKey_ReturnsEmptyArray()
    {
        var entry = CreateEntry();
        entry.GetAttributes("nonexistent").Should().BeEmpty();
    }
}
