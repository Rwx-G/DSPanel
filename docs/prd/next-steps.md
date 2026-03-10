# Next Steps

### UX Expert Prompt

Review the DSPanel PRD (docs/prd.md) and create a detailed front-end specification for the WPF desktop application. Focus on the navigation shell, core screen layouts (13 views), component hierarchy, theming system (dark/light), and interaction patterns (search-first, drag-and-drop, dry-run previews). The application is WPF/.NET 10 with CommunityToolkit.Mvvm.

### Architect Prompt

Review the DSPanel PRD (docs/prd.md) and create the technical architecture document. Key decisions to address: IDirectoryProvider abstraction (LDAP vs Graph), permission detection system, preset engine (JSON on network share), audit log storage (SQLite), NTFS/ACL resolution, WMI remote monitoring, event log analysis for attack detection, and the MVVM/DI structure. Target stack: WPF, .NET 10, System.DirectoryServices.Protocols, Microsoft.Graph SDK, CommunityToolkit.Mvvm, Serilog, xUnit.
