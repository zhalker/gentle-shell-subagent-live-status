# Publicación npm de subagent-live-status

Plan aprobado por el propietario para convertir la extensión `subagent_live_status`
(proveniente del handoff `subagent-live-status-handoff.zip`) en un paquete Pi publicable
en GitHub y npm. Este documento es el plan y el registro de desvíos: cualquier cambio
respecto de lo aprobado se anota en `## Log` con evidencia y justificación.

## Specs

- S1: «quiero subirlo a github y publicarlo en npm pero para ello primero necesitare que tenga su propia carpeta» — carpeta propia `C:\xampp\htdocs\gentle-shell-subagent-live-status`, proyecto en la raíz, handoff en `docs/HANDOFF.md`.
- S2: «a persistir tu plan en un .md y despues implementa tu plan que ya desde ahora apruebo...si algo cambia o se desvia del plan, actualizas el plan dando evidencia y justificando con justa razon ello» — este documento es el plan; desvíos se registran aquí con evidencia.
- S3: Decisión aprobada: nombre npm `@zhalker/gentle-shell-subagent-live-status`, repo GitHub `zhalker/gentle-shell-subagent-live-status` (ambos verificados libres: npm E404, GitHub no existe al 2026-11-10).
- S4: Decisión aprobada: licencia MIT.
- S5: Decisión aprobada: soporte declarado inicial = gentle-pi 4.7.x, Node ≥ 22; la dependencia de `gentle-pi/lib/orchestrator-presence.ts` (API interna) impide prometer más sin pruebas.
- S6: Fase 2: entrada de paquete propia (`pi.extensions`) que resuelve la API de presencia de gentle-pi en runtime, con degradación clara si falta, en lugar del `index.ts` generado por `install.mjs`.
- S7: Fase 3, con gate: `gh repo create` y `npm publish --access public` requieren autorización explícita del propietario por separado; el login npm lo hace el propietario.
- S8: Del handoff: publishing requiere aprobación del propietario; no asumir que un `npm install` pelado funciona; revisar `npm pack --dry-run`, licencia, exposición de secretos y metadatos antes de publicar.

## Tasks

- T1 (S1): crear carpeta y copiar proyecto — commit `chore: import...`
- T2 (S1): arreglar `tests/install.test.mjs` para que resuelva el instalador desde `import.meta.url` — commit `test: ...`
- T3 (S2): persistir este plan + `.gitignore` + `.gitattributes` + LICENSE MIT — commit `docs: ...`
- T4 (S1): tests en verde desde la raíz y commit inicial — evidencia en Log
- T5 (S3,S4,S5): manifiesto npm completo (files, keywords pi-package, repository, engines, license, publishConfig) — commit `chore: ...`
- T6 (S6): `extensions/index.ts` como entrada de paquete con resolución runtime de presencia — commit `feat: ...`
- T7 (S8): README de instalación (`pi install npm:...`), versiones probadas y límites — commit `docs: ...`
- T8 (S8): verificación: carga del entry con jiti, `npm pack --dry-run`, sesión Pi aislada con `-p`
- T9 (S2): actualizar este documento con evidencia tras cada unidad; commits por unidad (~400 líneas)
- T10 (S7): publicar (repo + npm) tras decisión explícita del propietario

## Log

