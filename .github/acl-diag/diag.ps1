$ErrorActionPreference = 'Continue'
Add-Type -Namespace D -Name A -MemberDefinition @'
[DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
private static extern Microsoft.Win32.SafeHandles.SafeFileHandle CreateFileW(string p, uint a, uint s, IntPtr sec, uint d, uint f, IntPtr t);
public static string Open(string path, uint access) {
  using (var h = CreateFileW(path, access, 7, IntPtr.Zero, 3, 0x02200000, IntPtr.Zero)) {
    if (!h.IsInvalid) return "OK";
    return "ERR" + Marshal.GetLastWin32Error();
  }
}
'@
function Probe([string]$label, [string]$path) {
  $r = foreach ($m in @(@{n='READ_CONTROL';v=0x20000},@{n='WRITE_DAC';v=0x40000},@{n='WRITE_OWNER';v=0x80000},@{n='GENERIC_ALL';v=0x10000000})) { "$($m.n)=$([D.A]::Open($path, $m.v))" }
  "  $label : $($r -join ' ')"
}
function Sddl([string]$label, [string]$path) {
  try { "  $label SDDL: $((Get-Acl -LiteralPath $path).Sddl)" } catch { "  $label SDDL: <$($_.Exception.Message)>" }
}
$me = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
"TEMP SDDL: $((Get-Acl -LiteralPath $env:TEMP).Sddl)"
"USERPROFILE SDDL: $((Get-Acl -LiteralPath $env:USERPROFILE).Sddl)"
"LOCALAPPDATA SDDL: $((Get-Acl -LiteralPath $env:LOCALAPPDATA).Sddl)"
"Default owner probe: $((Get-Acl -LiteralPath (New-Item -ItemType Directory (Join-Path $env:TEMP ('own-' + [guid]::NewGuid().ToString('N').Substring(0,6)))).FullName).Owner)"

function Scratch([string]$mode) {
  $s = Join-Path $env:TEMP ('dsh-acl-v2-' + $mode + '-' + [guid]::NewGuid().ToString('N').Substring(0,6))
  New-Item -ItemType Directory $s | Out-Null
  switch ($mode) {
    'raw' { }
    'reset' { icacls $s /reset /Q | Out-Null }
    'owner' { icacls $s /reset /Q | Out-Null; icacls $s /setowner "*$me" /Q | Out-Null }
  }
  return $s
}

foreach ($mode in 'raw', 'reset', 'owner') {
  "=================== scratch mode: $mode"
  $s = Scratch $mode
  Sddl 'scratch' $s
  "--- grant fixture: /inheritance:r /grant:r me:(M)"
  $t = Join-Path $s 'target'; New-Item -ItemType Directory $t | Out-Null
  Sddl 'target-created' $t
  icacls $t /inheritance:r /grant:r "*${me}:(M)" /Q | Out-Null; "  icacls exit=$LASTEXITCODE"
  Sddl 'target' $t
  Probe 'target' $t
  "--- same with target owner set to me first"
  $t2 = Join-Path $s 'target-owned'; New-Item -ItemType Directory $t2 | Out-Null
  icacls $t2 /setowner "*$me" /Q | Out-Null; "  setowner exit=$LASTEXITCODE"
  icacls $t2 /inheritance:r /grant:r "*${me}:(M)" /Q | Out-Null; "  icacls exit=$LASTEXITCODE"
  Sddl 'target-owned' $t2
  Probe 'target-owned' $t2
  "--- subtree fixture"
  $ws = Join-Path $s 'workspace'; New-Item -ItemType Directory $ws | Out-Null
  icacls $ws /inheritance:r /grant:r '*S-1-5-11:(M)' /Q | Out-Null
  $deep = Join-Path $ws 'deep'; New-Item -ItemType Directory $deep | Out-Null
  $leaf = Join-Path $deep 'leaf'; New-Item -ItemType Directory $leaf | Out-Null
  Sddl 'ws' $ws; Sddl 'deep-created' $deep; Sddl 'leaf-created' $leaf
  icacls $deep /inheritance:r /grant:r '*S-1-15-2-1-2-3-4:(OI)(CI)(RX)' /Q | Out-Null; "  deep icacls exit=$LASTEXITCODE"
  Sddl 'deep' $deep
  Probe 'deep' $deep
  Probe 'leaf' $leaf
  icacls $leaf /inheritance:r /grant:r '*S-1-15-2-4-3-2-1:(OI)(CI)(RX)' /Q | Out-Null; "  leaf icacls exit=$LASTEXITCODE"
  Sddl 'leaf' $leaf
  takeown /f $s /r /d y | Out-Null
  icacls $s /reset /T /C /Q | Out-Null
  Remove-Item -Recurse -Force $s
}
