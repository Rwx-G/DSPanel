namespace DSPanel.Services.Network;

/// <summary>
/// Abstraction for network diagnostic operations (ping, DNS).
/// </summary>
public interface INetworkService
{
    /// <summary>
    /// Sends an ICMP echo request to the specified host.
    /// </summary>
    Task<PingResult> PingAsync(string hostNameOrAddress);

    /// <summary>
    /// Resolves the IP addresses associated with the specified host.
    /// </summary>
    Task<string[]> DnsResolveAsync(string hostNameOrAddress);
}

/// <summary>
/// Represents the result of an ICMP ping operation.
/// </summary>
public record PingResult(bool Success, string Status, long RoundtripTime, string? Address = null);
