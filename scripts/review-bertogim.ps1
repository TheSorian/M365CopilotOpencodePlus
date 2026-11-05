#Requires -Version 5.1
<#
.SYNOPSIS
  Prueba los cambios de Bertogim en una rama aparte. Nunca toca main.

.DESCRIPTION
  Bertogim es la fuente de las ideas de OpenCode, no un espejo: su main puede
  estar a mitad de un cambio (el 2026-11-05 llevaba 12 commits con la suite en
  rojo). Este script no decide por ti: fusiona su main en una rama de revision,
  pasa check-ours y la suite, y te dice si el resultado esta verde.

    1. exige el arbol limpio, actualiza main (si origin responde) y crea
       review-bertogim-AAAA-MM-DD desde main
    2. fusiona bertogim/main en esa rama
    3. node scripts/check-ours.mjs, pnpm install, pnpm test
    4. verde  -> la rama se queda, main intacto, y te dice como adoptarla
       rojo   -> la rama se borra (con -Keep se conserva para mirar)

  No fusiona nada en main. Adoptarlo es un paso aparte y explicito.

.PARAMETER Remote
  Remoto del fork. Por defecto bertogim.

.PARAMETER MainBranch
  Rama estable de referencia. Por defecto main.

.PARAMETER Keep
  Conserva la rama de revision aunque la validacion falle.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\review-bertogim.ps1

.EXAMPLE
  .\scripts\review-bertogim.ps1 -Keep     # fallar y aun asi poder mirarlo
#>
[CmdletBinding()]
param(
    [string]$Remote = "bertogim",
    [string]$MainBranch = "main",
    [switch]$Keep
)

$ErrorActionPreference = "Stop"
if (Test-Path variable:PSNativeCommandUseErrorActionPreference) {
    $PSNativeCommandUseErrorActionPreference = $false
}

function Write-Step([string]$Text) {
    Write-Host ""
    Write-Host "=== $Text ===" -ForegroundColor Cyan
}
function Write-Info([string]$Text) { Write-Host "    $Text" }
function Write-Good([string]$Text) { Write-Host "  OK  $Text" -ForegroundColor Green }
function Write-Note([string]$Text) { Write-Host "  !!  $Text" -ForegroundColor Yellow }
function Write-Bad([string]$Text) { Write-Host "  XX  $Text" -ForegroundColor Red }

function Assert-LastExit([string]$What) {
    if ($LASTEXITCODE -ne 0) { throw "$What (codigo $LASTEXITCODE)" }
}

function Switch-ToMain {
    $null = git checkout --quiet $MainBranch 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Note "quedaban cambios sin commitear; se descartan para volver a $MainBranch"
        $null = git checkout --quiet --force $MainBranch 2>$null
    }
}

# --- Donde estamos ------------------------------------------------------------

$repo = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $repo ".git"))) {
    if (Test-Path (Join-Path $PSScriptRoot ".git")) { $repo = $PSScriptRoot }
    else { Write-Bad "no encuentro la raiz del repo desde $PSScriptRoot"; exit 1 }
}
Set-Location $repo

$pnpmCmd = Get-Command pnpm.cmd -ErrorAction SilentlyContinue
if (-not $pnpmCmd) { $pnpmCmd = Get-Command pnpm -ErrorAction SilentlyContinue }
if (-not $pnpmCmd) { Write-Bad "no encuentro pnpm en el PATH"; exit 1 }
$pnpmPath = $pnpmCmd.Source
if (-not $pnpmPath) { $pnpmPath = $pnpmCmd.Name }

$date = Get-Date -Format "yyyy-MM-dd"
$tmp = "review-$Remote-$date"
$n = 1
while (git rev-parse --verify --quiet "refs/heads/$tmp") {
    $n++
    $tmp = "review-$Remote-$date-$n"
}

