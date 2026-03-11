using System.ComponentModel.DataAnnotations;
using System.Text.RegularExpressions;

namespace DSPanel.Validation;

/// <summary>
/// Validates that a string is a valid SAM account name
/// (max 20 characters, alphanumeric with . _ -).
/// </summary>
public partial class ValidSamAccountNameAttribute : ValidationAttribute
{
    protected override ValidationResult? IsValid(object? value, ValidationContext context)
    {
        if (value is null or "")
            return ValidationResult.Success; // Let [Required] handle empty

        if (value is not string sam)
            return new ValidationResult("Value must be a string.");

        if (sam.Length > 20)
            return new ValidationResult("SAM account name must be 20 characters or less.");

        if (!SamAccountNameRegex().IsMatch(sam))
            return new ValidationResult("SAM account name may only contain letters, digits, periods, underscores, and hyphens.");

        return ValidationResult.Success;
    }

    [GeneratedRegex(@"^[a-zA-Z0-9._\-]+$")]
    private static partial Regex SamAccountNameRegex();
}
