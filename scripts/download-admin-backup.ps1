param(
  [string]$SiteUrl = "https://dieguemtechstore.com",
  [string]$OutputDir = ".\backups",
  [int]$AnalyticsDays = 365
)

$ErrorActionPreference = "Stop"

$normalizedSiteUrl = $SiteUrl.TrimEnd("/")
if (-not $normalizedSiteUrl.StartsWith("https://") -and -not $normalizedSiteUrl.StartsWith("http://")) {
  throw "SiteUrl doit commencer par http:// ou https://"
}

if (-not (Test-Path -LiteralPath $OutputDir)) {
  New-Item -ItemType Directory -Path $OutputDir | Out-Null
}

$securePassword = Read-Host "ADMIN_PASSWORD" -AsSecureString
$passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)

try {
  $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
  $loginBody = @{ password = $plainPassword } | ConvertTo-Json
  $login = Invoke-RestMethod `
    -Uri "$normalizedSiteUrl/api/admin/login" `
    -Method Post `
    -ContentType "application/json" `
    -Body $loginBody

  if (-not $login.token) {
    throw "Connexion admin impossible : token absent."
  }

  $stamp = Get-Date -Format "yyyy-MM-dd-HHmmss"
  $backupPath = Join-Path $OutputDir "dieguemtech-store-admin-backup-$stamp.json"
  Invoke-WebRequest `
    -Uri "$normalizedSiteUrl/api/admin/backup?analyticsDays=$AnalyticsDays" `
    -Headers @{ Authorization = "Bearer $($login.token)" } `
    -OutFile $backupPath `
    -UseBasicParsing

  $resolvedPath = (Resolve-Path -LiteralPath $backupPath).Path
  Write-Host "Sauvegarde admin telechargee : $resolvedPath" -ForegroundColor Green
  Write-Host "Important : gardez ce fichier hors GitHub, car il peut contenir commandes et donnees clients." -ForegroundColor Yellow
} finally {
  if ($passwordPointer -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
  }
  $plainPassword = $null
}
