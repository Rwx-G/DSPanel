namespace DSPanel.Helpers;

/// <summary>
/// Provides LDAP filter escaping and input validation per RFC 4515.
/// </summary>
public static class LdapFilterHelper
{
    /// <summary>
    /// Maximum allowed length for search input to prevent DoS via oversized LDAP filters.
    /// </summary>
    public const int MaxSearchInputLength = 256;

    /// <summary>
    /// Escapes special characters in LDAP filter values per RFC 4515 Section 3.
    /// Must be applied to all user-provided values before interpolation into LDAP filters.
    /// </summary>
    public static string EscapeFilter(string input)
    {
        if (string.IsNullOrEmpty(input))
            return string.Empty;

        // RFC 4515: the following characters must be escaped with \xx hex encoding
        // Backslash must be escaped first to avoid double-escaping
        return input
            .Replace("\\", "\\5c")
            .Replace("*", "\\2a")
            .Replace("(", "\\28")
            .Replace(")", "\\29")
            .Replace("\0", "\\00")
            .Replace("/", "\\2f");
    }

    /// <summary>
    /// Validates and sanitizes search input from the UI layer.
    /// Returns null if the input is invalid or potentially malicious.
    /// Returns the trimmed input if valid.
    /// </summary>
    public static string? ValidateSearchInput(string? input)
    {
        if (string.IsNullOrWhiteSpace(input))
            return null;

        var trimmed = input.Trim();

        // Reject oversized input (DoS protection)
        if (trimmed.Length > MaxSearchInputLength)
            return null;

        // Reject input containing control characters (except normal whitespace)
        foreach (var c in trimmed)
        {
            if (char.IsControl(c) && c != '\t')
                return null;
        }

        return trimmed;
    }
}
