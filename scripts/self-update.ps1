#Requires -Version 5.1
<#
.SYNOPSIS
  Pone el repo PROPIO al dia con origin antes de arrancar el proxy.

.DESCRIPTION
  Lo llaman start-m365.cmd y run_m365_proxy.bat en cada arranque. Es la puerta
  del repo propio (TheSorian/M365CopilotOpencodePlus): solo main, solo con el
  arbol limpio y solo fast-forward. Las novedades de cramt (upstream) y del fork
  de Bertogim NO entran por aqui: siguen siendo update-m365.cmd, con su rama
  temporal y su validacion (aqui no se fusiona nada ni se mueve main en local).

  Si el repo se ha movido:
    - falta node_modules, o pnpm-lock.yaml cambia -> pnpm install
    - el HEAD no coincide con el sello .git/m365-build-commit -> pnpm build
  El sello evita recompilar en cada arranque cuando no ha cambiado nada, y deja
  que un clon nuevo (otro ordenador, sin node_modules ni .output) se instale y
  compile solo la primera vez.

  Si el pull deja el repo en un commit que no compila, se vuelve al anterior
  (el arbol estaba limpio: reset --hard no descarta trabajo) y se arranca con
  la version que ya funcionaba.

  No bloquea el arranque por red o por una rama rara: avisa y sigue con lo que
  hay compilado. Solo sale con error si de verdad no hay proxy usable.

.PARAMETER Remote
  Remoto del repo propio. Por defecto origin.

.PARAMETER Branch
  Rama que se actualiza. Por defecto main.

.PARAMETER Check
  Solo cuenta lo nuevo; no toca nada.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\self-update.ps1

.EXAMPLE
  .\scripts\self-update.ps1 -Check      # ver si hay algo nuevo, sin aplicar
#>
[CmdletBinding()]
param(
    [string]$Remote = "origin",
    [string]$Branch = "main",
    [switch]$Check
)

# git y pnpm escriben avisos por stderr aunque el comando salga bien; el codigo
# de salida se comprueba paso a paso.
$ErrorActionPreference = "Stop"
if (Test-Path variable:PSNativeCommandUseErrorActionPreference) {
    $PSNativeCommandUseErrorActionPreference = $false
}

# Sin TTY: que git no se quede esperando credenciales ni un "yes/no".
$env:GIT_TERMINAL_PROMPT = "0"
$env:GCM_INTERACTIVE = "Never"
# Acota una transferencia colgada sin depender de '-c' en la linea de comandos.
$env:GIT_CONFIG_COUNT = "2"
$env:GIT_CONFIG_KEY_0 = "http.lowSpeedLimit"
$env:GIT_CONFIG_VALUE_0 = "1000"
$env:GIT_CONFIG_KEY_1 = "http.lowSpeedTime"
$env:GIT_CONFIG_VALUE_1 = "20"

function Write-Step([string]$Text) {
    Write-Host ""
    Write-Host "=== $Text ===" -ForegroundColor Cyan
}
function Write-Info([string]$Text) { Write-Host "    $Text" }
function Write-Good([string]$Text) { Write-Host "  OK  $Text" -ForegroundColor Green }
function Write-Note([string]$Text) { Write-Host "  !!  $Text" -ForegroundColor Yellow }
function Write-Bad([string]$Text) { Write-Host "  XX  $Text" -ForegroundColor Red }

# Funcion simple (sin parametros declarados) a proposito: asi los tokens que
# empiezan por guion (--no-pager, -c, ...) llegan tal cual en $args.
function Invoke-Git {
    $lines = @(& git @args 2>&1 | ForEach-Object { "$_" })
    return [pscustomobject]@{ Code = $LASTEXITCODE; Lines = $lines }
}

function Show-Lines([string[]]$Lines) {
    $Lines | ForEach-Object { Write-Host "      $_" }
}

function Get-Short([string]$Sha) {
    if ($Sha -and $Sha.Length -ge 7) { return $Sha.Substring(0, 7) }
    return $Sha
}

# --- Donde estamos -------------------------------------------------------------

if ($env:M365_SKIP_UPDATE -and $env:M365_SKIP_UPDATE -ne "0") {
    Write-Info "M365_SKIP_UPDATE puesto: no compruebo actualizaciones"
    exit 0
}

$repo = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $repo ".git"))) { $repo = $PSScriptRoot }
if (-not (Test-Path (Join-Path $repo ".git"))) {
    Write-Note "esto no parece un repo git ($repo); no compruebo actualizaciones"
    exit 0
}
Set-Location $repo

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Note "no encuentro git en el PATH; arranco con lo que hay compilado"
    exit 0
}

$gitDirResult = Invoke-Git rev-parse "--absolute-git-dir"
if ($gitDirResult.Code -eq 0) {
    $stampFile = Join-Path $gitDirResult.Lines[0] "m365-build-commit"
}
else {
    $stampFile = Join-Path (Join-Path $repo ".git") "m365-build-commit"
}
$outputFile = Join-Path $repo "packages\proxy\.output\server\index.mjs"

