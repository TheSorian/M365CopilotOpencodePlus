#Requires -Version 5.1
<#
.SYNOPSIS
  Trae los cambios de cramt (upstream) sin tocar main hasta que esten validados.

.DESCRIPTION
  El orden importa: antes se probaba el merge sobre main y, si la suite salia en
  rojo, habia que deshacerlo a mano (git reset --hard pre-update). Aqui el merge
  ocurre en una rama de usar y tirar, y main solo avanza si esa rama esta verde:

    1. exige el arbol limpio y main sincronizado con origin
    2. crea update-upstream-AAAA-MM-DD desde main y fusiona upstream/main
    3. node scripts/check-ours.mjs, pnpm install, pnpm test
    4. verde  -> merge --ff-only a main y push
       rojo   -> se borra la rama y main se queda exactamente como estaba

  No crea tags: los hitos se etiquetan a mano (stable-baseline-AAAA-MM-DD).

.PARAMETER Remote
  Remoto del que se trae. Por defecto upstream (cramt).

.PARAMETER MainBranch
  Rama estable que se actualiza. Por defecto main.

.PARAMETER NoPush
  Hace todo el trabajo local, pero no sube main a origin.

.PARAMETER KeepBranch
  Si la validacion falla, deja la rama temporal para poder mirarla.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\update-upstream.ps1

.EXAMPLE
  .\scripts\update-upstream.ps1 -NoPush     # probar sin subir nada
#>
[CmdletBinding()]
param(
    [string]$Remote = "upstream",
    [string]$MainBranch = "main",
    [switch]$NoPush,
    [switch]$KeepBranch
)

# git y pnpm escriben avisos por stderr aunque el comando salga bien; aqui eso no
# es un error, el codigo de salida se comprueba paso a paso.
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

# Vuelve a main. Si el build o el install han dejado ficheros tocados, se
# descartan: vienen de esta prueba, no son trabajo del usuario.
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
$tmp = "update-$Remote-$date"
$n = 1
while (git rev-parse --verify --quiet "refs/heads/$tmp") {
    $n++
    $tmp = "update-$Remote-$date-$n"
}

try {
    Write-Step "Actualizacion desde $Remote/$MainBranch"
    Write-Info "repo:  $repo"
    Write-Info "rama:  $MainBranch -> $tmp"

    # --- Puerta 1: arbol limpio ----------------------------------------------

    $dirty = @(git status --porcelain)
    Assert-LastExit "no se pudo leer el estado del repo"
    if ($dirty.Count -gt 0) {
        Write-Bad "hay cambios sin commitear; no actualizo encima de trabajo a medias:"
        $dirty | ForEach-Object { Write-Host "      $_" }
        Write-Info ""
        Write-Info "guardalos (git add -A; git commit) o apartalos (git stash -u) y relanza."
        exit 1
    }

    # --- main al dia ---------------------------------------------------------

    Write-Step "Preparando $MainBranch"
    $null = git checkout --quiet $MainBranch
    Assert-LastExit "no se pudo cambiar a $MainBranch"

    $null = git pull --ff-only --quiet origin $MainBranch 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Bad "no se pudo avanzar $MainBranch desde origin sin fusionar."
        Write-Info "mira 'git status -sb': si main y origin han divergido, arreglalo a mano."
        Write-Info "No he tocado nada."
        exit 1
    }

    $null = git fetch --prune --quiet $Remote
    Assert-LastExit "no se pudo contactar con el remoto '$Remote' (revisa: git remote -v)"

    # Se captura primero y se comprueba despues: cerrar el pipe antes de tiempo
    # (Select-Object -First) deja $LASTEXITCODE en -1 aunque git haya ido bien.
    $count = git rev-list --count "$MainBranch..$Remote/$MainBranch"
    Assert-LastExit "no se pudo comparar $MainBranch con $Remote/$MainBranch"
    $behind = [int]$count

    if ($behind -eq 0) {
        Write-Good "no hay nada nuevo en $Remote/$MainBranch. Nada que hacer."
        exit 0
    }

    Write-Info "$behind commit(s) nuevos en $Remote/${MainBranch}:"
    git --no-pager log --oneline --no-decorate "$MainBranch..$Remote/$MainBranch" |
        ForEach-Object { Write-Host "      $_" }

    # --- La actualizacion, en una rama ---------------------------------------

    Write-Step "Rama temporal $tmp"
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
            Write-Info "suele ser handler.ts / tools.ts / fenced.ts: conserva tu lado"
            Write-Info "(OpenCode + patrones ES) y fusiona a mano donde quieras."
        }
        throw "el merge no se pudo completar"
    }

    # --no-commit deja el merge sin registrar: se registra aqui, en la rama, no
    # en main. Asi el rollback es borrar la rama.
    $null = git commit --quiet --no-edit -m "merge: $Remote/$MainBranch ($date)"
    Assert-LastExit "no se pudo registrar el merge en $tmp"

    Write-Step "Comprobando los deltas propios"
    node scripts/check-ours.mjs
    Assert-LastExit "check-ours: un merge se ha llevado algun parche propio (lista arriba)"

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
    Assert-LastExit "pnpm test: la suite no esta en verde con este merge"

    # --- Promocion -----------------------------------------------------------

    Write-Step "Todo verde: promocionando a $MainBranch"
    Switch-ToMain
    $null = git merge --quiet --ff-only $tmp
    Assert-LastExit "no se pudo avanzar $MainBranch (no es fast-forward: revisa git status)"

    if ($NoPush) {
        Write-Note "-NoPush: $MainBranch esta actualizado en local, sin subir."
    }
    else {
        $null = git push --quiet origin $MainBranch 2>$null
        if ($LASTEXITCODE -ne 0) {
            Write-Bad "el merge esta hecho en local, pero el push fallo."
            Write-Info "cuando vuelva la red:  git push origin $MainBranch"
            Write-Info "la rama $tmp se conserva por si acaso."
            exit 1
        }
        Write-Good "subido a origin/$MainBranch"
    }

    $null = git branch --quiet -d $tmp 2>$null
    Write-Host ""
    Write-Good "actualizado. Reinicia el proxy (start-m365.cmd) para usar la version nueva."
    Write-Info "si quieres un punto de recuperacion:  git tag stable-$date; git push origin stable-$date"
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
        if ($KeepBranch) {
            Write-Note "-KeepBranch: $tmp sigue ahi para mirarla (git log $MainBranch..$tmp)"
        }
        else {
            $null = git branch -D $tmp 2>$null
            Write-Good "rama $tmp borrada; $MainBranch no se ha movido."
        }
    }
    else {
        Write-Good "$MainBranch no se ha movido."
    }
    exit 1
}
