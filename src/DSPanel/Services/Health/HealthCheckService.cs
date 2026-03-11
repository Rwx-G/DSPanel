using DSPanel.Models;

namespace DSPanel.Services.Health;

/// <summary>
/// Evaluates user accounts against a set of health rules and returns
/// an overall status with individual flags.
/// </summary>
public class HealthCheckService : IHealthCheckService
{
    /// <inheritdoc />
    public AccountHealthStatus Evaluate(DirectoryUser user)
    {
        var flags = new List<HealthFlag>();

        if (!user.Enabled)
        {
            flags.Add(new HealthFlag(
                "Disabled", HealthLevel.Critical,
                "Account is disabled"));
        }

        if (user.LockedOut)
        {
            flags.Add(new HealthFlag(
                "LockedOut", HealthLevel.Critical,
                "Account is locked out"));
        }

        if (user.AccountExpires.HasValue && user.AccountExpires.Value <= DateTime.UtcNow)
        {
            flags.Add(new HealthFlag(
                "AccountExpired", HealthLevel.Critical,
                "Account has expired"));
        }

        if (user.PasswordExpired)
        {
            flags.Add(new HealthFlag(
                "PasswordExpired", HealthLevel.Critical,
                "Password has expired"));
        }

        if (user.PasswordNeverExpires)
        {
            flags.Add(new HealthFlag(
                "PasswordNeverExpires", HealthLevel.Warning,
                "Password is set to never expire"));
        }

        // Inactivity checks based on LastLogon
        if (user.LastLogon.HasValue)
        {
            var daysSinceLogon = (DateTime.UtcNow - user.LastLogon.Value).TotalDays;

            if (daysSinceLogon >= 90)
            {
                flags.Add(new HealthFlag(
                    "Inactive90Days", HealthLevel.Critical,
                    "No logon in the last 90 days"));
            }
            else if (daysSinceLogon >= 30)
            {
                flags.Add(new HealthFlag(
                    "Inactive30Days", HealthLevel.Warning,
                    "No logon in the last 30 days"));
            }
        }
        else if (user.Enabled)
        {
            // Enabled account that has never logged on
            flags.Add(new HealthFlag(
                "NeverLoggedOn", HealthLevel.Info,
                "Account has never logged on"));
        }

        // Password never changed: pwdLastSet is the same as whenCreated (or not set)
        if (user.PasswordLastSet is null || (user.WhenCreated.HasValue &&
            user.PasswordLastSet.HasValue &&
            Math.Abs((user.PasswordLastSet.Value - user.WhenCreated.Value).TotalMinutes) < 5))
        {
            // Only flag if the account is enabled and has been created
            if (user.Enabled && user.WhenCreated.HasValue)
            {
                flags.Add(new HealthFlag(
                    "PasswordNeverChanged", HealthLevel.Warning,
                    "Password has never been changed since account creation"));
            }
        }

        var overallLevel = flags.Count > 0
            ? flags.Max(f => f.Severity)
            : HealthLevel.Healthy;

        return new AccountHealthStatus
        {
            OverallLevel = overallLevel,
            ActiveFlags = flags
        };
    }
}