- L1 (2026-11-10, verbatim): «En Descargas he traido esto subagent-live-status-handoff.zip quiero subirlo a github y publicarlo en npm pero para ello primero necesitare que tenga su propia carpeta. lo primero, lee su contenido, analizalo y despues detallame lo que haras y te lo apruebo»
- L2 (2026-11-10): Propietario aprueba el plan completo por adelantado: «Me parece bien pero primero, a persistir tu plan en un .md y despues implementa tu plan que ya desde ahora apruebo...si algo cambia o se desvia del plan, actualizas el plan dando evidencia y justificando con justa razon ello». Añade garantía de uso: «en la oficina me funciono super bien asi que garantizo que en las 8 horas que lo use, estuvo bien» (uso real en oficina, Pi 1.5.0 / Gentle Shell 4.7.0).
- L3 (2026-11-10, evidencia medida aquí): suite extraída y corrida desde el scratch: Node 24.20.0, 53 pass / 0 fail / 0 skipped (el handoff decía 52 pass + 1 skipped por symlink; en esta máquina Windows ya permite crearlo). El handoff menciona `extension/index.js`; el archivo real está en `index.js`.
- L4 (2026-11-10, leído): `gentle-pi` 4.7.0 no declara campo `exports` en su `package.json`, por lo que el subpath `gentle-pi/lib/orchestrator-presence.ts` es importable; funciones requeridas verificadas en el archivo: `rootFor`, `sessionHash`, `boundedRead`, `readActivity`. Patrón probado de paquete Pi: `@zhalker/gentle-shell-codegraph-subagents` (entrada `extensions/index.ts`, imports TS vía Jiti, `files`, `prepublishOnly`).
- L5 (2026-11-10, decisión con evidencia): el instalador `install.mjs` se conserva en el paquete como opción de instalación manual documentada (útil para quien no use `pi install`), pero la vía principal pasa a ser `pi install npm:...` con la entrada propia del paquete (T6).
- L6 (2026-11-10, decisión con evidencia medida aquí): la entrada `extensions/index.ts` usa **import dinámico con catch** del subpath `gentle-pi/lib/orchestrator-presence.ts` (no import estático ni file URL). Sonda con la Jiti 2.7.0 que trae Pi: el import dinámico de un subpath TS dentro de `node_modules` funciona (`dyn result: pong`); el comentario de `install.mjs` («Node dynamic imports cannot strip TypeScript inside node_modules») aplica al import dinámico de Node nativo, no al de Jiti. Esto permite la degradación `presence-bridge-not-configured` sin romper la carga del paquete (S6).
- L7 (2026-11-10, medido): load test de la entrada real con Jiti, dos casos. Caso 1 (repo sin gentle-pi hermano): carga, registra la herramienta y degrada a `presence-bridge-not-configured`. Caso 2 (layout npm con stub de gentle-pi): la cadena completa `rootFor → sessionHash → boundedRead → readActivity` corre contra el stub y el `unavailable` del stub sale en la respuesta. Nota de borde encontrada: `readOwnActivity` exige `now >= heartbeat`; un stub con heartbeat futuro da `stale-presence` (corrección del stub, no del producto).
- L8 (2026-11-10, medido): `npm pack --dry-run`: 14 archivos, 20.3 kB comprimido, 72.0 kB descomprimido; no se cuelan `odd/` ni `docs/` ni scratch. `npm test` sigue 53/53 desde la raíz.
- L9 (2026-11-10, medido): integración real en perfil Pi aislado (`PI_CODING_AGENT_DIR` temporal dentro del scratch, `pi --no-session -p`, modelo `openai-codex/gpt-6.1-sol`). Sin gentle-pi cargado: el modelo llamó `subagent_live_status` y obtuvo el JSON degradado correcto (`nativeDetail: "Tool subagent_status not found"`). Con gentle-pi 4.7.0 cargado en el perfil: `nativeError:false` + `nativeDetail: "Error: no task probe-1."` — la herramienta registró y el dispatch nativo respondió. Residual declarado: el puente de presencia no se ejercitó en runtime Pi real en esta corrida (el error nativo corta antes de llamar `activity`); está probado por el load test (L7, entrada real) y por las 8 h de oficina con la entrada generada equivalente.
- L10 (2026-11-10, decisión con justificación): el manifiesto declara **sin** `peerDependencies` de gentle-pi: npm ≥7 auto-instala peers, lo que duplicaría gentle-pi dentro del paquete; la resolución es por layout (`node_modules` hermano) y el acoplamiento de versión queda documentado (S5) en vez de forzado por npm. `publishConfig.access: "public"` para el scope `@zhalker`.
- L11 (2026-11-10, evidencia): el intento de refresh OAuth de Anthropic durante la prueba aislada falló sobre la **copia** de `auth.json` dentro del scratch (`Refresh token expired`); el `auth.json` real no fue tocado. Los 259 junctions creados para el perfil aislado se deshicieron con `rmdir` (solo el enlace) y se verificó que el agent dir real quedó intacto.
