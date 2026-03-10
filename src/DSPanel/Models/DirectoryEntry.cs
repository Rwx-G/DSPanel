namespace DSPanel.Models;

public sealed class DirectoryEntry
{
    public required string DistinguishedName { get; init; }
    public string? SamAccountName { get; init; }
    public string? DisplayName { get; init; }
    public string? ObjectClass { get; init; }
    public IReadOnlyDictionary<string, string[]> Attributes { get; init; }
        = new Dictionary<string, string[]>();

    public string? GetAttribute(string name)
    {
        return Attributes.TryGetValue(name, out string[]? values) && values.Length > 0
            ? values[0]
            : null;
    }

    public string[] GetAttributes(string name)
    {
        return Attributes.TryGetValue(name, out string[]? values)
            ? values
            : [];
    }
}
