# populate-ad-epic7.ps1
# Companion script to BadBlood - populates AD with contacts, printers,
# and enables the Recycle Bin for testing Epic 7 features in DSPanel.
#
# Run ON THE AD VM (DC) as Domain Admin in an elevated PowerShell prompt.
# Requires: ActiveDirectory PowerShell module (RSAT)
#
# Usage:
#   Set-ExecutionPolicy Bypass -Scope Process -Force
#   .\populate-ad-epic7.ps1
#
# Idempotent: safe to run multiple times (skips existing objects).

Import-Module ActiveDirectory -ErrorAction Stop

$domain = "DC=dspanel,DC=local"
$contactsOU = "OU=Contacts,$domain"
$printersOU = "OU=Printers,$domain"

# ============================================================
# 1. Enable AD Recycle Bin
# ============================================================
Write-Host "`n=== Enabling AD Recycle Bin ===" -ForegroundColor Cyan

$forestMode = (Get-ADForest).ForestMode
if ($forestMode -lt "Windows2008R2Forest") {
    Write-Warning "Forest functional level ($forestMode) too low for Recycle Bin. Skipping."
} else {
    try {
        $optionalFeature = Get-ADOptionalFeature -Filter 'Name -like "Recycle Bin Feature"'
        if ($optionalFeature.EnabledScopes.Count -gt 0) {
            Write-Host "Recycle Bin is already enabled." -ForegroundColor Green
        } else {
            Enable-ADOptionalFeature -Identity 'Recycle Bin Feature' `
                -Scope ForestOrConfigurationSet `
                -Target (Get-ADForest).Name `
                -Confirm:$false
            Write-Host "Recycle Bin enabled successfully!" -ForegroundColor Green
        }
    } catch {
        Write-Warning "Failed to enable Recycle Bin: $_"
    }
}

# ============================================================
# 2. Create OUs
# ============================================================
Write-Host "`n=== Creating OUs ===" -ForegroundColor Cyan

foreach ($ou in @($contactsOU, $printersOU)) {
    $ouName = ($ou -split ",")[0] -replace "OU=",""
    if (-not (Get-ADOrganizationalUnit -Filter "DistinguishedName -eq '$ou'" -ErrorAction SilentlyContinue)) {
        New-ADOrganizationalUnit -Name $ouName -Path $domain -ProtectedFromAccidentalDeletion $false
        Write-Host "  Created OU: $ou" -ForegroundColor Green
    } else {
        Write-Host "  OU already exists: $ou"
    }
}

# ============================================================
# 3. Create ~100 contacts
# ============================================================
Write-Host "`n=== Creating contacts ===" -ForegroundColor Cyan

$firstNames = @(
    "Alice","Bob","Charlie","Diana","Eve","Frank","Grace","Henry","Iris","Jack",
    "Kate","Leo","Maya","Noah","Olivia","Paul","Quinn","Rachel","Sam","Tina",
    "Uma","Victor","Wendy","Xavier","Yuki","Zara","Aaron","Beth","Carl","Dana",
    "Ella","Felix","Gina","Hugo","Ivy","Joel","Kira","Liam","Mona","Nate",
    "Opal","Pete","Ruby","Sean","Tara","Ugo","Vera","Will","Xena","Yves"
)
$lastNames = @(
    "Martin","Dubois","Bernard","Petit","Durand","Leroy","Moreau","Simon","Laurent",
    "Garcia","Thomas","Robert","Richard","Blanc","Faure","Mercier","Bonnet","Dupuis",
    "Lambert","Fontaine"
)
$companies = @("Contoso","Fabrikam","Northwind","Tailspin","WingTip","Fourth Coffee","Litware","Proseware")
$departments = @("Engineering","Sales","Marketing","Finance","HR","Legal","Support","Operations")
$cities = @("Paris","Lyon","Marseille","Toulouse","Nice","Bordeaux","Nantes","Strasbourg","Lille","Rennes")

$contactOk = 0; $contactSkip = 0
$contactCount = 0

foreach ($first in $firstNames) {
    $last = $lastNames[$contactCount % $lastNames.Count]
    $company = $companies[$contactCount % $companies.Count]
    $dept = $departments[$contactCount % $departments.Count]
    $city = $cities[$contactCount % $cities.Count]
    $cn = "$first $last"
    $email = "$($first.ToLower()).$($last.ToLower())@external-$($company.ToLower()).com"
    $dn = "CN=$cn,$contactsOU"

    if (Get-ADObject -Filter "DistinguishedName -eq '$dn'" -ErrorAction SilentlyContinue) {
        $contactSkip++; $contactCount++; continue
    }

    New-ADObject -Type contact -Name $cn -Path $contactsOU -OtherAttributes @{
        givenName       = $first
        sn              = $last
        displayName     = $cn
        mail            = $email
        telephoneNumber = "+33 1 $(Get-Random -Min 10 -Max 99) $(Get-Random -Min 10 -Max 99) $(Get-Random -Min 10 -Max 99) $(Get-Random -Min 10 -Max 99)"
        mobile          = "+33 6 $(Get-Random -Min 10 -Max 99) $(Get-Random -Min 10 -Max 99) $(Get-Random -Min 10 -Max 99) $(Get-Random -Min 10 -Max 99)"
        company         = $company
        department      = $dept
        l               = $city
        description     = "External contact from $company - $dept"
    }
    $contactOk++; $contactCount++
    if ($contactCount -ge 100) { break }
}

# Fill to 100 with "Jr" suffix variants
while ($contactCount -lt 100) {
    $idx = $contactCount
    $first = $firstNames[$idx % $firstNames.Count]
    $last = $lastNames[($idx + 7) % $lastNames.Count]
    $cn = "$first $last Jr"
    $dn = "CN=$cn,$contactsOU"

    if (Get-ADObject -Filter "DistinguishedName -eq '$dn'" -ErrorAction SilentlyContinue) {
        $contactSkip++; $contactCount++; continue
    }

    New-ADObject -Type contact -Name $cn -Path $contactsOU -OtherAttributes @{
        givenName   = $first
        sn          = "$last Jr"
        displayName = $cn
        mail        = "$($first.ToLower()).$($last.ToLower()).jr@external-contoso.com"
        company     = $companies[$idx % $companies.Count]
        department  = $departments[$idx % $departments.Count]
        description = "External contact"
    }
    $contactOk++; $contactCount++
}

Write-Host "  Contacts: $contactOk created, $contactSkip skipped" -ForegroundColor Green

# ============================================================
# 4. Create 20 printers
# ============================================================
Write-Host "`n=== Creating printers ===" -ForegroundColor Cyan

$printerDefs = @(
    @{ Name="HP-LaserJet-4250-Floor1";   Location="Building A - Floor 1";     Server="PRINT01"; Driver="HP Universal" },
    @{ Name="HP-LaserJet-4250-Floor2";   Location="Building A - Floor 2";     Server="PRINT01"; Driver="HP Universal" },
    @{ Name="HP-LaserJet-4250-Floor3";   Location="Building A - Floor 3";     Server="PRINT01"; Driver="HP Universal" },
    @{ Name="Canon-iR-C3520i-Reception"; Location="Building A - Reception";   Server="PRINT01"; Driver="Canon Generic Plus" },
    @{ Name="Xerox-WC7845-Marketing";    Location="Building B - Marketing";   Server="PRINT02"; Driver="Xerox Global" },
    @{ Name="Xerox-WC7845-Sales";        Location="Building B - Sales";       Server="PRINT02"; Driver="Xerox Global" },
    @{ Name="Xerox-WC7845-Finance";      Location="Building B - Finance";     Server="PRINT02"; Driver="Xerox Global" },
    @{ Name="Brother-HL-L6400-IT";       Location="Building C - IT Lab";      Server="PRINT02"; Driver="Brother Universal" },
    @{ Name="Brother-HL-L6400-Support";  Location="Building C - Support";     Server="PRINT02"; Driver="Brother Universal" },
    @{ Name="HP-DesignJet-T1700-Eng";    Location="Building C - Engineering"; Server="PRINT03"; Driver="HP DesignJet" },
    @{ Name="Ricoh-MP-C3004-Legal";      Location="Building A - Legal";       Server="PRINT01"; Driver="Ricoh Universal" },
    @{ Name="Ricoh-MP-C3004-HR";         Location="Building A - HR";          Server="PRINT01"; Driver="Ricoh Universal" },
    @{ Name="Kyocera-M6235-Exec";        Location="Building A - Executive";   Server="PRINT03"; Driver="Kyocera Classic" },
    @{ Name="HP-LaserJet-M607-Warehouse";Location="Warehouse";                Server="PRINT03"; Driver="HP Universal" },
    @{ Name="Epson-WF-C5790-Mailroom";   Location="Mailroom";                 Server="PRINT03"; Driver="Epson Universal" },
    @{ Name="Canon-iR-ADV-C5560-Floor4"; Location="Building A - Floor 4";     Server="PRINT01"; Driver="Canon Generic Plus" },
    @{ Name="Lexmark-MS826-Lobby";       Location="Main Lobby";               Server="PRINT02"; Driver="Lexmark Universal" },
    @{ Name="Samsung-SL-M4080-Training"; Location="Training Room";            Server="PRINT02"; Driver="Samsung Universal" },
    @{ Name="HP-Color-LJ-M553-Design";   Location="Building C - Design";      Server="PRINT03"; Driver="HP Universal" },
    @{ Name="Zebra-ZT411-Shipping";      Location="Shipping Dock";            Server="PRINT03"; Driver="Zebra ZPL" }
)

$printerOk = 0; $printerSkip = 0; $printerFail = 0
$portIdx = 0
foreach ($p in $printerDefs) {
    $cn = $p.Name
    $dn = "CN=$cn,$printersOU"

    if (Get-ADObject -Filter "DistinguishedName -eq '$dn'" -ErrorAction SilentlyContinue) {
        $printerSkip++; continue
    }

    try {
        New-ADObject -Type printQueue -Name $cn -Path $printersOU -OtherAttributes @{
            printerName     = $cn
            location        = $p.Location
            serverName      = $p.Server
            shortServerName = $p.Server
            uNCName         = "\\$($p.Server)\$cn"
            driverName      = $p.Driver
            portName        = "IP_10.0.$portIdx.1"
            description     = "$($p.Driver) printer in $($p.Location)"
            versionNumber   = [int]4
        }
        $printerOk++; $portIdx++
    } catch {
        Write-Host "  FAIL: $cn - $_" -ForegroundColor Red
        $printerFail++
    }
}

Write-Host "  Printers: $printerOk created, $printerSkip skipped, $printerFail failed" -ForegroundColor Green

# ============================================================
# Summary
# ============================================================
Write-Host "`n=== Summary ===" -ForegroundColor Cyan
Write-Host "  Contacts:    $contactOk created, $contactSkip skipped (target: 100)"
Write-Host "  Printers:    $printerOk created, $printerSkip skipped, $printerFail failed (target: 20)"
$rb = (Get-ADOptionalFeature -Filter 'Name -like "Recycle Bin Feature"').EnabledScopes.Count -gt 0
Write-Host "  Recycle Bin: $(if ($rb) { 'Enabled' } else { 'Not enabled' })"
Write-Host "`nDone! You can now test Epic 7 features in DSPanel." -ForegroundColor Green
