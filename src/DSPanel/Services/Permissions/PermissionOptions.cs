namespace DSPanel.Services.Permissions;

public sealed class PermissionOptions
{
    public Dictionary<string, string> GroupMappings { get; set; } = new()
    {
        ["DSPanel-HelpDesk"] = nameof(PermissionLevel.HelpDesk),
        ["DSPanel-AccountOps"] = nameof(PermissionLevel.AccountOperator),
        ["Domain Admins"] = nameof(PermissionLevel.DomainAdmin)
    };
}
