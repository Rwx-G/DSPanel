using System.Diagnostics.CodeAnalysis;
using System.DirectoryServices.Protocols;

namespace DSPanel.Services.Directory;

[ExcludeFromCodeCoverage]
public sealed class LdapConnectionFactory : ILdapConnectionFactory
{
    public LdapConnection Create(string server)
    {
        var connection = new LdapConnection(
            new LdapDirectoryIdentifier(server, 389));
        connection.AuthType = AuthType.Negotiate;
        connection.SessionOptions.ProtocolVersion = 3;
        return connection;
    }
}
