param(
  [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot),
  [string]$ShortcutName = ''
)

if (-not $ShortcutName) {
  $ShortcutName = 'Mineradio ' + [char]0x6E90 + [char]0x7801 + [char]0x7248 + '.lnk'
}

$resolvedProjectRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path
$electronPath = Join-Path $resolvedProjectRoot 'node_modules\electron\dist\electron.exe'
$sourceIconPath = Join-Path $resolvedProjectRoot 'build\icon.ico'
if (-not (Test-Path -LiteralPath $electronPath -PathType Leaf)) { throw "Electron executable not found: $electronPath" }
if (-not (Test-Path -LiteralPath $sourceIconPath -PathType Leaf)) { throw "Mineradio icon not found: $sourceIconPath" }

$localAppData = [Environment]::GetFolderPath('LocalApplicationData')
$desktop = [Environment]::GetFolderPath('Desktop')
$iconHash = (Get-FileHash -LiteralPath $sourceIconPath -Algorithm SHA256).Hash.Substring(0, 12)
$iconDirectory = Join-Path $localAppData 'Mineradio\ShortcutIcons'
$stableIconPath = Join-Path $iconDirectory "Mineradio-$iconHash.ico"
$shortcutPath = Join-Path $desktop $ShortcutName

New-Item -ItemType Directory -Path $iconDirectory -Force | Out-Null
Copy-Item -LiteralPath $sourceIconPath -Destination $stableIconPath -Force
if (Test-Path -LiteralPath $shortcutPath) { Remove-Item -LiteralPath $shortcutPath -Force }

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $electronPath
$shortcut.Arguments = '.'
$shortcut.WorkingDirectory = $resolvedProjectRoot
$shortcut.IconLocation = "$stableIconPath,0"
$shortcut.Description = 'Launch Mineradio from source'
$shortcut.Save()

$iconRefresh = Join-Path $env:SystemRoot 'System32\ie4uinit.exe'
if (Test-Path -LiteralPath $iconRefresh -PathType Leaf) { & $iconRefresh -show }

[PSCustomObject]@{
  ShortcutPath = $shortcutPath
  TargetPath = $electronPath
  WorkingDirectory = $resolvedProjectRoot
  IconLocation = "$stableIconPath,0"
}
