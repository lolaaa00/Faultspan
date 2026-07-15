param([string]$EvidenceDir = "services/platform/data/evidence", [switch]$Confirm)
if (-not $Confirm) { throw "Pass -Confirm to remove generated local evidence. Studionet state is never modified by this script." }
$root = (Resolve-Path -LiteralPath ".").Path
$target = [IO.Path]::GetFullPath((Join-Path $root $EvidenceDir))
if (-not $target.StartsWith($root + [IO.Path]::DirectorySeparatorChar)) { throw "Refusing to reset a directory outside the workspace." }
if (Test-Path -LiteralPath $target) {
  Get-ChildItem -LiteralPath $target -File -Filter "*.json" | Remove-Item -Force
}
Write-Output "Local generated evidence reset. Studionet was not touched."

