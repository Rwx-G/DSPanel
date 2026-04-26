# Epic 14: Security-Aware Admin (Inline Risk Indicators and Quick-Fix Actions)

**Goal**: Differentiate DSPanel from generic AD admin tools (ManageEngine ADManager, Quest Active Roles) and from standalone AD security auditors (PingCastle, BloodHound, Adalanche) by surfacing per-object security risk indicators inline at the moment the operator manipulates an object, and by enabling 1-click remediation of the most common dangerous configurations directly from the admin workflow. The epic does not duplicate the domain-wide dashboards, risk score, or attack-path visualizations of Epic 9 - it operates strictly at the level of the individual user / computer the operator is currently looking at.

**Positioning rationale**: The post-1.0.5 market analysis (BloodHound CE, Adalanche, ManageEngine ADAudit Plus, Quest Security Guardian, PingCastle, Purple Knight, Locksmith) confirmed that no existing tool combines (a) modern multi-OS desktop admin UX, (b) inline contextual security indicators on individual objects, and (c) one-click safe remediation. Standalone audit tools are read-only and require the operator to leave the audit tool to fix the finding in another product. Epic 14 closes that gap.

**Out of scope**: full DACL parser, GMSA password reader enumeration, Shadow Credentials write-permission audit, DCSync rights enumeration on the domain root, AD CS template auditing. These belong to a possible future Epic 15 ("Security Posture") if customer demand justifies the 2-3 week investment to compete with PingCastle on its own ground.

---

### Story 14.1: Security Indicators Backend Foundation

As a DSPanel developer,
I want a pure Rust service that evaluates per-object security indicators from already-fetched LDAP attributes,
so that the UI layer can render the indicators without performing additional LDAP round-trips and the logic can be unit-tested deterministically.

#### Acceptance Criteria

1. New service module `src-tauri/src/services/security_indicators.rs` exposes a pure function `evaluate_user_indicators(user: &DirectoryUser) -> SecurityIndicatorSet` and an analogous `evaluate_computer_indicators(computer: &DirectoryComputer) -> SecurityIndicatorSet`.
2. `SecurityIndicatorSet` carries an ordered list of `SecurityIndicator { kind: SecurityIndicatorKind, severity: IndicatorSeverity, description_key: String }` where `kind` is a stable enum and `description_key` is an i18n key (not a translated string).
3. `IndicatorSeverity` reuses the existing `HealthLevel` enum (`Healthy`, `Info`, `Warning`, `Critical`) for visual consistency with the existing `HealthBadge`. No new severity scale is introduced.
4. The service detects all eight indicators specified in stories 14.2 and 14.3 from `userAccountControl` bit flags (`PasswordNotRequired` 0x0020, `ReversibleEncryption` 0x0080, `PasswordNeverExpires` 0x10000, `DontRequirePreauth` 0x400000, `UnconstrainedDelegation` 0x80000) and from attribute presence (`servicePrincipalName`, `msDS-AllowedToDelegateTo`, `msDS-AllowedToActOnBehalfOfOtherIdentity`).
5. A new Tauri command `evaluate_security_indicators` exposes the service to the frontend, accepting either a `DirectoryUser` or a `DirectoryComputer` payload.
6. All required attributes (`userAccountControl`, `servicePrincipalName`, `msDS-AllowedToDelegateTo`, `msDS-AllowedToActOnBehalfOfOtherIdentity`) are already in the `USER_ATTRS` / `COMPUTER_ATTRS` arrays in `services/ldap_directory.rs` - no new LDAP requests are added by this epic.
7. Unit tests cover every indicator in isolation, multiple indicators combined on a single object, and the empty (no indicators) case. Tests follow the same pattern as `services/health.rs::tests`.

---

### Story 14.2: User Security Indicator Badges

As an AD operator,
I want visual badges on users that flag known dangerous configurations (kerberoastable, password not required, password never expires, reversible encryption, AS-REP roastable),
so that I see the risk at the moment I am looking at the account, without having to consult a separate audit tool.

#### Acceptance Criteria

1. The `UserDetail` page renders a row of badges next to the existing `HealthBadge`, `enabled/disabled` and `locked` badges.
2. Five user-side indicators render their own badge: `Kerberoastable` (severity Warning - Critical if also adminCount=1), `PasswordNotRequired` (Critical), `PasswordNeverExpires` (Warning - Critical if also adminCount=1), `ReversibleEncryption` (Critical), `AsRepRoastable` (Critical).
3. Each badge uses the existing `StatusBadge` component with the variant matching its severity (no new component is introduced).
4. Each badge has a tooltip on hover that explains the attack vector in non-technical operator language and references the AD attribute that triggered it (e.g. "userAccountControl bit DONT_REQUIRE_PREAUTH").
5. Translations exist in `src/locales/{en,fr,de,it,es}/userDetail.json` (or the existing namespace used by UserDetail) for the badge label and the tooltip body of every indicator.
6. The user search results list (`UserLookup`) renders only the **highest severity** indicator as a small dot next to the existing health dot, to keep the row compact. Hovering the dot opens a popover listing all indicators on the user.
7. Frontend unit tests verify badge rendering for each indicator and the dot aggregation in the lookup list.

