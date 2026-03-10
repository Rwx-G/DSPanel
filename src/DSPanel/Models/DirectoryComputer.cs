namespace DSPanel.Models;

/// <summary>
/// Represents an Active Directory computer account with relevant properties.
/// </summary>
public sealed class DirectoryComputer
{
    public string Name { get; init; } = string.Empty;
    public string? DnsHostName { get; init; }
    public string? OperatingSystem { get; init; }
    public string? OperatingSystemVersion { get; init; }
    public DateTime? LastLogon { get; init; }
    public string DistinguishedName { get; init; } = string.Empty;
    public string? OrganizationalUnit { get; init; }
    public bool Enabled { get; init; }
    public List<string> MemberOf { get; init; } = [];

    /// <summary>
    /// UserAccountControl flag: account is disabled.
    /// </summary>
    private const int UacDisabled = 0x0002;

    /// <summary>
    /// Creates a <see cref="DirectoryComputer"/> from a <see cref="DirectoryEntry"/> by mapping
    /// LDAP attributes to strongly-typed properties.
    /// </summary>
    public static DirectoryComputer FromDirectoryEntry(DirectoryEntry entry)
    {
        var uacString = entry.GetAttribute("userAccountControl");
        var uac = int.TryParse(uacString, out var uacValue) ? uacValue : 0;

        return new DirectoryComputer
        {
            Name = entry.GetAttribute("cn") ?? entry.SamAccountName?.TrimEnd('$') ?? string.Empty,
            DnsHostName = entry.GetAttribute("dNSHostName"),
            OperatingSystem = entry.GetAttribute("operatingSystem"),
            OperatingSystemVersion = entry.GetAttribute("operatingSystemVersion"),
            LastLogon = ParseFileTimeAttribute(entry.GetAttribute("lastLogon")),
            DistinguishedName = entry.DistinguishedName,
            OrganizationalUnit = DirectoryUser.ExtractOuFromDn(entry.DistinguishedName),
            Enabled = (uac & UacDisabled) == 0,
            MemberOf = [.. entry.GetAttributes("memberOf")]
        };
    }

    /// <summary>
    /// Parses a Windows file time string to a nullable DateTime.
    /// Returns null for never-expire sentinel values (0 or max file time).
    /// </summary>
    private static DateTime? ParseFileTimeAttribute(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
            return null;

        if (!long.TryParse(value, out var fileTime))
            return null;

        if (fileTime <= 0 || fileTime >= DateTime.MaxValue.Ticks)
            return null;

        try
        {
            return DateTime.FromFileTimeUtc(fileTime);
        }
        catch (ArgumentOutOfRangeException)
        {
            return null;
        }
    }
}
