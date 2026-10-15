param([string]$NodePath = '')
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$workspaceRoot = Split-Path -Parent $PSScriptRoot
$extensionFolder = Join-Path $workspaceRoot 'integrations\browser-relay\extension'
$envPath = Join-Path $workspaceRoot '.env.local'
if (-not $NodePath) {
  $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($nodeCommand) { $NodePath = $nodeCommand.Source }
}
$form = New-Object System.Windows.Forms.Form
$form.Text = 'Gehihi - Browser pairing'
$form.Size = New-Object System.Drawing.Size(680,340)
$form.StartPosition = 'CenterScreen'
$info = New-Object System.Windows.Forms.Label
$info.Text = "1. Chrome: chrome://extensions > Developer mode > Load unpacked.`r`n2. Choose the extension folder below.`r`n3. Open your signed-in Gemini tab, then open the Gehihi extension.`r`n4. Copy workspace key below, paste into the extension, then Connect."
$info.SetBounds(20,20,630,90)
$form.Controls.Add($info)
$folder = New-Object System.Windows.Forms.TextBox
$folder.ReadOnly = $true
$folder.Text = $extensionFolder
$folder.SetBounds(20,120,625,28)
$form.Controls.Add($folder)
$status = New-Object System.Windows.Forms.Label
$status.SetBounds(20,230,625,50)
$form.Controls.Add($status)
$copyFolder = New-Object System.Windows.Forms.Button
$copyFolder.Text = 'Copy extension folder'
$copyFolder.SetBounds(20,170,230,36)
$copyFolder.Add_Click({ Set-Clipboard -Value $extensionFolder; $status.Text = 'Folder copied. Paste into the Load unpacked folder picker.' })
$form.Controls.Add($copyFolder)
$copyKey = New-Object System.Windows.Forms.Button
$copyKey.Text = 'Copy workspace key'
$copyKey.SetBounds(280,170,230,36)
$copyKey.Add_Click({
  try {
    if (-not $NodePath) { throw 'Node unavailable' }
    $pairingKey = & $NodePath --input-type=module -e "import {readFileSync} from 'node:fs';import {parseEnv} from 'node:util';const key=parseEnv(readFileSync(process.argv[1],'utf8')).API_KEY?.trim();if(!key)process.exit(1);process.stdout.write(key);" $envPath
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($pairingKey)) { throw 'Key unavailable' }
    Set-Clipboard -Value $pairingKey
    Remove-Variable pairingKey
    $status.Text = 'Workspace key copied. Paste into the extension popup. Do not paste into chat.'
  } catch { $status.Text = 'Could not copy the workspace key. Check Node.js and .env.local.' }
})
$form.Controls.Add($copyKey)
[void]$form.ShowDialog()
$form.Dispose()
