$ErrorActionPreference = 'Continue'
"=== whoami /user /groups /priv"
whoami /user
whoami /groups /fo list | Select-String 'Group Name|Attributes|Mandatory' | ForEach-Object { $_.Line }
whoami /priv
"IsPrivilegedProcess=$([Environment]::IsPrivilegedProcess)"
"TEMP=$env:TEMP"
"icacls.exe version: $((Get-Item "$env:WINDIR\System32\icacls.exe").VersionInfo.FileVersion)"
"OS: $([Environment]::OSVersion.VersionString)"
Add-Type -Namespace D -Name A -MemberDefinition @'
[DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
private static extern Microsoft.Win32.SafeHandles.SafeFileHandle CreateFileW(string p, uint a, uint s, IntPtr sec, uint d, uint f, IntPtr t);
public static string Open(string path, uint access) {
  using (var h = CreateFileW(path, access, 7, IntPtr.Zero, 3, 0x02200000, IntPtr.Zero)) {
    if (!h.IsInvalid) return "OK";
    return "ERR" + Marshal.GetLastWin32Error();
  }
}
[StructLayout(LayoutKind.Sequential)] public struct LUID { public uint Low; public int High; }
[StructLayout(LayoutKind.Sequential)] public struct TP { public uint Count; public LUID Luid; public uint Attr; }
[DllImport("advapi32.dll", SetLastError = true)] static extern bool OpenProcessToken(IntPtr p, uint a, out IntPtr t);
[DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
[DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool LookupPrivilegeValueW(string s, string n, out LUID l);
[DllImport("advapi32.dll", SetLastError = true)] static extern bool AdjustTokenPrivileges(IntPtr t, bool all, ref TP n, uint l, IntPtr p, IntPtr r);
public static string Set(string name, bool enable) {
  IntPtr token; OpenProcessToken(GetCurrentProcess(), 0x28, out token);
  LUID luid; LookupPrivilegeValueW(null, name, out luid);
  var tp = new TP { Count = 1, Luid = luid, Attr = enable ? 2u : 0u };
  bool ok = AdjustTokenPrivileges(token, false, ref tp, 0, IntPtr.Zero, IntPtr.Zero);
  return name + (enable ? " enable=" : " disable=") + ok + "/" + Marshal.GetLastWin32Error();
}
'@
function Probe([string]$label, [string]$path) {
  foreach ($m in @(@{n='WRITE_DAC';v=0x40000},@{n='WRITE_OWNER';v=0x80000},@{n='GENERIC_ALL';v=0x10000000})) {
    "  $label $($m.n): $([D.A]::Open($path, $m.v))"
  }
}
$root = Join-Path $env:TEMP ('dsh-acl-diag-' + [guid]::NewGuid().ToString('N').Substring(0,8))
New-Item -ItemType Directory $root | Out-Null
$me = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
"=== fresh directory under TEMP"
$fresh = Join-Path $root 'fresh'; New-Item -ItemType Directory $fresh | Out-Null
icacls $env:TEMP
icacls $root
icacls $fresh
"fresh owner: $((Get-Acl $fresh).Owner)"
(Get-Acl $fresh).Sddl
"=== combined: icacls /inheritance:r /grant:r me:(M)"
$t = Join-Path $root 'combined'; New-Item -ItemType Directory $t | Out-Null
icacls $t /inheritance:r /grant:r "*${me}:(M)"
icacls $t
(Get-Acl $t).Sddl
Probe 'combined' $t
"=== split: /inheritance:r alone, then /grant:r"
$t2 = Join-Path $root 'split'; New-Item -ItemType Directory $t2 | Out-Null
icacls $t2 /inheritance:r
icacls $t2
icacls $t2 /grant:r "*${me}:(M)"
icacls $t2
Probe 'split' $t2
"=== subtree fixture"
$ws = Join-Path $root 'workspace'; New-Item -ItemType Directory $ws | Out-Null
icacls $ws /inheritance:r /grant:r '*S-1-5-11:(M)'
$deep = Join-Path $ws 'deep'; New-Item -ItemType Directory $deep | Out-Null
$leaf = Join-Path $deep 'leaf'; New-Item -ItemType Directory $leaf | Out-Null
"ws:"; (Get-Acl $ws).Sddl
"leaf before:"; (Get-Acl $leaf).Sddl
icacls $deep /inheritance:r /grant:r '*S-1-15-2-1-2-3-4:(OI)(CI)(RX)'
"exit=$LASTEXITCODE"
"leaf after deep change:"; try { $a = Get-Acl $leaf; $a.Owner; $a.Sddl } catch { "Get-Acl failed: $_" }
Probe 'leaf' $leaf
icacls $leaf /inheritance:r /grant:r '*S-1-15-2-4-3-2-1:(OI)(CI)(RX)'
"exit=$LASTEXITCODE"
"=== directory with Everyone deny DELETE_CHILD (CI)"
$g = Join-Path $root 'granted'; New-Item -ItemType Directory $g | Out-Null
$c = Join-Path $g 'child'; New-Item -ItemType Directory $c | Out-Null
icacls $g /deny '*S-1-1-0:(CI)(DC)'
icacls $c
Probe 'child' $c
"=== same probes with SeBackup/SeRestore/SeTakeOwnership disabled in this process"
foreach ($p in 'SeBackupPrivilege','SeRestorePrivilege','SeTakeOwnershipPrivilege') { [D.A]::Set($p, $false) }
whoami /priv | Select-String 'Backup|Restore|TakeOwnership' | ForEach-Object { $_.Line }
Probe 'combined' $t
Probe 'split' $t2
Probe 'leaf' $leaf
Probe 'child' $c
"=== cleanup"
foreach ($p in 'SeBackupPrivilege','SeRestorePrivilege','SeTakeOwnershipPrivilege') { [D.A]::Set($p, $true) }
takeown /f $root /r /d y | Out-Null
icacls $root /reset /T /C /Q | Out-Null
Remove-Item -Recurse -Force $root
