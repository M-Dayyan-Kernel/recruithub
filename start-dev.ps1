# Start all local dev services for AI Recruitment POC
# Usage (from project root):  .\start-dev.ps1

$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
$ViteApiUrl = "http://localhost:8000"

function Write-Step($message) {
    Write-Host "`n==> $message" -ForegroundColor Cyan
}

function Test-PortListening([int]$Port) {
    return [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

function Stop-PortListeners([int]$Port) {
    $pids = @(
        Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
            Select-Object -ExpandProperty OwningProcess -Unique
    )
    foreach ($procId in $pids) {
        if ($procId -and $procId -ne 0) {
            Write-Host "  Stopping PID $procId (port $Port)" -ForegroundColor DarkYellow
            Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
        }
    }
}

function Stop-CeleryProcesses() {
    $processes = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object {
            $_.Name -match 'python(\.exe)?' -and
            $_.CommandLine -like '*celery*app.core.celery_app*'
        }
    foreach ($proc in $processes) {
        Write-Host "  Stopping Celery PID $($proc.ProcessId)" -ForegroundColor DarkYellow
        Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
    }
}

function Stop-InterviewAgents() {
    $agents = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object {
            $_.Name -match 'python(\.exe)?' -and
            $_.CommandLine -like '*interview_agent.py*'
        }
    foreach ($agent in $agents) {
        Write-Host "  Stopping interview agent PID $($agent.ProcessId)" -ForegroundColor DarkYellow
        Stop-Process -Id $agent.ProcessId -Force -ErrorAction SilentlyContinue
    }
}

function Start-ServiceWindow([string]$Title, [string]$Command) {
    $shell = if (Get-Command pwsh -ErrorAction SilentlyContinue) { "pwsh" } else { "powershell" }
    $fullCommand = "`$host.UI.RawUI.WindowTitle = '$Title'; $Command"
    Start-Process $shell -ArgumentList @("-NoExit", "-Command", $fullCommand) | Out-Null
}

Write-Host "AI Recruitment POC - starting local dev environment" -ForegroundColor Green
Write-Host "Project root: $Root"

# --- Prerequisites ---
$venvActivate = Join-Path $Root "backend\.venv\Scripts\Activate.ps1"
if (-not (Test-Path $venvActivate)) {
    Write-Host "ERROR: Python venv not found at backend\.venv" -ForegroundColor Red
    Write-Host "Run: cd backend; python -m venv .venv; .venv\Scripts\Activate.ps1; pip install -r requirements.txt"
    exit 1
}

foreach ($app in @("hr-app", "candidate-app")) {
    if (-not (Test-Path (Join-Path $Root "$app\node_modules"))) {
        Write-Host "ERROR: node_modules missing in $app" -ForegroundColor Red
        Write-Host "Run: cd $app; npm install"
        exit 1
    }
}

# --- Docker (Postgres + Redis) ---
Write-Step "Starting Docker infrastructure"
Push-Location $Root
try {
    $prevErrorAction = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    docker compose up -d *>$null
    $dockerExit = $LASTEXITCODE
    $ErrorActionPreference = $prevErrorAction
    if ($dockerExit -ne 0) {
        Write-Host "ERROR: docker compose failed. Is Docker Desktop running?" -ForegroundColor Red
        exit 1
    }

    Write-Host "Waiting for Postgres and Redis to become healthy..."
    Start-Sleep -Seconds 12
    docker compose ps
}
finally {
    Pop-Location
}

# --- Database migrations ---
Write-Step "Running database migrations"
Push-Location (Join-Path $Root "backend")
try {
    & .\.venv\Scripts\alembic.exe upgrade head
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
finally {
    Pop-Location
}

# --- Stop existing dev servers, then restart ---
Write-Step "Stopping existing dev servers (if any)"
Stop-PortListeners 8000
Stop-PortListeners 5173
Stop-PortListeners 5174
Stop-CeleryProcesses
Stop-InterviewAgents
Start-Sleep -Seconds 2

# --- Dev servers ---
$backendDir = Join-Path $Root "backend"
$hrAppDir = Join-Path $Root "hr-app"
$candidateAppDir = Join-Path $Root "candidate-app"

$apiCmd = "Set-Location '$backendDir'; . .\.venv\Scripts\Activate.ps1; python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000"
$celeryWorkerCmd = "Set-Location '$backendDir'; . .\.venv\Scripts\Activate.ps1; celery -A app.core.celery_app.celery_app worker --loglevel=info --pool=solo --queues=resume,shortlist,screening,interviews"
$celeryBeatCmd = "Set-Location '$backendDir'; . .\.venv\Scripts\Activate.ps1; celery -A app.core.celery_app.celery_app beat --loglevel=info"
$agentCmd = "Set-Location '$backendDir'; . .\.venv\Scripts\Activate.ps1; python interview_agent.py dev"
$hrCmd = "Set-Location '$hrAppDir'; `$env:VITE_API_URL='$ViteApiUrl'; npm run dev"
$candidateCmd = "Set-Location '$candidateAppDir'; `$env:VITE_API_URL='$ViteApiUrl'; npm run dev"

Write-Step "Starting API server (port 8000)"
Start-ServiceWindow "AI Recruitment - API" $apiCmd

Write-Step "Starting Celery worker (Windows: no --beat on worker)"
Start-ServiceWindow "AI Recruitment - Celery Worker" $celeryWorkerCmd

Write-Step "Starting Celery beat (dispatches scheduled screening calls)"
Start-ServiceWindow "AI Recruitment - Celery Beat" $celeryBeatCmd

Write-Step "Starting LiveKit AI interview agent"
Start-ServiceWindow "AI Recruitment - Interview Agent" $agentCmd

Write-Step "Starting HR app (port 5173)"
Start-ServiceWindow "AI Recruitment - HR App" $hrCmd

Write-Step "Starting Candidate app (port 5174)"
Start-ServiceWindow "AI Recruitment - Candidate App" $candidateCmd

Write-Host "`nAll services launched in separate terminal windows." -ForegroundColor Green
Write-Host ""
Write-Host "  HR App:         http://localhost:5173"
Write-Host "  Candidate App:  http://localhost:5174"
Write-Host "  API:            http://localhost:8000"
Write-Host "  API docs:       http://localhost:8000/docs"
Write-Host "  Celery worker:  separate terminal (must show 'celery@... ready')"
Write-Host "  Celery beat:    separate terminal (must show 'beat: Starting...')"
Write-Host "  Interview agent: must show 'registered worker' in its terminal"
Write-Host ""
Write-Host "Close each terminal window to stop that service."
