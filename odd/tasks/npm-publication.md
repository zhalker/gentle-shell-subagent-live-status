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
