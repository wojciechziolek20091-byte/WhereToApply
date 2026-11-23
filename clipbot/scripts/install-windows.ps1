# clipbot installer for Windows. Run by "Install clipbot.cmd".
$ErrorActionPreference = "Stop"
$App = Split-Path -Parent $PSScriptRoot
Set-Location $App

# Double-clicking inside a zip runs from a temporary folder that Windows deletes.
if ($App -like "$env:TEMP*" -or $App -match "\.zip") {
    Write-Host ""
    Write-Host "  clipbot is still inside the zip file."
    Write-Host "  1. Close this window."
    Write-Host "  2. Right-click the clipbot zip file and choose 'Extract All', then 'Extract'."
    Write-Host "  3. In the folder that opens, double-click 'Install clipbot' again."
    exit 1
}

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
if ($LASTEXITCODE -ne 0) { throw "Preparing clipbot failed. The message above says why." }

# Shortcuts: on the desktop (OneDrive desktops included) and in the Start menu.
$shell = New-Object -ComObject WScript.Shell
$places = @(
    [Environment]::GetFolderPath("Desktop"),
    [Environment]::GetFolderPath("Programs")
)
foreach ($dir in $places) {
    if (-not $dir) { continue }
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $link = $shell.CreateShortcut((Join-Path $dir "clipbot.lnk"))
    $link.TargetPath = Join-Path $App "Start clipbot.cmd"
    $link.WorkingDirectory = $App
    $link.IconLocation = (Join-Path $App "assets\clipbot.ico")
    $link.Description = "Start clipbot"
    $link.Save()
}

Write-Host ""
Write-Host "  Done! clipbot is installed in:"
Write-Host "    $App"
Write-Host "  Start it any time from the 'clipbot' icon on your desktop,"
Write-Host "  or press the Windows key and type clipbot."
Write-Host ""
Write-Host "  Starting clipbot now. Your browser will open in a moment."
Start-Process -FilePath (Join-Path $App "Start clipbot.cmd") -WorkingDirectory $App
