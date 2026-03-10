# Goals and Background Context

### Goals

- Unify the entire AD support chain (ReadOnly, L1, L2, L3, DomainAdmin) into a single Windows desktop tool
- Dynamically adapt the UI based on the AD permissions of the current Windows user
- Natively support hybrid environments (AD on-prem via LDAP + Entra ID via Microsoft Graph)
- Deliver "premium" features as open source: NTFS permissions analysis crossed with AD, risk scoring, AD attack detection
- Provide guided workflows (onboarding/offboarding) based on declarative presets (JSON/YAML)
- Ensure full action traceability for compliance audits
- Fully replace aging and fragmented internal tools

### Background Context

Active Directory support in Windows environments currently relies on a fragmented combination of tools: RSAT, PowerShell, Exchange consoles, and aging in-house utilities. Each support level (L1 through L3) uses different tools, with no integrated permission management, no traceability, and no guided workflows. This fragmentation slows ticket resolution, increases error risk, and makes compliance impossible to demonstrate.

Existing commercial solutions (ManageEngine, Quest, Netwrix) cover parts of the need but are expensive, often web-based, and scatter features across multiple products. No open source tool covers the full identified scope - particularly NTFS analysis crossed with AD, risk scoring, and AD attack detection.

### Change Log

| Date | Version | Description | Author |
|------|---------|-------------|--------|
| 2026-03-10 | 0.1 | Initial PRD draft | Romain G. |

---
