namespace DSPanel.Services.Permissions;

public interface IPermissionService
{
    PermissionLevel CurrentLevel { get; }
    IReadOnlyList<string> UserGroups { get; }

    Task DetectPermissionsAsync();
    bool HasPermission(PermissionLevel required);
}
