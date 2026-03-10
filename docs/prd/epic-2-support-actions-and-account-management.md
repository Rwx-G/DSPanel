# Epic 2: Support Actions and Account Management

**Goal**: Deliver the core helpdesk actions that L1/L2 technicians perform daily - password reset, account unlock, enable/disable - with proper permission enforcement, secure password generation, and optional MFA gating for sensitive operations.

### Story 2.1: Password Reset

As a HelpDesk technician,
I want to reset a user's password from the lookup view,
so that I can resolve "can't log in" tickets quickly.

#### Acceptance Criteria
1. "Reset Password" button is visible only to HelpDesk+ permission level
2. Password reset dialog offers: manual entry, auto-generate, and "must change at next logon" checkbox
3. Password is validated against complexity requirements before submission
4. Successful reset shows confirmation with the new password (copyable)
5. Failed reset shows clear error message (insufficient permissions, policy violation)
6. Action is logged to the internal audit log (who, when, target user)
7. Unit tests cover permission gating and password validation logic

### Story 2.2: Secure Password Generator

As a HelpDesk technician,
I want to generate secure passwords and check them against compromised databases,
so that reset passwords are strong and not previously breached.

#### Acceptance Criteria
1. Password generator is accessible from the reset dialog and as a standalone tool
2. Generator produces passwords matching configurable criteria (length, complexity, character sets)
3. Generated passwords are checked against HaveIBeenPwned API using k-anonymity (only first 5 chars of SHA1 sent)
4. Compromised passwords are flagged with a warning and user is prompted to regenerate
5. Generator works offline (skips HIBP check with a warning if API unreachable)
6. Unit tests cover generation logic, HIBP integration (mocked), and offline fallback

### Story 2.3: Account Unlock and Enable/Disable

As a HelpDesk technician,
I want to unlock, enable, or disable a user account from the lookup view,
so that I can resolve lockout and access tickets.

#### Acceptance Criteria
1. "Unlock" button appears only when account is locked out (HelpDesk+ permission)
2. "Enable/Disable" toggle appears for HelpDesk+ permission level
3. Each action shows a confirmation dialog before execution
4. Successful action updates the lookup view immediately (badge + status)
5. All actions are logged to the internal audit log
6. Unit tests cover permission gating and state transitions

### Story 2.4: Password Flag Management

As an AccountOperator,
I want to manage password policy flags on a user account,
so that I can configure special accounts (service accounts, etc.).

#### Acceptance Criteria
1. "Password Never Expires" and "User Cannot Change Password" checkboxes in user detail view
2. Visible only to AccountOperator+ permission level
3. Changes show a confirmation dialog with dry-run preview
4. Changes are logged to the internal audit log
5. Unit tests cover flag read/write logic

### Story 2.5: MFA Gate for Sensitive Actions

As a security-conscious admin,
I want sensitive actions (password reset, account deletion) to require MFA verification,
so that compromised DSPanel sessions cannot perform critical operations.

#### Acceptance Criteria
1. MFA gate is configurable (can be enabled/disabled per action type in settings)
2. MFA challenge is provider-agnostic: supports TOTP (authenticator app) as built-in method
3. MFA dialog appears before the action executes and blocks until verified
4. Failed MFA prevents the action and logs the attempt
5. MFA setup wizard for first-time configuration
6. Unit tests cover MFA flow (with mocked verification)

---
