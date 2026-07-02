$json = [Console]::In.ReadToEnd() | ConvertFrom-Json
$f = $json.tool_input.file_path
if (-not $f) { $f = $json.tool_response.filePath }
if ($f -and (Test-Path $f)) {
  $dir = Split-Path -Parent $f
  $name = Split-Path -Leaf $f
  git -C $dir add -- $f 2>$null
  git -C $dir diff --cached --quiet -- $f
  if ($LASTEXITCODE -ne 0) {
    git -C $dir commit -m "auto: update $name" -- $f 2>$null | Out-Null
  }
}
