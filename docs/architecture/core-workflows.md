# Core Workflows

### User Lookup Workflow

```mermaid
sequenceDiagram
    actor User
    participant UI as UserLookupPage (React)
    participant IPC as Tauri invoke()
    participant Cmd as Rust Command Handler
    participant Perm as permission module
    participant Dir as DirectoryProvider
    participant Health as health module
    participant Exch as exchange module

    User->>UI: Enter search query
    UI->>IPC: invoke('search_users', { query })
    IPC->>Cmd: search_users command
    Cmd->>Dir: search_users(query)
    Dir-->>Cmd: Vec<DirectoryUser>
    Cmd-->>UI: JSON response
    UI->>UI: Display results list

    User->>UI: Select user from results
    UI->>IPC: invoke('get_user_details', { user_dn })
    IPC->>Cmd: get_user_details command
    Cmd->>Dir: get_user_details(user_dn)
    Dir-->>Cmd: DirectoryUser (full attributes)
    Cmd->>Health: compute_user_health(user)
    Health-->>Cmd: AccountHealthStatus flags
    Cmd->>Exch: get_mailbox_info(user_dn)
    Exch-->>Cmd: Option<ExchangeMailboxInfo>
    Cmd-->>UI: JSON response (user + health + mailbox)
    UI->>UI: Check permission context
    UI->>UI: Show/hide action buttons based on permission
    UI->>UI: Display user detail view with healthcheck badge
```

### Password Reset Workflow

```mermaid
sequenceDiagram
    actor User
    participant UI as UserLookupPage (React)
    participant IPC as Tauri invoke()
    participant Cmd as Rust Command Handler
    participant Perm as permission module
    participant PwdGen as password module
    participant HIBP as HaveIBeenPwned
    participant Dir as DirectoryProvider
    participant Snap as snapshot module
    participant Audit as audit module

    User->>UI: Click "Reset Password"
    UI->>UI: Check permission context (HelpDesk+)
    UI->>UI: Show password reset dialog

    alt Auto-generate password
        UI->>IPC: invoke('generate_password', { criteria })
        IPC->>Cmd: generate_password command
        Cmd->>PwdGen: generate(criteria)
        PwdGen-->>Cmd: generated password
        Cmd->>HIBP: check_compromised(password)
        HIBP-->>Cmd: safe / compromised
        Cmd-->>UI: { password, is_compromised }
        alt Compromised
            UI->>UI: Show warning, regenerate
        end
    end

    User->>UI: Confirm reset
    UI->>IPC: invoke('reset_password', { user_dn, password, must_change })
    IPC->>Cmd: reset_password command
    Cmd->>Perm: has_permission(HelpDesk)
    Perm-->>Cmd: true
    Cmd->>Snap: capture(user_dn, "PasswordReset")
    Snap-->>Cmd: snapshot saved
    Cmd->>Dir: reset_password(user_dn, password, must_change)
    Dir-->>Cmd: Ok(())
    Cmd->>Audit: log(PasswordReset, user_dn, success)
    Cmd-->>UI: success
    UI->>UI: Show confirmation with copyable password
```

### Onboarding Wizard Workflow

```mermaid
sequenceDiagram
    actor User
    participant UI as OnboardingWizard (React)
    participant IPC as Tauri invoke()
    participant Cmd as Rust Command Handler
    participant Preset as preset module
    participant Dir as DirectoryProvider
    participant Audit as audit module

    User->>UI: Launch onboarding wizard
    UI->>IPC: invoke('get_presets')
    IPC->>Cmd: get_presets command
    Cmd->>Preset: get_presets()
    Preset-->>Cmd: Vec<Preset>
    Cmd-->>UI: JSON response

    User->>UI: Fill user details (name, login, etc.)
    User->>UI: Select preset
    UI->>IPC: invoke('preview_preset', { preset, target_user })
    IPC->>Cmd: preview_preset command
    Cmd->>Preset: preview_preset(preset, target_user)
    Preset-->>Cmd: PresetDiff (groups to add, OU, attributes)
    Cmd-->>UI: JSON response
    UI->>UI: Display dry-run preview

    User->>UI: Confirm execution
    UI->>IPC: invoke('apply_onboarding', { user_details, preset })
    IPC->>Cmd: apply_onboarding command
    Cmd->>Dir: create_user(user_details)
    Dir-->>Cmd: user created
    Cmd->>Preset: apply_preset(preset, new_user)
    Preset-->>Cmd: groups added, attributes set
    Cmd->>Audit: log(Onboarding, user_dn, details)
    Cmd-->>UI: { login, temp_password, groups }
    UI->>UI: Display formatted output
    UI->>UI: Copy to clipboard button
```

### Bulk Group Operation Workflow

```mermaid
sequenceDiagram
    actor User
    participant UI as GroupManagementPage (React)
    participant IPC as Tauri invoke()
    participant Cmd as Rust Command Handler
    participant Dir as DirectoryProvider
    participant Snap as snapshot module
    participant Audit as audit module

    User->>UI: Select source group(s) and target group(s)
    User->>UI: Select operation type (D/A/T)
    User->>UI: Select members to affect

    UI->>IPC: invoke('preview_bulk_group_op', { params })
    IPC->>Cmd: preview command
    Cmd-->>UI: diff preview (members to add/remove per group)
    UI->>UI: Display diff preview

    User->>UI: Confirm execution
    UI->>IPC: invoke('execute_bulk_group_op', { params })
    IPC->>Cmd: execute command
    loop For each affected member
        Cmd->>Snap: capture(member_dn, "BulkGroupOp")
        alt Add operation
            Cmd->>Dir: modify_group_membership(target_group, member, Add)
        else Delete operation
            Cmd->>Dir: modify_group_membership(source_group, member, Remove)
        else Transfer operation
            Cmd->>Dir: modify_group_membership(target_group, member, Add)
            Cmd->>Dir: modify_group_membership(source_group, member, Remove)
        end
        Cmd->>Audit: log(GroupMembershipChange, details)
    end
    Cmd-->>UI: completion summary
    UI->>UI: Show completion summary with rollback option
```

---
