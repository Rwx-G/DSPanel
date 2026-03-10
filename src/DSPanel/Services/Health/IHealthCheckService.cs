using DSPanel.Models;

namespace DSPanel.Services.Health;

/// <summary>
/// Evaluates the health status of an Active Directory user account.
/// </summary>
public interface IHealthCheckService
{
    /// <summary>
    /// Analyzes a user account and returns a health status with any active flags.
    /// </summary>
    /// <param name="user">The user account to evaluate.</param>
    /// <returns>An <see cref="AccountHealthStatus"/> summarizing the account health.</returns>
    AccountHealthStatus Evaluate(DirectoryUser user);
}
