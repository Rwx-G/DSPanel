using DSPanel.Models;

namespace DSPanel.Services.Directory;

public interface IDirectoryProvider
{
    bool IsConnected { get; }
    string? DomainName { get; }
    string? BaseDn { get; }
    string? ConnectedDc { get; }

    Task<bool> TestConnectionAsync();

    Task<IReadOnlyList<DirectoryEntry>> SearchUsersAsync(
        string filter, int maxResults = 50);

    Task<IReadOnlyList<DirectoryEntry>> SearchComputersAsync(
        string filter, int maxResults = 50);

    Task<IReadOnlyList<DirectoryEntry>> SearchGroupsAsync(
        string filter, int maxResults = 50);

    Task<DirectoryEntry?> GetUserByIdentityAsync(string samAccountName);

    Task<IReadOnlyList<DirectoryEntry>> GetGroupMembersAsync(
        string groupDn, int maxResults = 200);

    Task<IReadOnlyList<string>> GetUserGroupsAsync(string userDn);
}
