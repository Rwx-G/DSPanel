using System.Diagnostics.CodeAnalysis;
using System.DirectoryServices.Protocols;
using DSPanel.Helpers;
using DSPanel.Models;
using Microsoft.Extensions.Logging;

namespace DSPanel.Services.Directory;

[ExcludeFromCodeCoverage]
public sealed class LdapDirectoryProvider : IDirectoryProvider, IDisposable
{
    private readonly ILdapConnectionFactory _connectionFactory;
    private readonly ILogger<LdapDirectoryProvider> _logger;
    private readonly Lock _lock = new();
    private LdapConnection? _connection;

    public bool IsConnected { get; private set; }
    public string? DomainName { get; private set; }
    public string? BaseDn { get; private set; }
    public string? ConnectedDc { get; private set; }

    public LdapDirectoryProvider(
        ILdapConnectionFactory connectionFactory,
        ILogger<LdapDirectoryProvider> logger)
    {
        _connectionFactory = connectionFactory;
        _logger = logger;
    }

    public Task<bool> TestConnectionAsync()
    {
        return Task.Run(() =>
        {
            try
            {
                var domain = Environment.GetEnvironmentVariable("USERDNSDOMAIN");
                if (string.IsNullOrEmpty(domain))
                {
                    _logger.LogWarning("USERDNSDOMAIN not set - machine is not domain-joined");
                    IsConnected = false;
                    return false;
                }

                DomainName = domain;
                ConnectedDc = domain;

                lock (_lock)
                {
                    _connection?.Dispose();
                    _connection = _connectionFactory.Create(domain);
                    _connection.Bind();
                }

                var rootDseRequest = new SearchRequest(
                    null,
                    "(objectClass=*)",
                    SearchScope.Base,
                    "defaultNamingContext");

                SearchResponse rootDseResponse;
                lock (_lock)
                {
                    rootDseResponse = (SearchResponse)_connection.SendRequest(rootDseRequest);
                }

                BaseDn = rootDseResponse.Entries[0]
                    .Attributes["defaultNamingContext"][0].ToString();

                IsConnected = true;
                _logger.LogInformation("Connected to domain {Domain} with base DN {BaseDn}", domain, BaseDn);
                return true;
            }
            catch (LdapException ex)
            {
                _logger.LogError(ex, "Failed to connect to AD domain");
                IsConnected = false;
                return false;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Unexpected error connecting to AD domain");
                IsConnected = false;
                return false;
            }
        });
    }

    public Task<IReadOnlyList<DirectoryEntry>> SearchUsersAsync(string filter, int maxResults = 50)
    {
        var escaped = LdapFilterHelper.EscapeFilter(filter);
        var ldapFilter = $"(&(objectClass=user)(objectCategory=person)(|(sAMAccountName=*{escaped}*)(displayName=*{escaped}*)(userPrincipalName=*{escaped}*)(mail=*{escaped}*)))";
        return SearchAsync(ldapFilter, maxResults,
            "distinguishedName", "sAMAccountName", "displayName", "objectClass",
            "mail", "department", "title", "userPrincipalName",
            "userAccountControl", "lockoutTime", "accountExpires",
            "pwdLastSet", "lastLogon", "lastLogonTimestamp",
            "badPwdCount", "whenCreated", "whenChanged", "memberOf",
            "givenName", "sn", "telephoneNumber");
    }

    public Task<IReadOnlyList<DirectoryEntry>> SearchComputersAsync(string filter, int maxResults = 50)
    {
        var escaped = LdapFilterHelper.EscapeFilter(filter);
        var ldapFilter = $"(&(objectClass=computer)(|(sAMAccountName=*{escaped}*)(dNSHostName=*{escaped}*)(cn=*{escaped}*)))";
        return SearchAsync(ldapFilter, maxResults,
            "distinguishedName", "sAMAccountName", "displayName", "objectClass",
            "dNSHostName", "operatingSystem", "operatingSystemVersion",
            "lastLogon", "lastLogonTimestamp", "userAccountControl",
            "whenCreated", "whenChanged", "memberOf", "cn");
    }

