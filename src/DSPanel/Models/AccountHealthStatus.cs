namespace DSPanel.Models;

/// <summary>
/// Severity level for an account health evaluation.
/// </summary>
public enum HealthLevel
{
    Healthy,
    Info,
    Warning,
    Critical
}

/// <summary>
/// A single health flag raised during account evaluation.
/// </summary>
/// <param name="Name">Short identifier of the flag.</param>
/// <param name="Severity">How severe this issue is.</param>
/// <param name="Description">Human-readable explanation.</param>
public record HealthFlag(string Name, HealthLevel Severity, string Description);

/// <summary>
/// Result of evaluating an account's health status.
/// </summary>
public class AccountHealthStatus
{
    /// <summary>
    /// The worst severity among all active flags, or Healthy if none.
    /// </summary>
    public HealthLevel OverallLevel { get; init; } = HealthLevel.Healthy;

    /// <summary>
    /// All health flags that were triggered during evaluation.
    /// </summary>
    public List<HealthFlag> ActiveFlags { get; init; } = [];

    /// <summary>
    /// Display text for the overall health level.
    /// </summary>
    public string StatusText => OverallLevel switch
    {
        HealthLevel.Healthy => "Healthy",
        HealthLevel.Info => "Info",
        HealthLevel.Warning => "Warning",
        HealthLevel.Critical => "Critical",
        _ => "Unknown"
    };
}
