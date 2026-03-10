using System.Collections.ObjectModel;

namespace DSPanel.Models;

/// <summary>
/// Represents an Active Directory Organizational Unit node in a tree.
/// </summary>
public class OrganizationalUnit
{
    public required string Name { get; init; }
    public required string DistinguishedName { get; init; }
    public ObservableCollection<OrganizationalUnit> Children { get; } = [];
}
