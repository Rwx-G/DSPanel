using DSPanel.Models;
using FluentAssertions;

namespace DSPanel.Tests.Models;

public class OrganizationalUnitTests
{
    [Fact]
    public void Constructor_SetsProperties()
    {
        var ou = new OrganizationalUnit
        {
            Name = "Users",
            DistinguishedName = "OU=Users,DC=example,DC=com"
        };

        ou.Name.Should().Be("Users");
        ou.DistinguishedName.Should().Be("OU=Users,DC=example,DC=com");
    }

    [Fact]
    public void Children_DefaultsToEmpty()
    {
        var ou = new OrganizationalUnit
        {
            Name = "Root",
            DistinguishedName = "DC=example,DC=com"
        };

        ou.Children.Should().BeEmpty();
    }

    [Fact]
    public void Children_CanAddNestedOUs()
    {
        var parent = new OrganizationalUnit
        {
            Name = "Corp",
            DistinguishedName = "OU=Corp,DC=example,DC=com"
        };

        var child = new OrganizationalUnit
        {
            Name = "Users",
            DistinguishedName = "OU=Users,OU=Corp,DC=example,DC=com"
        };

        parent.Children.Add(child);

        parent.Children.Should().HaveCount(1);
        parent.Children[0].Name.Should().Be("Users");
    }
}
