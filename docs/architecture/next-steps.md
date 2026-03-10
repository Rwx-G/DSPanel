# Next Steps

### Architect Prompt (Frontend/UI)

DSPanel is a desktop WPF application - there is no separate frontend. The UI architecture is embedded within this document (MVVM pattern, Views, ViewModels, navigation service). Proceed directly to story implementation.

### Development Start

Review the PRD (docs/prd.md) Epic 1 stories and begin implementation following this architecture document. Key files to create first:
1. Project skeleton with DI and hosting (Story 1.1)
2. IDirectoryProvider interface and LDAP implementation (Story 1.2)
3. PermissionService (Story 1.3)
4. UserLookupViewModel and View (Story 1.4)
