// Temporary diagnostic for issue #31; never merged.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { it } from 'vitest'

import { AclWriteGrant, workspaceWriteSid } from '../src/index.ts'

function ps(command: string): string {
  const r = spawnSync('pwsh', ['-NoLogo', '-NonInteractive', '-NoProfile', '-Command', command], { encoding: 'utf8', timeout: 60_000 })
  return `${r.stdout}${r.stderr}`
}

const probe = (paths: Record<string, string>): string => `
$ErrorActionPreference='Continue'
Add-Type -Namespace P -Name F -MemberDefinition @'
[DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode, EntryPoint="CreateFileW")]
public static extern IntPtr CreateFileW(string n, uint a, uint s, IntPtr sa, uint d, uint f, IntPtr t);
[DllImport("kernel32.dll", SetLastError=true)]
public static extern bool CloseHandle(IntPtr h);
'@ | Out-Null
function TryOpen([string]$label, [string]$path, [uint32]$mask) {
  $h = [P.F]::CreateFileW($path, $mask, 7, [IntPtr]::Zero, 3, 0x02000000, [IntPtr]::Zero)
  if ($h -eq [IntPtr]::new(-1)) { "$($label) mask=0x$($mask.ToString('x')): DENIED $([Runtime.InteropServices.Marshal]::GetLastWin32Error())" } else { [void][P.F]::CloseHandle($h); "$($label) mask=0x$($mask.ToString('x')): OK" }
}
${Object.entries(paths).map(([label, path]) => `"${label} SDDL: $((Get-Acl -LiteralPath '${path}').Sddl)"
"${label} icacls:"; icacls '${path}'
foreach ($m in 0x10000000, 0x1f01ff, 0x40, 0x10000, 0x40000, 0x80000) { TryOpen '${label}' '${path}' $m }`).join('\n')}
`

it('diag: AclWriteGrant child directory under the ambient-delete deny', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'dsh-acl-zz-'))
  const granted = join(scratch, 'fullcontrol-root')
  const child = join(granted, 'child')
  mkdirSync(granted)
  mkdirSync(child)
  writeFileSync(join(granted, 'file.txt'), 'x')
  const grant = AclWriteGrant.create(workspaceWriteSid(granted))
  grant.add(granted, true)
  const later = join(granted, 'created-after-grant')
  mkdirSync(later)
  console.log(ps(`whoami /priv | Select-String 'Backup|Restore|TakeOwnership|Security'`))
  console.log(ps(probe({ granted, child, later })))
  grant.dispose()
}, 120_000)