    public Task<IReadOnlyList<DirectoryEntry>> SearchGroupsAsync(string filter, int maxResults = 50)
    {
        var escaped = LdapFilterHelper.EscapeFilter(filter);
        var ldapFilter = $"(&(objectClass=group)(|(sAMAccountName=*{escaped}*)(displayName=*{escaped}*)(cn=*{escaped}*)))";
        return SearchAsync(ldapFilter, maxResults,
            "distinguishedName", "sAMAccountName", "displayName", "objectClass",
            "description", "groupType", "member", "cn", "whenCreated");
    }

    public Task<DirectoryEntry?> GetUserByIdentityAsync(string samAccountName)
    {
        return Task.Run(() =>
        {
            if (!IsConnected || BaseDn is null)
                return null;

            var escaped = LdapFilterHelper.EscapeFilter(samAccountName);
            var ldapFilter = $"(&(objectClass=user)(objectCategory=person)(sAMAccountName={escaped}))";

            var request = new SearchRequest(
                BaseDn,
                ldapFilter,
                SearchScope.Subtree,
                "distinguishedName", "sAMAccountName", "displayName", "objectClass",
                "mail", "department", "title", "userPrincipalName",
                "userAccountControl", "lockoutTime", "accountExpires",
                "pwdLastSet", "lastLogon", "lastLogonTimestamp",
                "badPwdCount", "whenCreated", "whenChanged", "memberOf",
                "givenName", "sn", "telephoneNumber", "thumbnailPhoto");
            request.SizeLimit = 1;

            SearchResponse response;
            lock (_lock)
            {
                if (_connection is null) return null;
                response = (SearchResponse)_connection.SendRequest(request);
            }

            return response.Entries.Count > 0
                ? MapEntry(response.Entries[0])
                : null;
        });
    }

    public Task<IReadOnlyList<DirectoryEntry>> GetGroupMembersAsync(string groupDn, int maxResults = 200)
    {
        return Task.Run<IReadOnlyList<DirectoryEntry>>(() =>
        {
            if (!IsConnected)
                return [];

            var request = new SearchRequest(
                groupDn,
                "(objectClass=*)",
                SearchScope.Base,
                "member");

            SearchResponse response;
            lock (_lock)
            {
                if (_connection is null) return [];
                response = (SearchResponse)_connection.SendRequest(request);
            }

            if (response.Entries.Count == 0)
                return [];

            var memberDns = GetAttributeValues(response.Entries[0], "member");
            var results = new List<DirectoryEntry>();

            foreach (var memberDn in memberDns.Take(maxResults))
            {
                var memberRequest = new SearchRequest(
                    memberDn,
                    "(objectClass=*)",
                    SearchScope.Base,
                    "distinguishedName", "sAMAccountName", "displayName", "objectClass");

                try
                {
                    SearchResponse memberResponse;
                    lock (_lock)
                    {
                        if (_connection is null) return results;
                        memberResponse = (SearchResponse)_connection.SendRequest(memberRequest);
                    }

                    if (memberResponse.Entries.Count > 0)
                        results.Add(MapEntry(memberResponse.Entries[0]));
                }
                catch (LdapException ex)
                {
                    _logger.LogWarning(ex, "Failed to resolve group member {MemberDn}", memberDn);
                }
            }

            return results;
        });
    }

    public Task<IReadOnlyList<string>> GetUserGroupsAsync(string userDn)
    {
        return Task.Run<IReadOnlyList<string>>(() =>
        {
            if (!IsConnected)
                return [];

            var request = new SearchRequest(
                userDn,
                "(objectClass=*)",
                SearchScope.Base,
                "memberOf");

            SearchResponse response;
            lock (_lock)
            {
                if (_connection is null) return [];
                response = (SearchResponse)_connection.SendRequest(request);
            }

            if (response.Entries.Count == 0)
                return [];

            return GetAttributeValues(response.Entries[0], "memberOf");
        });
    }

