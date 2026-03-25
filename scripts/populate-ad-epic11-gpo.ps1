# populate-ad-epic11-gpo.ps1
# Creates test GPOs and links them to OUs for testing the GPO Viewer
# feature in DSPanel (Epic 11, Story 11.3).
#
# Run ON THE AD VM (DC) as Domain Admin in an elevated PowerShell prompt.
# Requires: GroupPolicy + ActiveDirectory PowerShell modules (RSAT)
#
# Usage:
#   Set-ExecutionPolicy Bypass -Scope Process -Force
#   .\populate-ad-epic11-gpo.ps1
#
# Idempotent: safe to run multiple times (skips existing objects).
# Cleanup: run with -Cleanup switch to remove all test objects.

param(
    [switch]$Cleanup
)

Import-Module ActiveDirectory -ErrorAction Stop
Import-Module GroupPolicy -ErrorAction Stop

$domain = "DC=dspanel,DC=local"
$testOUs = @(
    "OU=TestUsers,$domain",
    "OU=TestComputers,$domain",
    "OU=TestServers,$domain"
)
$testGPOs = @(
    @{ Name = "DSPanel-Test-PasswordPolicy";    Comment = "Test GPO: password policy settings" },
    @{ Name = "DSPanel-Test-DesktopSettings";   Comment = "Test GPO: desktop restrictions" },
    @{ Name = "DSPanel-Test-SecurityBaseline";  Comment = "Test GPO: security baseline (enforced)" }
)

# ============================================================
# Cleanup mode
# ============================================================
if ($Cleanup) {
    Write-Host "`n=== Cleanup: removing test GPOs and OUs ===" -ForegroundColor Yellow

    foreach ($gpo in $testGPOs) {
        $existing = Get-GPO -Name $gpo.Name -ErrorAction SilentlyContinue
        if ($existing) {
            # Remove all links first
            Get-ADOrganizationalUnit -Filter * -SearchBase $domain -ErrorAction SilentlyContinue |
                ForEach-Object {
                    Remove-GPLink -Name $gpo.Name -Target $_.DistinguishedName -ErrorAction SilentlyContinue
                }
            Remove-GPLink -Name $gpo.Name -Target $domain -ErrorAction SilentlyContinue
            Remove-GPO -Name $gpo.Name -Confirm:$false
            Write-Host "  Removed GPO: $($gpo.Name)" -ForegroundColor Red
        }
    }

    foreach ($ou in $testOUs) {
        if (Get-ADOrganizationalUnit -Filter "DistinguishedName -eq '$ou'" -ErrorAction SilentlyContinue) {
            # Remove child objects first
            Get-ADObject -SearchBase $ou -Filter * -SearchScope OneLevel -ErrorAction SilentlyContinue |
                Remove-ADObject -Recursive -Confirm:$false -ErrorAction SilentlyContinue
            Remove-ADOrganizationalUnit -Identity $ou -Recursive -Confirm:$false
            Write-Host "  Removed OU: $ou" -ForegroundColor Red
        }
    }

    Write-Host "`nCleanup complete." -ForegroundColor Green
    return
}

# ============================================================
# 1. Create test OUs
# ============================================================
Write-Host "`n=== Creating test OUs ===" -ForegroundColor Cyan

foreach ($ou in $testOUs) {
    $ouName = ($ou -split ",")[0] -replace "OU=", ""
    if (Get-ADOrganizationalUnit -Filter "DistinguishedName -eq '$ou'" -ErrorAction SilentlyContinue) {
        Write-Host "  OU already exists: $ouName" -ForegroundColor DarkGray
    } else {
        New-ADOrganizationalUnit -Name $ouName -Path $domain -ProtectedFromAccidentalDeletion $false
        Write-Host "  Created OU: $ouName" -ForegroundColor Green
    }
}

# ============================================================
# 2. Create test GPOs
# ============================================================
Write-Host "`n=== Creating test GPOs ===" -ForegroundColor Cyan

foreach ($gpo in $testGPOs) {
    $existing = Get-GPO -Name $gpo.Name -ErrorAction SilentlyContinue
    if ($existing) {
        Write-Host "  GPO already exists: $($gpo.Name) (ID: $($existing.Id))" -ForegroundColor DarkGray
    } else {
        $newGpo = New-GPO -Name $gpo.Name -Comment $gpo.Comment
        Write-Host "  Created GPO: $($gpo.Name) (ID: $($newGpo.Id))" -ForegroundColor Green
    }
}

