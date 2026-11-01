import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const execute = promisify(execFile);
// Fixed local code, never interpolated with a path, credential, or request input.
// .NET avoids dependence on profile/module autoloading and execution-policy edits.
const protect = `
$ErrorActionPreference='Stop'
$p=$env:SECTOR7_CREDENTIAL_FILE
if(([System.IO.File]::GetAttributes($p) -band [System.IO.FileAttributes]::ReparsePoint) -ne 0){throw 'Linked credential refused'}
$me=[System.Security.Principal.WindowsIdentity]::GetCurrent().User
$allowed=@($me.Value,'S-1-5-18','S-1-5-32-544')
$acl=[System.Security.AccessControl.FileSecurity]::new()
$acl.SetAccessRuleProtection($true,$false)
foreach($sid in $allowed){
  $rule=[System.Security.AccessControl.FileSystemAccessRule]::new([System.Security.Principal.SecurityIdentifier]::new($sid),'FullControl','Allow')
  $acl.AddAccessRule($rule)
}
[System.IO.File]::SetAccessControl($p,$acl)
$actual=[System.IO.File]::GetAccessControl($p)
if(-not $actual.AreAccessRulesProtected){throw 'Credential inheritance remains enabled'}
$seen=@()
foreach($rule in $actual.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier])){
  if($rule.AccessControlType -eq 'Allow'){
    if($rule.IdentityReference.Value -notin $allowed){throw 'Unexpected credential reader'}
    $seen+=$rule.IdentityReference.Value
  }
}
foreach($sid in $allowed){if($sid -notin $seen){throw 'Required credential access missing'}}
`;

export async function protectCredentialFile(file) {
  if (process.platform !== 'win32') return;
  // Trusted OS component, not PATH resolution or a request-selected executable.
  const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  try {
    await execute(executable, ['-NoProfile', '-NonInteractive', '-Command', protect], {
      env: { SystemRoot: process.env.SystemRoot || 'C:\\Windows', SECTOR7_CREDENTIAL_FILE: file },
      windowsHide: true, timeout: 10000, maxBuffer: 16384
    });
  } catch {
    // Never echo child diagnostics, credential paths, or credential contents.
    throw new Error('Owner credential Windows permissions could not be secured');
  }
}
