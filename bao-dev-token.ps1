$ErrorActionPreference = "Stop"

$Gateway = "https://api.recruithub.webknot-dev.in"
$TokenPath = Join-Path $env:USERPROFILE ".recruithub\rh.token"
$TokenUser = "bao"

$Pass = $env:BAO_TOKEN_PASS
if (-not $Pass) {
    $secure = Read-Host "OpenBao gateway basic-auth password for user '$TokenUser'" -AsSecureString
    $Pass = [System.Net.NetworkCredential]::new("", $secure).Password
}
if (-not $Pass) {
    Write-Host "ERROR: no password provided (set BAO_TOKEN_PASS or enter it)" -ForegroundColor Red
    exit 1
}

Write-Host "Fetching app token from $Gateway/bao-token/rh.token ..." -ForegroundColor Cyan
$resp = curl.exe -s -o "$env:TEMP\rh.token.out" -w "%{http_code}" -u "$TokenUser`:$Pass" "$Gateway/bao-token/rh.token"
if ($resp -ne "200") {
    Write-Host "ERROR: token endpoint returned HTTP $resp" -ForegroundColor Red
    Write-Host "Your public IP must be in BAO_TOKEN_ALLOWED_IPS on the server (.env.production) and the password must match BAO_TOKEN_PASS."
    exit 1
}
$tok = (Get-Content "$env:TEMP\rh.token.out" -Raw).Trim()
if ($tok.Length -lt 24) {
    Write-Host "ERROR: unexpected response from token endpoint" -ForegroundColor Red
    exit 1
}

New-Item -ItemType Directory -Path (Split-Path $TokenPath) -Force | Out-Null
Set-Content -Path $TokenPath -Value $tok -NoNewline
Write-Host "Token saved to $TokenPath" -ForegroundColor Green

Write-Host ""
Write-Host "Add these to backend/.env so the backend fetches secrets from the hosted dev OpenBao:" -ForegroundColor Cyan
Write-Host "  BAO_ADDR=$Gateway"
Write-Host "  BAO_TOKEN_FILE=$TokenPath"
Write-Host "  BAO_KV_MOUNT=secret"
Write-Host "  BAO_KV_PATH=dev"
Write-Host "  BAO_REQUIRED=true"
Write-Host ""
Write-Host "Keep your public IP in BAO_TOKEN_ALLOWED_IPS on the server. Contact the repo owner to add/remove IPs."
