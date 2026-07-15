param([string]$EvidenceDir = "services/platform/data/evidence")
$root = (Resolve-Path -LiteralPath ".").Path
$target = [IO.Path]::GetFullPath((Join-Path $root $EvidenceDir))
if (-not $target.StartsWith($root + [IO.Path]::DirectorySeparatorChar)) { throw "Evidence directory must stay inside the workspace." }
New-Item -ItemType Directory -Force -Path $target | Out-Null
Write-Output "Demo seed uses the checked-in UI fixtures and evaluation/fixtures.json."
Write-Output "Evidence directory ready: $target"
Write-Output "No Studionet transaction was submitted. Use docs/DEMO_RUNBOOK.md for the live sequence."