try {
    Write-Step "Revision de $Remote/$MainBranch"
    Write-Info "repo:  $repo"
    Write-Info "rama:  $MainBranch -> $tmp (main no se toca)"

    # --- Puerta 1: arbol limpio ----------------------------------------------

    $dirty = @(git status --porcelain)
    Assert-LastExit "no se pudo leer el estado del repo"
    if ($dirty.Count -gt 0) {
        Write-Bad "hay cambios sin commitear; no reviso encima de trabajo a medias:"
        $dirty | ForEach-Object { Write-Host "      $_" }
        Write-Info ""
        Write-Info "guardalos (git add -A; git commit) o apartalos (git stash -u) y relanza."
        exit 1
    }

    # --- main al dia (si se puede) -------------------------------------------

    Write-Step "Preparando $MainBranch"
    $null = git checkout --quiet $MainBranch
    Assert-LastExit "no se pudo cambiar a $MainBranch"

    $null = git fetch --quiet origin $MainBranch
    if ($LASTEXITCODE -eq 0) {
        $null = git merge --ff-only --quiet "origin/$MainBranch" 2>$null
        if ($LASTEXITCODE -ne 0) {
            Write-Bad "$MainBranch y origin/$MainBranch han divergido. Arreglalo antes:"
            Write-Info "  git status -sb"
            exit 1
        }
    }
    else {
        Write-Note "no se pudo traer origin/$MainBranch; sigo con el main local"
    }

    $null = git fetch --prune --quiet $Remote
    Assert-LastExit "no se pudo contactar con el remoto '$Remote' (revisa: git remote -v)"

    # Se captura primero y se comprueba despues: cerrar el pipe antes de tiempo
    # (Select-Object -First) deja $LASTEXITCODE en -1 aunque git haya ido bien.
    $count = git rev-list --count "$MainBranch..$Remote/$MainBranch"
    Assert-LastExit "no se pudo comparar $MainBranch con $Remote/$MainBranch"
    $ahead = [int]$count

    if ($ahead -eq 0) {
        Write-Good "no hay nada nuevo en $Remote/$MainBranch. Nada que revisar."
        exit 0
    }

    Write-Info "$ahead commit(s) nuevos en $Remote/${MainBranch}:"
    git --no-pager log --oneline --no-decorate "$MainBranch..$Remote/$MainBranch" |
        ForEach-Object { Write-Host "      $_" }

    Write-Info ""
    Write-Info "lo que cambiaria:"
    git --no-pager diff --stat "$MainBranch...$Remote/$MainBranch" |
        ForEach-Object { Write-Host "      $_" }

    # --- Ensayo, en una rama --------------------------------------------------

    Write-Step "Rama de revision $tmp"
    $null = git checkout --quiet -b $tmp
    Assert-LastExit "no se pudo crear la rama $tmp"

    Write-Step "Fusionando $Remote/$MainBranch"
    $null = git merge --no-commit --no-ff "$Remote/$MainBranch"
    if ($LASTEXITCODE -ne 0) {
        $conflicts = @(git diff --name-only --diff-filter=U)
        $null = git merge --abort 2>$null
        if ($conflicts.Count -gt 0) {
            Write-Bad "conflicto en $($conflicts.Count) fichero(s):"
            $conflicts | ForEach-Object { Write-Host "      $_" }
            Write-Info ""
            Write-Info "es lo normal cuando su main va por detras en handler.ts / fenced.ts /"
            Write-Info "tools.ts. Si te interesa, repitelo con -Keep y fusiona a mano."
        }
        throw "el merge no se pudo completar"
    }

    $null = git commit --quiet --no-edit -m "merge: $Remote/$MainBranch en rama de revision ($date)"
    Assert-LastExit "no se pudo registrar el merge en $tmp"

    Write-Step "Comprobando los deltas propios"
    node scripts/check-ours.mjs
    Assert-LastExit "check-ours: ese merge se lleva algun parche propio (lista arriba)"

    Write-Step "Instalando dependencias"
    & $pnpmPath install
    Assert-LastExit "pnpm install"

    $lock = @(git status --porcelain -- pnpm-lock.yaml)
    if ($lock.Count -gt 0) {
        $null = git add -- pnpm-lock.yaml
        $null = git commit --quiet -m "chore: lockfile tras pnpm install"
        Assert-LastExit "no se pudo registrar el lockfile"
        Write-Note "pnpm-lock.yaml cambia con este merge; va en la misma rama"
    }

    Write-Step "Build + tests"
    & $pnpmPath test
    Assert-LastExit "pnpm test: su main no esta en verde, o el merge lo rompe"

    # --- Resultado: se queda la rama, main no se toca -------------------------

    Switch-ToMain
    Write-Host ""
    Write-Good "revision superada. $MainBranch NO se ha tocado."
    Write-Info ""
    Write-Info "mirarlo:   git log $MainBranch..$tmp; git diff $MainBranch...$tmp"
    Write-Info "adoptarlo: git merge --ff-only $tmp; git push origin $MainBranch"
    Write-Info "           git branch -d $tmp"
    Write-Info "tirarlo:   git branch -D $tmp"
    exit 0
}
catch {
    Write-Host ""
    Write-Bad $_.Exception.Message
    Write-Host ""
    Write-Info "deshaciendo el intento..."

    if (git rev-parse --verify --quiet MERGE_HEAD) { $null = git merge --abort 2>$null }
    Switch-ToMain

    if ($tmp -and (git rev-parse --verify --quiet "refs/heads/$tmp")) {
        if ($Keep) {
            Write-Note "-Keep: $tmp sigue ahi para mirarla (git log $MainBranch..$tmp)"
        }
        else {
            $null = git branch -D $tmp 2>$null
            Write-Good "rama $tmp borrada; $MainBranch intacto. No se ha traido nada."
            Write-Info "para ver el detalle del fallo con la rama a mano: -Keep"
        }
    }
    else {
        Write-Good "$MainBranch intacto."
    }
    exit 1
}
