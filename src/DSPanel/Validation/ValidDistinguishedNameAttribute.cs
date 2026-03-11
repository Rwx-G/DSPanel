using System.ComponentModel.DataAnnotations;

namespace DSPanel.Validation;

/// <summary>
/// Validates that a string looks like a valid LDAP distinguished name
/// (must contain at least one key=value component separated by commas).
/// </summary>
public class ValidDistinguishedNameAttribute : ValidationAttribute
{
    protected override ValidationResult? IsValid(object? value, ValidationContext context)
    {
        if (value is null or "")
            return ValidationResult.Success; // Let [Required] handle empty

        if (value is not string dn)
            return new ValidationResult("Value must be a string.");

        if (!IsValidDn(dn))
            return new ValidationResult("Value must be a valid distinguished name (e.g., CN=User,OU=Users,DC=example,DC=com).");

        return ValidationResult.Success;
    }

    internal static bool IsValidDn(string dn)
    {
        if (string.IsNullOrWhiteSpace(dn))
            return false;

        // Must contain at least one = sign and one comma for a minimal DN
        // e.g., "CN=Test,DC=local"
        var parts = dn.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (parts.Length < 2)
            return false;

        foreach (var part in parts)
        {
            var eqIndex = part.IndexOf('=');
            if (eqIndex <= 0 || eqIndex >= part.Length - 1)
                return false;

            var key = part[..eqIndex].Trim().ToUpperInvariant();
            if (key is not ("CN" or "OU" or "DC" or "O" or "L" or "ST" or "C" or "UID"))
                return false;
        }

        return true;
    }
}
