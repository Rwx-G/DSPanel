using System.Diagnostics.CodeAnalysis;
using System.Net;
using System.Net.NetworkInformation;

namespace DSPanel.Services.Network;

/// <summary>
/// Production implementation of <see cref="INetworkService"/> using real network calls.
/// Excluded from code coverage because it wraps untestable system APIs.
/// </summary>
[ExcludeFromCodeCoverage]
public class NetworkService : INetworkService
{
    public async Task<PingResult> PingAsync(string hostNameOrAddress)
    {
        using var ping = new Ping();
        var reply = await ping.SendPingAsync(hostNameOrAddress, 3000);
        return new PingResult(
            reply.Status == IPStatus.Success,
            reply.Status.ToString(),
            reply.RoundtripTime,
            reply.Address?.ToString());
    }

    public async Task<string[]> DnsResolveAsync(string hostNameOrAddress)
    {
        var addresses = await Dns.GetHostAddressesAsync(hostNameOrAddress);
        return addresses.Select(a => a.ToString()).ToArray();
    }
}