function Test-UsableBuild { return (Test-Path $outputFile) }

function Get-Pnpm {
    $cmd = Get-Command pnpm.cmd -ErrorAction SilentlyContinue
    if (-not $cmd) { $cmd = Get-Command pnpm -ErrorAction SilentlyContinue }
    if (-not $cmd) { return $null }
    if ($cmd.Source) { return $cmd.Source }
    return $cmd.Name
}

function Invoke-Pnpm([string]$Task) {
    # Out-Host: la salida va a la consola y NO se mezcla con el valor devuelto.
    & $pnpm $Task | Out-Host
    return $LASTEXITCODE
}

# --- Que hay de nuevo ----------------------------------------------------------

$headResult = Invoke-Git rev-parse "HEAD"
if ($headResult.Code -ne 0) {
    Write-Note "no se pudo leer el HEAD de git; arranco con lo que hay compilado"
    exit 0
}
$oldHead = $headResult.Lines[0]
$head = $oldHead

$current = (Invoke-Git rev-parse "--abbrev-ref" "HEAD").Lines[0]

# Solo cuenta lo modificado/borrado: un fichero sin seguimiento no impide un
# fast-forward (y si choca con uno que trae el pull, git aborta y se avisa).
$dirty = @()
$statusResult = Invoke-Git status "--porcelain" "--untracked-files=no"
if ($statusResult.Code -eq 0) {
    $dirty = @($statusResult.Lines | Where-Object { $_.Trim() -ne "" })
}

$pullDone = $false
$why = $null

Write-Step "Repo propio: $Remote/$Branch"
Write-Info "repo: $repo"
Write-Info "rama: $current ($(Get-Short $head))"

if ($Check) {
    $null = Invoke-Git fetch "--prune" "--quiet" $Remote $Branch
    $count = Invoke-Git rev-list "--count" "HEAD..$Remote/$Branch"
    if ($count.Code -eq 0) {
        $behind = [int]$count.Lines[0]
        if ($behind -eq 0) {
            Write-Good "no hay nada nuevo en $Remote/$Branch"
        }
        else {
            Write-Info "$behind commit(s) nuevos en $Remote/${Branch}:"
            $log = Invoke-Git --no-pager log "--oneline" "--no-decorate" "HEAD..$Remote/$Branch"
            Show-Lines $log.Lines
        }
    }
    else {
        Write-Note "no se pudo comparar con $Remote/$Branch (revisa 'git remote -v' o la red)"
    }
    exit 0
}

if ($current -ne $Branch) {
    $why = "estas en la rama '$current'; el arranque solo actualiza '$Branch'"
}
elseif ($dirty.Count -gt 0) {
    $why = "hay $($dirty.Count) fichero(s) sin commitear; no actualizo encima de trabajo a medias"
}
else {
    $fetch = Invoke-Git fetch "--prune" "--quiet" $Remote $Branch
    if ($fetch.Code -ne 0) {
        $why = "no se pudo contactar con $Remote (sin red?); sigo con lo compilado"
    }
    else {
        $aheadResult = Invoke-Git rev-list "--count" "$Remote/$Branch..HEAD"
        $behindResult = Invoke-Git rev-list "--count" "HEAD..$Remote/$Branch"
        if ($aheadResult.Code -ne 0 -or $behindResult.Code -ne 0) {
            $why = "no se pudo comparar HEAD con $Remote/$Branch"
        }
        else {
            $ahead = [int]$aheadResult.Lines[0]
            $behind = [int]$behindResult.Lines[0]

            if ($ahead -gt 0) {
                $why = "$Branch tiene $ahead commit(s) locales sin subir; no muevo la rama"
            }
            elseif ($behind -eq 0) {
                Write-Good "al dia con $Remote/$Branch ($(Get-Short $head))"
            }
            else {
                Write-Info "$behind commit(s) nuevos:"
                $log = Invoke-Git --no-pager log "--oneline" "--no-decorate" "HEAD..$Remote/$Branch"
                Show-Lines $log.Lines

                $merge = Invoke-Git merge "--ff-only" "--quiet" "$Remote/$Branch"
                if ($merge.Code -ne 0) {
                    $why = "divergen $Branch y $Remote/$Branch; arreglalo a mano ('git status -sb')"
                }
                else {
                    $head = (Invoke-Git rev-parse "HEAD").Lines[0]
                    $pullDone = $true
                    Write-Good "actualizado $(Get-Short $oldHead) -> $(Get-Short $head)"
                }
            }
        }
    }
}

if ($why) { Write-Note "$why. Arranco con lo que hay." }

# --- Instalar y compilar si hace falta ----------------------------------------

