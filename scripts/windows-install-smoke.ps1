# Installs only into an ephemeral hosted Actions runner. Never run on the user's PC.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') {
    throw 'Installation acceptance is restricted to a fresh GitHub-hosted Windows runner.'
}
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskDesktop = Join-Path $taskRoot 'apps/desktop'
$taskInstall = [IO.Path]::GetFullPath((Join-Path $taskRoot '.tools/installed-ycore'))
if (-not $taskInstall.StartsWith($taskRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid installation target' }
if ((Get-Process -Name YCoreMusic -ErrorAction SilentlyContinue) -or (Test-Path -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\YCore Music')) {
    throw 'Refusing to touch an existing application installation or process.'
}
$taskConfig = Join-Path $taskDesktop 'src-tauri/tauri.conf.json'
$taskVersion = (Get-Content -LiteralPath $taskConfig -Raw | ConvertFrom-Json).version
if ($taskVersion -notmatch '^(\d+)\.(\d+)\.(\d+)$') { throw 'Expected a stable development version' }
$taskNext = "$($Matches[1]).$($Matches[2]).$([int]$Matches[3]+1)"
$taskMarker = [Guid]::NewGuid().ToString()
$taskData = Join-Path $taskRoot '.tools/installation-data'
$taskSentinelRoot = Join-Path $env:LOCALAPPDATA 'io.encore.desktop'
$taskSentinel = Join-Path $taskSentinelRoot 'installation-preservation.txt'
if (Test-Path -LiteralPath $taskSentinelRoot) { throw 'Refusing to seed an existing app-data directory.' }
New-Item -ItemType Directory -Force -Path (Join-Path $taskRoot '.tools') | Out-Null
function Build-Package {
    Push-Location $taskDesktop
    try {
        npx tauri build --debug --config src-tauri/tauri.bundle.conf.json --bundles nsis
        if ($LASTEXITCODE -ne 0) { throw 'NSIS package build failed' }
    } finally { Pop-Location }
}
function Run-Installer([string]$File, [string[]]$Arguments) {
    $taskProcess = Start-Process -FilePath $File -ArgumentList $Arguments -PassThru -WindowStyle Hidden
    if (-not $taskProcess.WaitForExit(180000)) { $taskProcess.Kill(); throw 'Owned test installer timed out' }
    $taskProcess.Refresh()
    if ($taskProcess.ExitCode -ne 0) { throw "Installer failed: $($taskProcess.ExitCode)" }
}
function Assert-File([string]$Path) { if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Expected file missing: $Path" } }
function Assert-Sentinel { Assert-File $taskSentinel; if ((Get-Content -LiteralPath $taskSentinel -Raw) -ne $taskMarker) { throw 'Application data was changed by installer' } }
function Native-Installed([bool]$Expect) {
    $env:ENCORE_NATIVE_APP = Join-Path $taskInstall 'YCoreMusic.exe'
    $env:ENCORE_NATIVE_TEST_DATA_DIR = $taskData
    $env:ENCORE_UPDATES_SIGNATURE_SMOKE = '1'
    $env:ENCORE_SAVE_INSTALLATION_SENTINEL = $taskMarker
    if ($Expect) {
        $env:ENCORE_EXPECT_INSTALLATION_SENTINEL = $taskMarker
    } else { Remove-Item Env:ENCORE_EXPECT_INSTALLATION_SENTINEL -ErrorAction SilentlyContinue }
    Push-Location $taskRoot
    try { node scripts/native-smoke.mjs; if ($LASTEXITCODE -ne 0) { throw 'Installed native application check failed' } }
    finally { Pop-Location }
}
Build-Package
$taskFirst = Join-Path $taskDesktop "src-tauri/target/debug/bundle/nsis/YCore Music_$($taskVersion)_x64-setup.exe"
Assert-File $taskFirst
Run-Installer $taskFirst @('/S', "/D=$taskInstall")
Assert-File (Join-Path $taskInstall 'YCoreMusic.exe')
New-Item -ItemType Directory -Force -Path $taskSentinelRoot | Out-Null
[IO.File]::WriteAllText($taskSentinel, $taskMarker)

# Use the matching official driver for the installed WebView2 runtime.
$taskRuntimeRoots = @((Join-Path ${env:ProgramFiles(x86)} 'Microsoft/EdgeWebView/Application'),(Join-Path $env:LOCALAPPDATA 'Microsoft/EdgeWebView/Application'))
$taskRuntime = $taskRuntimeRoots | Where-Object {Test-Path -LiteralPath $_} | ForEach-Object {Get-ChildItem -LiteralPath $_ -Directory} | Where-Object Name -Match '^\d+\.\d+\.\d+\.\d+$' | Sort-Object { [Version]$_.Name } -Descending | Select-Object -First 1
if (-not $taskRuntime) { throw 'WebView2 runtime was not installed' }
$taskMajor = ([Version]$taskRuntime.Name).Major
$taskDriverVersionFile = Join-Path $taskRoot '.tools/edgedriver-version.txt'
Invoke-WebRequest "https://msedgedriver.microsoft.com/LATEST_RELEASE_$($taskMajor)_WINDOWS" -OutFile $taskDriverVersionFile
$taskDriverVersionBytes = [IO.File]::ReadAllBytes($taskDriverVersionFile)
$taskDriverVersion = if ($taskDriverVersionBytes.Length -ge 2 -and $taskDriverVersionBytes[0] -eq 255 -and $taskDriverVersionBytes[1] -eq 254) { [Text.Encoding]::Unicode.GetString($taskDriverVersionBytes).Trim([char]0xFEFF,[char]13,[char]10,[char]32) } else { [Text.Encoding]::UTF8.GetString($taskDriverVersionBytes).Trim([char]0xFEFF,[char]13,[char]10,[char]32) }
if ($taskDriverVersion -notmatch '^\d+\.\d+\.\d+\.\d+$') { throw 'Invalid official driver version' }
$taskDriverDirectory = Join-Path $taskRoot '.tools/edgedriver'
$taskDriverArchive = Join-Path $taskRoot '.tools/edgedriver.zip'
Invoke-WebRequest "https://msedgedriver.microsoft.com/$taskDriverVersion/edgedriver_win64.zip" -OutFile $taskDriverArchive
Expand-Archive -LiteralPath $taskDriverArchive -DestinationPath $taskDriverDirectory
$taskDriverSignature = Get-AuthenticodeSignature -LiteralPath (Join-Path $taskDriverDirectory 'msedgedriver.exe')
if ($taskDriverSignature.Status -ne 'Valid' -or $taskDriverSignature.SignerCertificate.Subject -notlike '*Microsoft Corporation*') { throw 'Official driver signature verification failed' }
Native-Installed $false

# Only this ephemeral checkout is version-bumped; nothing is committed or published.
$taskJson = Get-Content -LiteralPath $taskConfig -Raw | ConvertFrom-Json
$taskJson.version = $taskNext
[IO.File]::WriteAllText($taskConfig, ($taskJson | ConvertTo-Json -Depth 20 -Compress))
$taskCargo = Join-Path $taskDesktop 'src-tauri/Cargo.toml'
$taskCargoText = Get-Content -LiteralPath $taskCargo -Raw
$taskVersionPattern = [regex]::new('(?m)^version = "' + [regex]::Escape($taskVersion) + '"\r?$')
if (-not $taskVersionPattern.IsMatch($taskCargoText)) { throw 'Cargo application version not found' }
[IO.File]::WriteAllText($taskCargo, $taskVersionPattern.Replace($taskCargoText, "version = `"$taskNext`"", 1))
Build-Package
$taskSecond = Join-Path $taskDesktop "src-tauri/target/debug/bundle/nsis/YCore Music_$($taskNext)_x64-setup.exe"
Assert-File $taskSecond
Run-Installer $taskSecond @('/S', '/UPDATE', "/D=$taskInstall")
Assert-Sentinel
$taskInstalledHash = (Get-FileHash -LiteralPath (Join-Path $taskInstall 'YCoreMusic.exe')).Hash
$taskBuiltHash = (Get-FileHash -LiteralPath (Join-Path $taskDesktop 'src-tauri/target/debug/YCoreMusic.exe')).Hash
if ($taskInstalledHash -ne $taskBuiltHash) { throw 'Upgrade did not replace the executable' }
Native-Installed $true
Run-Installer (Join-Path $taskInstall 'uninstall.exe') @('/S')
for ($taskAttempt = 0; $taskAttempt -lt 30 -and (Test-Path -LiteralPath (Join-Path $taskInstall 'YCoreMusic.exe')); $taskAttempt++) { Start-Sleep -Milliseconds 200 }
if (Test-Path -LiteralPath (Join-Path $taskInstall 'YCoreMusic.exe')) { throw 'Uninstall did not remove the application' }
Assert-Sentinel
Run-Installer $taskSecond @('/S', "/D=$taskInstall")
Assert-Sentinel
Native-Installed $true
$taskResult = @{ installedVersion=$taskVersion; upgradedVersion=$taskNext; upgradeReplacedExecutable=$true; uiPreferencesAndHistoryPreserved=$true; uninstallKeptData=$true; reinstallPassed=$true; hostedRunnerOnly=$true }
$taskResult | ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $taskRoot '.tools/windows-installation-result.json')
Write-Output 'Hosted Windows clean install, upgrade, preferences/history preservation, uninstall and reinstall: PASS'
