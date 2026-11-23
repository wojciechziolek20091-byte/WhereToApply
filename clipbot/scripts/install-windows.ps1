# clipbot installer for Windows. Run by "Install clipbot.cmd".
$ErrorActionPreference = "Stop"
$App = Split-Path -Parent $PSScriptRoot
Set-Location $App

function Find-Uv {
    $cmd = Get-Command uv -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    foreach ($p in @("$env:USERPROFILE\.local\bin\uv.exe", "$env:USERPROFILE\.cargo\bin\uv.exe")) {
        if (Test-Path $p) { return $p }
    }
    return $null
}

$uv = Find-Uv
if (-not $uv) {
    Write-Host "  Step 1 of 3: getting the installer tool (uv)..."
    Invoke-RestMethod https://astral.sh/uv/install.ps1 | Invoke-Expression
    $uv = Find-Uv
    if (-not $uv) { throw "The installer tool (uv) could not be installed." }
} else {
    Write-Host "  Step 1 of 3: installer tool found."
}

Write-Host "  Step 2 of 3: downloading clipbot's parts (around 1 GB, only the first time)..."
& $uv sync --frozen --no-dev
if ($LASTEXITCODE -ne 0) { throw "The download failed. Check the internet connection and run Install again." }

Write-Host "  Step 3 of 3: downloading the speech model..."
& $uv run --frozen --no-dev clipbot prepare
if ($LASTEXITCODE -ne 0) { throw "The speech model could not be downloaded. Run Install again." }

$desktop = [Environment]::GetFolderPath("Desktop")
$shell = New-Object -ComObject WScript.Shell
$link = $shell.CreateShortcut((Join-Path $desktop "clipbot.lnk"))
$link.TargetPath = Join-Path $App "Start clipbot.cmd"
$link.WorkingDirectory = $App
$link.IconLocation = (Join-Path $App "assets\clipbot.ico")
$link.Description = "Start clipbot"
$link.Save()

Write-Host ""
Write-Host "  Done! Double-click 'clipbot' on your desktop to start."
