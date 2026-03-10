using DSPanel.Services.Directory;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace DSPanel.Services.Permissions;

public sealed class PermissionService(
    IDirectoryProvider directoryProvider,
    IOptions<PermissionOptions> options,
    ILogger<PermissionService> logger) : IPermissionService
{
    private readonly Dictionary<string, PermissionLevel> _groupMappings = BuildMappings(options.Value);

    public PermissionLevel CurrentLevel { get; private set; } = PermissionLevel.ReadOnly;
    public IReadOnlyList<string> UserGroups { get; private set; } = [];

    public async Task DetectPermissionsAsync()
    {
        if (!directoryProvider.IsConnected)
        {
            logger.LogWarning("Directory provider not connected - defaulting to ReadOnly");
            CurrentLevel = PermissionLevel.ReadOnly;
            UserGroups = [];
            return;
        }

        try
        {
            var userName = Environment.UserName;
            var user = await directoryProvider.GetUserByIdentityAsync(userName);
            if (user is null)
            {
                logger.LogWarning("Could not find current user {UserName} in AD - defaulting to ReadOnly", userName);
                CurrentLevel = PermissionLevel.ReadOnly;
                return;
            }

            var groupDns = await directoryProvider.GetUserGroupsAsync(user.DistinguishedName);
            var groupNames = groupDns
                .Select(dn => ExtractCn(dn))
                .Where(cn => cn is not null)
                .Cast<string>()
                .ToList();

            UserGroups = groupNames;

            var detectedLevel = PermissionLevel.ReadOnly;
            foreach (var group in groupNames)
            {
                if (_groupMappings.TryGetValue(group, out var level) && level > detectedLevel)
                {
                    detectedLevel = level;
                }
            }

            CurrentLevel = detectedLevel;
            logger.LogInformation("Permission level detected: {Level} for user {UserName}", CurrentLevel, userName);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to detect permissions - defaulting to ReadOnly");
            CurrentLevel = PermissionLevel.ReadOnly;
        }
    }

    public bool HasPermission(PermissionLevel required) => CurrentLevel >= required;

    private static Dictionary<string, PermissionLevel> BuildMappings(PermissionOptions options)
    {
        var mappings = new Dictionary<string, PermissionLevel>(StringComparer.OrdinalIgnoreCase);
        foreach (var (groupName, levelName) in options.GroupMappings)
        {
            if (Enum.TryParse<PermissionLevel>(levelName, ignoreCase: true, out var level))
            {
                mappings[groupName] = level;
            }
        }
        return mappings;
    }

    private static string? ExtractCn(string distinguishedName)
    {
        if (!distinguishedName.StartsWith("CN=", StringComparison.OrdinalIgnoreCase))
            return null;

        var commaIndex = distinguishedName.IndexOf(',');
        return commaIndex > 3
            ? distinguishedName[3..commaIndex]
            : distinguishedName[3..];
    }
}