$needInstall = $false
if (-not (Test-Path (Join-Path $repo "node_modules"))) {
    $needInstall = $true
}
elseif ($pullDone) {
    $changed = @((Invoke-Git diff "--name-only" "$oldHead..$head").Lines)
    if ($changed -contains "pnpm-lock.yaml") { $needInstall = $true }
}

# Solo docs/scripts/ficheros .md no entran en el build: si el unico cambio desde
# el ultimo build es de esos, se avanza el sello sin recompilar (15 s de menos en
# cada arranque tras un commit de documentacion).
function Test-BuildRelevant([string[]]$Paths) {
    foreach ($path in $Paths) {
        if (-not $path) { continue }
        $norm = $path -replace "\\", "/"
        if ($norm -like "docs/*") { continue }
        if ($norm -like "scripts/*") { continue }
        if ($norm -like ".github/*") { continue }
        if ($norm -like "*.md") { continue }
        return $true
    }
    return $false
}

$built = ""
if (Test-Path $stampFile) { $built = (Get-Content $stampFile -Raw).Trim() }
$needBuild = (-not (Test-UsableBuild))

if (-not $needBuild -and $built -ne $head) {
    $known = $false
    if ($built) {
        $verify = Invoke-Git rev-parse "--verify" "--quiet" "$built^{commit}"
        $known = ($verify.Code -eq 0)
    }
    if (-not $known) {
        # sello ilegible o de un commit que ya no existe: se recompila
        $needBuild = $true
    }
    else {
        $diff = Invoke-Git diff "--name-only" "$built..$head"
        if ($diff.Code -ne 0 -or (Test-BuildRelevant $diff.Lines)) {
            $needBuild = $true
        }
        else {
            Write-Info "desde $(Get-Short $built) solo cambian docs/scripts; no recompilo"
        }
    }
}

if (-not $needInstall -and -not $needBuild) {
    # El sello puede quedarse atras tras un commit de solo documentacion: se pone
    # al dia para no repetir esta comprobacion en cada arranque.
    if ($built -ne $head) { Set-Content -Path $stampFile -Value $head -NoNewline -Encoding ASCII }
    exit 0
}

$pnpm = Get-Pnpm
if (-not $pnpm) {
    if (Test-UsableBuild) {
        Write-Note "no encuentro pnpm en el PATH; arranco con el build que ya hay"
        exit 0
    }
    Write-Bad "no encuentro pnpm y no hay build: instala Node y pnpm (npm i -g pnpm)"
    exit 1
}

$fail = $null

if ($needInstall) {
    Write-Step "Instalando dependencias"
    if ((Invoke-Pnpm "install") -ne 0) { $fail = "install" }
    else { Write-Good "dependencias listas" }
}
if (-not $fail -and $needBuild) {
    Write-Step "Compilando ($(Get-Short $head))"
    if ((Invoke-Pnpm "build") -ne 0) { $fail = "build" }
    else { Write-Good "build al dia ($(Get-Short $head))" }
}

if ($fail) {
    if ($fail -eq "install") { $what = "pnpm install" } else { $what = "pnpm build" }

    if (-not $pullDone) {
        if (Test-UsableBuild) {
            Write-Note "$what fallo; arranco con el build que ya hay"
            exit 0
        }
        Write-Bad "$what fallo y no hay build: el proxy no puede arrancar"
        Write-Info "a mano:  pnpm.cmd install; pnpm.cmd build"
        exit 1
    }

    # El commit nuevo no compila: se vuelve al anterior, que si compilaba.
    Write-Bad "$what fallo en $(Get-Short $head)"
    Write-Info "volviendo a $(Get-Short $oldHead) (el arbol estaba limpio: no se descarta nada)"
    $null = Invoke-Git reset "--hard" "--quiet" $oldHead
    Remove-Item $stampFile -Force -ErrorAction SilentlyContinue
    $head = $oldHead

    Write-Step "Recompilando $(Get-Short $head)"
    $ok = $true
    & $pnpm install
    if ($LASTEXITCODE -ne 0) { $ok = $false }
    if ($ok) {
        & $pnpm build
        if ($LASTEXITCODE -ne 0) { $ok = $false }
    }
    if (-not $ok) {
        Write-Bad "tampoco compila $(Get-Short $head); el repo se queda en ese commit"
        Write-Info "a mano:  pnpm.cmd install; pnpm.cmd build   (hay que arreglarlo)"
        exit 1
    }
    Write-Note "arranco con la version anterior (sin la actualizacion)"
}

if (-not (Test-UsableBuild)) {
    Write-Bad "no hay packages\proxy\.output\server\index.mjs; el proxy no puede arrancar"
    exit 1
}

$finalHead = (Invoke-Git rev-parse "HEAD").Lines[0]
if ($finalHead) { $head = $finalHead }
Set-Content -Path $stampFile -Value $head -NoNewline -Encoding ASCII
exit 0