---

### Story 14.3: Computer Security Indicator Badges

As an AD operator,
I want visual badges on computer objects that flag dangerous Kerberos delegation configurations,
so that I can identify computers that are prime targets for Kerberos relay or constrained-delegation abuse before scheduling maintenance or decommissioning them.

#### Acceptance Criteria

1. The `ComputerDetail` page (and equivalent area in `ComputerLookup`) renders a row of badges following the same pattern as Story 14.2.
2. Three computer-side indicators render their own badge: `UnconstrainedDelegation` (Critical - any compromise of this computer compromises every account that ever authenticated against it), `ConstrainedDelegation` (Warning, with the list of target SPNs in the tooltip), `RBCD` (Warning, with the list of allowed-to-act SIDs in the tooltip).
3. The tooltips list the actual values of `msDS-AllowedToDelegateTo` and `msDS-AllowedToActOnBehalfOfOtherIdentity` for the operator to verify what the configuration actually permits.
4. Translations are added to the relevant computer namespace in `src/locales/{en,fr,de,it,es}/`.
5. The computer lookup list mirrors the user-list dot pattern: highest severity dot, popover on hover listing all indicators.
6. Frontend unit tests cover the three indicator badges and the dot aggregation.

---

### Story 14.4: Quick-Fix - Clear PasswordNotRequired

As an AccountOperator,
I want a "Clear PasswordNotRequired flag" button next to the `PasswordNotRequired` badge,
so that I can remediate the misconfiguration in two clicks (open user, click button) instead of switching to ADUC, finding the user, opening properties, navigating to Account tab, unticking the box, and applying.

#### Acceptance Criteria

1. The badge `PasswordNotRequired` on `UserDetail` (Story 14.2) gains an inline button "Fix" visible only when the operator's permission level is `AccountOperator` or higher.
2. Clicking the button opens a `ConfirmationDialog` (existing component) with the i18n message explaining: what the flag does, why it is dangerous, what the fix does (`userAccountControl &= ~0x0020`), and a checkbox "I understand this user must comply with the domain password policy at next logon".
3. The dialog is gated by the existing `MfaGate` from Epic 2 if the operator has MFA configured and the action category is set to require MFA in the MFA settings.
4. On confirmation, a new Tauri command `clear_password_not_required` is invoked on the user DN.
5. The backend command reads the current `userAccountControl`, clears bit 0x0020, writes it back via `Mod::Replace`, and emits an `AuditEntry` with action `clear_password_not_required`, target_dn = the user DN, and details listing the previous and new UAC value.
6. The audit entry is captured by the existing SHA-256 hash chain (Epic 11) and forwarded to syslog if configured.
7. After successful fix, the `UserDetail` view reloads the user attributes and the `PasswordNotRequired` badge disappears.
8. Backend command is permission-gated at the service layer: invocation by a `ReadOnly` or `HelpDesk` operator returns an `AppError::PermissionDenied` even if the IPC call is somehow forged.
9. Unit tests cover the UAC bit manipulation (with multiple combinations of other UAC flags set) and the permission gate.

---

### Story 14.5: Quick-Fix - Remove Unused SPN

As an AccountOperator,
I want to be able to remove a Service Principal Name from a user account in one click after reviewing the list of registered SPNs,
so that I can mitigate kerberoasting risk on a service account whose SPN is leftover from a decommissioned service.

#### Acceptance Criteria

1. The `Kerberoastable` badge on `UserDetail` (Story 14.2) gains an inline button "Manage SPNs" visible only when the operator's permission level is `AccountOperator` or higher.
2. Clicking opens a dialog listing every value of `servicePrincipalName` on the user with a checkbox next to each. The dialog explains the kerberoasting attack and recommends removing SPNs that no longer correspond to a running service.
3. The operator can select one or more SPNs to remove and click "Remove selected". The dialog goes through `MfaGate` if applicable.
4. A new Tauri command `remove_user_spns` accepts the user DN and a list of SPN strings to remove.
5. The backend command reads the current `servicePrincipalName` multi-valued attribute, removes the listed values, and writes the remaining set back via `Mod::Replace` with the new HashSet (or Mod::Delete if the new set is empty).
6. An `AuditEntry` is emitted with action `remove_user_spns`, target_dn = the user DN, and details listing exactly which SPNs were removed and which remain.
7. After successful fix, the `UserDetail` view reloads. If all SPNs were removed, the `Kerberoastable` badge disappears; otherwise the badge remains with the new SPN count in its tooltip.
8. Permission-gated at service layer (`AccountOperator` minimum), same protection as Story 14.4.
9. Defensive: the command refuses to remove an SPN if its prefix is `ldap/`, `host/`, `cifs/`, `HOST/`, `RestrictedKrbHost/` or other system SPNs. The dialog hides these from the selectable list with a "system SPN, cannot be removed safely" tooltip on hover.
10. Unit tests cover the multi-valued attribute manipulation, the system-SPN guard, the empty-after-removal case, and the permission gate.

