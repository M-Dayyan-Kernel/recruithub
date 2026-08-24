# Start a Celery worker for one queue (or all queues for local dev).
# Usage:
#   .\scripts\run-celery-worker.ps1 resume
#   .\scripts\run-celery-worker.ps1 all
param(
    [Parameter(Position = 0)]
    [ValidateSet("celery", "resume", "shortlist", "screening", "interviews", "all")]
    [string]$Queue = "all"
)

$ErrorActionPreference = "Stop"
$BackendDir = Split-Path $PSScriptRoot -Parent
Set-Location $BackendDir

$venvActivate = Join-Path $BackendDir ".venv\Scripts\Activate.ps1"
if (Test-Path $venvActivate) {
    . $venvActivate
}

$App = "app.core.celery_app.celery_app"
$LogLevel = if ($env:CELERY_LOG_LEVEL) { $env:CELERY_LOG_LEVEL } else { "info" }

function Get-QueueConcurrency([string]$QueueName) {
    python -c "from app.core.config_loader import config; print(config.celery_queue_concurrency('$QueueName'))"
}

if ($Queue -eq "all") {
    $Queues = "celery,resume,shortlist,screening,interviews"
    $Concurrency = if ($env:CELERY_ALL_QUEUES_CONCURRENCY) { $env:CELERY_ALL_QUEUES_CONCURRENCY } else { "4" }
    $Pool = "solo"
    celery -A $App worker --loglevel=$LogLevel --pool=$Pool --queues=$Queues --concurrency=$Concurrency
} else {
    $Queues = $Queue
    $Concurrency = Get-QueueConcurrency $Queue
    celery -A $App worker --loglevel=$LogLevel --queues=$Queues --concurrency=$Concurrency
}