# ============================================================
# 3. Link GPOs to targets
# ============================================================
Write-Host "`n=== Linking GPOs ===" -ForegroundColor Cyan

# PasswordPolicy -> domain root
try {
    New-GPLink -Name "DSPanel-Test-PasswordPolicy" -Target $domain -ErrorAction Stop
    Write-Host "  Linked PasswordPolicy -> $domain" -ForegroundColor Green
} catch {
    if ($_.Exception.Message -like "*already linked*") {
        Write-Host "  Already linked: PasswordPolicy -> $domain" -ForegroundColor DarkGray
    } else { Write-Warning "  Failed to link PasswordPolicy: $_" }
}

# DesktopSettings -> TestUsers + TestComputers
foreach ($target in @("OU=TestUsers,$domain", "OU=TestComputers,$domain")) {
    try {
        New-GPLink -Name "DSPanel-Test-DesktopSettings" -Target $target -ErrorAction Stop
        Write-Host "  Linked DesktopSettings -> $target" -ForegroundColor Green
    } catch {
        if ($_.Exception.Message -like "*already linked*") {
            Write-Host "  Already linked: DesktopSettings -> $target" -ForegroundColor DarkGray
        } else { Write-Warning "  Failed to link DesktopSettings: $_" }
    }
}

# SecurityBaseline -> TestUsers (enforced) + TestServers
try {
    New-GPLink -Name "DSPanel-Test-SecurityBaseline" -Target "OU=TestUsers,$domain" -Enforced Yes -ErrorAction Stop
    Write-Host "  Linked SecurityBaseline -> TestUsers (ENFORCED)" -ForegroundColor Green
} catch {
    if ($_.Exception.Message -like "*already linked*") {
        Write-Host "  Already linked: SecurityBaseline -> TestUsers" -ForegroundColor DarkGray
    } else { Write-Warning "  Failed to link SecurityBaseline: $_" }
}

try {
    New-GPLink -Name "DSPanel-Test-SecurityBaseline" -Target "OU=TestServers,$domain" -ErrorAction Stop
    Write-Host "  Linked SecurityBaseline -> TestServers" -ForegroundColor Green
} catch {
    if ($_.Exception.Message -like "*already linked*") {
        Write-Host "  Already linked: SecurityBaseline -> TestServers" -ForegroundColor DarkGray
    } else { Write-Warning "  Failed to link SecurityBaseline: $_" }
}

# ============================================================
# 4. Create a test user in TestUsers OU (for GPO Links testing)
# ============================================================
Write-Host "`n=== Creating test user ===" -ForegroundColor Cyan

$testUserDn = "CN=GPO TestUser,OU=TestUsers,$domain"
if (Get-ADUser -Filter "DistinguishedName -eq '$testUserDn'" -ErrorAction SilentlyContinue) {
    Write-Host "  User already exists: GPO TestUser" -ForegroundColor DarkGray
} else {
    New-ADUser -Name "GPO TestUser" `
        -SamAccountName "gpo.testuser" `
        -UserPrincipalName "gpo.testuser@dspanel.local" `
        -Path "OU=TestUsers,$domain" `
        -AccountPassword (ConvertTo-SecureString "P@ssw0rd123!" -AsPlainText -Force) `
        -Enabled $true
    Write-Host "  Created user: GPO TestUser (gpo.testuser)" -ForegroundColor Green
}

# ============================================================
# 5. Summary
# ============================================================
Write-Host "`n=== Summary ===" -ForegroundColor Cyan
Write-Host "GPOs created:" -ForegroundColor White
Get-GPO -All | Where-Object { $_.DisplayName -like "DSPanel-Test-*" } |
    Format-Table DisplayName, Id, GpoStatus -AutoSize

Write-Host "GPO inheritance for TestUsers:" -ForegroundColor White
Get-GPInheritance -Target "OU=TestUsers,$domain" | Select-Object -ExpandProperty GpoLinks |
    Format-Table DisplayName, Enabled, Enforced, Order -AutoSize

Write-Host "`nTest in DSPanel:" -ForegroundColor Yellow
Write-Host "  GPO Links:  enter 'CN=GPO TestUser,OU=TestUsers,$domain'"
Write-Host "  Scope:      select any DSPanel-Test-* GPO from dropdown"
Write-Host "  What-If:    enter 'OU=TestServers,$domain'"
Write-Host ""
