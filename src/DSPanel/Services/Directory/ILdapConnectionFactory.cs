using System.DirectoryServices.Protocols;

namespace DSPanel.Services.Directory;

public interface ILdapConnectionFactory
{
    LdapConnection Create(string server);
}