---

### Story 14.6: Quick-Fix - Disable Unconstrained Delegation

As an Admin,
I want a "Disable Unconstrained Delegation" button on a computer object that has the flag set,
so that I can remove the most dangerous form of Kerberos delegation (which lets the computer accept TGTs of any user that authenticates against it) in two clicks.

#### Acceptance Criteria

1. The `UnconstrainedDelegation` badge on `ComputerDetail` (Story 14.3) gains an inline button "Fix" visible only when the operator's permission level is `Admin` or higher (note: this is a higher bar than user-level fixes since computer delegation changes can break legitimate Kerberos services like SQL Server, IIS with constrained delegation, etc.).
2. Clicking opens a `ConfirmationDialog` warning that disabling unconstrained delegation may break services that rely on Kerberos double-hop. The dialog explains the attack vector (golden ticket TGT replay), recommends migrating to constrained delegation if double-hop is genuinely needed, and includes a checkbox "I have verified no production service on this host requires unconstrained delegation".
3. The dialog goes through `MfaGate` if applicable.
4. A new Tauri command `disable_unconstrained_delegation` is invoked on the computer DN.
5. The backend command reads the current `userAccountControl`, clears bit 0x80000 (TRUSTED_FOR_DELEGATION), writes it back via `Mod::Replace`, and emits an `AuditEntry` with action `disable_unconstrained_delegation`, target_dn = the computer DN, details = previous and new UAC values.
6. After successful fix, the `ComputerDetail` view reloads and the `UnconstrainedDelegation` badge disappears.
7. Permission-gated at service layer (`Admin` minimum).
8. The action is recorded as `Critical` in the audit log severity (it modifies a Kerberos delegation primitive on a domain-joined host, with potential service-impact blast radius).
9. Unit tests cover the UAC bit manipulation and the permission gate.

---

## Dependencies and sequencing

Story 14.1 must complete before 14.2 and 14.3 (both depend on the backend service).
Story 14.2 must complete before 14.4 and 14.5 (the fix buttons live next to the user-side badges).
Story 14.3 must complete before 14.6 (the fix button lives next to the computer-side badge).

Stories 14.4, 14.5 and 14.6 are mutually independent and can be parallelized.

```
14.1 ─┬─> 14.2 ─┬─> 14.4
      │         └─> 14.5
      └─> 14.3 ───> 14.6
```

## Compatibility and rollback

- All new badges are additive UI - no existing badge or attribute display is modified.
- All new Tauri commands are additive - no existing command signature changes.
- The `evaluate_security_indicators` command reads attributes already fetched by the existing `search_users` / `search_computers` paths; no new LDAP queries.
- The three quick-fix commands write a single LDAP attribute each (`userAccountControl` for 14.4 / 14.6, `servicePrincipalName` for 14.5). Rollback for any of them is itself a UAC-bit-flip or an attribute restore from the object snapshot taken at the start of the modification (the existing snapshot service already captures pre-modification state for every IPC command).
- The audit hash chain (Epic 11) integrity is preserved - the new actions append to the existing chain, they do not modify past entries.

## Definition of Done

- All six stories' acceptance criteria are met and verified by automated tests.
- The eight indicators render correctly on a real test domain with intentionally vulnerable accounts (one user per indicator, one computer per indicator).
- The three quick-fixes have been manually exercised on a sandbox AD: each fix removes the corresponding badge after reload, the audit log records the action, and the syslog forwarder emits the entry on TCP and UDP.
- All translations in EN/FR/DE/IT/ES exist for every new UI string. No hardcoded English in production code.
- `cargo test` and `pnpm test` both pass with zero failures or new ignored tests.
- `CHANGELOG.md` `[Unreleased]` section has entries under Added (badges, fixes) and is moved to `[1.1.0] - YYYY-MM-DD` at release time.
- Version bumps in the five places listed in `CLAUDE.md` (Cargo.toml, tauri.conf.json, package.json, README.md badge, CHANGELOG.md).
- `AUDIT_FUNCTIONAL_COMPARISON.md` is updated (or a successor doc created) to record Epic 14 as the response to the "security-aware admin" niche identified in the post-1.0.5 market analysis.

## Out of scope (deferred to a possible future Epic 15)

- Full DACL parser walking ACE chains generically (would unlock GMSA password reader enumeration, Shadow Credential write detection, DCSync rights enumeration, AdminSDHolder template diff, AD CS template auditing).
- Per-attribute "who can write" lookups.
- Domain-wide attack surface scoring (Epic 9 already owns the domain-wide risk score).
- Integration with PingCastle / BloodHound / Adalanche (DSPanel is an admin tool, not an audit aggregator).
- LAPS password reader enumeration (requires DACL walk on the per-computer scope).