    public Task<IReadOnlyList<Models.OrganizationalUnit>> GetOUTreeAsync()
    {
        return Task.Run<IReadOnlyList<Models.OrganizationalUnit>>(() =>
        {
            if (!IsConnected || BaseDn is null)
                return [];

            try
            {
                var request = new SearchRequest(
                    BaseDn,
                    "(objectClass=organizationalUnit)",
                    SearchScope.Subtree,
                    "distinguishedName", "name");

                SearchResponse response;
                lock (_lock)
                {
                    if (_connection is null) return [];
                    response = (SearchResponse)_connection.SendRequest(request);
                }

                var allOUs = new Dictionary<string, Models.OrganizationalUnit>();
                foreach (SearchResultEntry entry in response.Entries)
                {
                    var dn = entry.DistinguishedName;
                    var name = entry.Attributes.Contains("name")
                        ? entry.Attributes["name"][0]?.ToString() ?? dn
                        : dn;

                    allOUs[dn] = new Models.OrganizationalUnit
                    {
                        Name = name,
                        DistinguishedName = dn
                    };
                }

                // Build tree by matching parent DNs
                var roots = new List<Models.OrganizationalUnit>();
                foreach (var ou in allOUs.Values)
                {
                    var parentDn = GetParentDn(ou.DistinguishedName);
                    if (parentDn is not null && allOUs.TryGetValue(parentDn, out var parent))
                    {
                        parent.Children.Add(ou);
                    }
                    else
                    {
                        roots.Add(ou);
                    }
                }

                return roots;
            }
            catch (LdapException ex)
            {
                _logger.LogError(ex, "Failed to retrieve OU tree");
                return [];
            }
        });
    }

    private static string? GetParentDn(string dn)
    {
        var commaIndex = dn.IndexOf(',');
        return commaIndex >= 0 ? dn[(commaIndex + 1)..] : null;
    }

    private Task<IReadOnlyList<DirectoryEntry>> SearchAsync(
        string ldapFilter, int maxResults, params string[] attributes)
    {
        return Task.Run<IReadOnlyList<DirectoryEntry>>(() =>
        {
            if (!IsConnected || BaseDn is null)
                return [];

            try
            {
                var request = new SearchRequest(BaseDn, ldapFilter, SearchScope.Subtree, attributes);
                request.SizeLimit = maxResults;

                SearchResponse response;
                lock (_lock)
                {
                    if (_connection is null) return [];
                    response = (SearchResponse)_connection.SendRequest(request);
                }

                var results = new List<DirectoryEntry>(response.Entries.Count);
                foreach (SearchResultEntry entry in response.Entries)
                {
                    results.Add(MapEntry(entry));
                }
                return results;
            }
            catch (LdapException ex)
            {
                _logger.LogError(ex, "LDAP search failed with filter {Filter}", ldapFilter);
                return [];
            }
        });
    }

    private static DirectoryEntry MapEntry(SearchResultEntry entry)
    {
        var attributes = new Dictionary<string, string[]>();
        foreach (string attrName in entry.Attributes.AttributeNames)
        {
            var values = entry.Attributes[attrName];
            var stringValues = new string[values.Count];
            for (int i = 0; i < values.Count; i++)
            {
                stringValues[i] = values[i]?.ToString() ?? string.Empty;
            }
            attributes[attrName] = stringValues;
        }

        return new DirectoryEntry
        {
            DistinguishedName = entry.DistinguishedName,
            SamAccountName = attributes.TryGetValue("samaccountname", out var sam) && sam.Length > 0 ? sam[0] : null,
            DisplayName = attributes.TryGetValue("displayname", out var dn) && dn.Length > 0 ? dn[0] : null,
            ObjectClass = attributes.TryGetValue("objectclass", out var oc) && oc.Length > 0 ? oc[^1] : null,
            Attributes = attributes
        };
    }

    private static string[] GetAttributeValues(SearchResultEntry entry, string attributeName)
    {
        if (!entry.Attributes.Contains(attributeName))
            return [];

        var attr = entry.Attributes[attributeName];
        var values = new string[attr.Count];
        for (int i = 0; i < attr.Count; i++)
        {
            values[i] = attr[i]?.ToString() ?? string.Empty;
        }
        return values;
    }

    public void Dispose()
    {
        lock (_lock)
        {
            _connection?.Dispose();
            _connection = null;
        }
    }
}
