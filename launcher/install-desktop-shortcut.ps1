# Run once: creates a "Akhil Test" icon on the Desktop pointing at this clone.
$bat = Join-Path $PSScriptRoot 'Test-Studio.bat'
$desktop = [Environment]::GetFolderPath('Desktop')
$lnk = Join-Path $desktop 'Akhil Test.lnk'
$s = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk)
$s.TargetPath = $bat
$s.WorkingDirectory = Split-Path -Parent $PSScriptRoot
$s.IconLocation = (Join-Path $PSScriptRoot 'test-studio.ico')
$s.Description = 'Akhil Test - Augastam Test Studio'
$s.Save()
Write-Host "Created $lnk"
