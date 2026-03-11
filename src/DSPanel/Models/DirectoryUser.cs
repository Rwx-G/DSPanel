namespace DSPanel.Models;

/// <summary>
/// Represents an Active Directory user account with all relevant properties.
/// </summary>
public sealed class DirectoryUser
{
    public string SamAccountName { get; init; } = string.Empty;
    public string? UserPrincipalName { get; init; }
    public string? DisplayName { get; init; }
    public string? GivenName { get; init; }
    public string? Surname { get; init; }
    public string? Email { get; init; }
    public string? Department { get; init; }
    public string? Title { get; init; }
    public string DistinguishedName { get; init; } = string.Empty;
    public string? OrganizationalUnit { get; init; }
    public bool Enabled { get; init; }
    public bool LockedOut { get; init; }
    public DateTime? AccountExpires { get; init; }
    public DateTime? PasswordLastSet { get; init; }
    public bool PasswordExpired { get; init; }
    public bool PasswordNeverExpires { get; init; }
    public DateTime? LastLogon { get; init; }
    public string? LastLogonWorkstation { get; init; }
    public int BadPasswordCount { get; init; }
    public DateTime? WhenCreated { get; init; }
    public DateTime? WhenChanged { get; init; }
    public List<string> MemberOf { get; init; } = [];

    /// <summary>
    /// UserAccountControl flag: account is disabled.
    /// </summary>
    private const int UacDisabled = 0x0002;

    /// <summary>
    /// UserAccountControl flag: password never expires.
    /// </summary>
    private const int UacPasswordNeverExpires = 0x10000;

    /// <summary>
    /// UserAccountControl flag: password expired.
    /// </summary>
    private const int UacPasswordExpired = 0x800000;

    /// <summary>
    /// Extracts the organizational unit from a distinguished name.
    /// Returns the parent container portion after the first CN= component.
    /// </summary>
    public static string? ExtractOuFromDn(string? dn)
    {
        if (string.IsNullOrWhiteSpace(dn))
            return null;

        // Find the first comma after the CN= part to get the parent container
        var commaIndex = dn.IndexOf(',');
        if (commaIndex < 0 || commaIndex + 1 >= dn.Length)
            return null;

        return dn[(commaIndex + 1)..];
    }

    /// <summary>
    /// Creates a <see cref="DirectoryUser"/> from a <see cref="DirectoryEntry"/> by mapping
    /// LDAP attributes to strongly-typed properties.
    /// </summary>
    public static DirectoryUser FromDirectoryEntry(DirectoryEntry entry)
    {
        var uacString = entry.GetAttribute("userAccountControl");
        var uac = int.TryParse(uacString, out var uacValue) ? uacValue : 0;

        return new DirectoryUser
        {
            SamAccountName = entry.SamAccountName ?? string.Empty,
            UserPrincipalName = entry.GetAttribute("userPrincipalName"),
            DisplayName = entry.DisplayName,
            GivenName = entry.GetAttribute("givenName"),
            Surname = entry.GetAttribute("sn"),
            Email = entry.GetAttribute("mail"),
            Department = entry.GetAttribute("department"),
            Title = entry.GetAttribute("title"),
            DistinguishedName = entry.DistinguishedName,
            OrganizationalUnit = ExtractOuFromDn(entry.DistinguishedName),
            Enabled = (uac & UacDisabled) == 0,
            LockedOut = ParseBool(entry.GetAttribute("lockoutTime")),
            AccountExpires = ParseFileTimeAttribute(entry.GetAttribute("accountExpires")),
            PasswordLastSet = ParseFileTimeAttribute(entry.GetAttribute("pwdLastSet")),
            PasswordExpired = (uac & UacPasswordExpired) != 0,
            PasswordNeverExpires = (uac & UacPasswordNeverExpires) != 0,
            LastLogon = ParseFileTimeAttribute(entry.GetAttribute("lastLogon")),
            LastLogonWorkstation = entry.GetAttribute("lastLogonWorkstation"),
            BadPasswordCount = int.TryParse(entry.GetAttribute("badPwdCount"), out var bpc) ? bpc : 0,
            WhenCreated = ParseGeneralizedTime(entry.GetAttribute("whenCreated")),
            WhenChanged = ParseGeneralizedTime(entry.GetAttribute("whenChanged")),
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

        // 0 means "not set", and very large values mean "never"
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

    /// <summary>
    /// Parses a generalized time string (yyyyMMddHHmmss.fZ) to a nullable DateTime.
    /// </summary>
    private static DateTime? ParseGeneralizedTime(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
            return null;

        // Generalized time format: "20230101120000.0Z"
        var cleanValue = value.TrimEnd('Z', 'z');

        // Remove fractional seconds
        var dotIndex = cleanValue.IndexOf('.');
        if (dotIndex > 0)
            cleanValue = cleanValue[..dotIndex];

        if (DateTime.TryParseExact(
            cleanValue,
            "yyyyMMddHHmmss",
            System.Globalization.CultureInfo.InvariantCulture,
            System.Globalization.DateTimeStyles.AssumeUniversal,
            out var result))
        {
            return result;
        }

        return null;
    }

    /// <summary>
    /// Parses a lockout time value. A non-zero value indicates the account is locked.
    /// </summary>
    private static bool ParseBool(string? lockoutTime)
    {
        if (string.IsNullOrWhiteSpace(lockoutTime))
            return false;

        return long.TryParse(lockoutTime, out var value) && value > 0;
    }
}
