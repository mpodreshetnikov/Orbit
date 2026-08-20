---
id: T-0017
title: Clear the critical and runtime-facing dependency vulnerabilities
status: open
kind: debt
priority: p1
depth: note
created: 2026-08-20
updated: 2026-08-20
owner: TBD
tags: [security, dependencies, ci]
exit: "`npm audit` сообщает 0 critical, и ни одной high среди пакетов, попадающих в развёрнутое приложение; в Dependabot на `main` нет открытых critical-алертов. Оставшиеся находки в инструментальных зависимостях либо устранены, либо перечислены в этой задаче с указанием, почему они не влияют на продакшен."
---

# Clear the critical and runtime-facing dependency vulnerabilities

## Context

Репозиторий стал публичным, и вместе с ним стал публичным список его уязвимостей: Dependabot показывает 128 алертов на ветке `main` (5 critical, 61 high). Это не следствие переезда — долг накапливался в старом репозитории и просто перестал быть невидимым. Значение имеет не только сам риск, но и то, что теперь любой может посмотреть, какие именно уязвимые версии развёрнуты.

Счётчики Dependabot и `npm audit` расходятся, и это ожидаемо: Dependabot считает алерты по каждому пути в дереве зависимостей, `npm audit` — по пакетам. Локальный `npm audit` на текущем `main` даёт 53 находки: 6 critical, 31 high, 15 moderate, 1 low. Работать удобнее по нему, а Dependabot использовать как контрольную проверку.

Разбор по критичности важнее общего числа, потому что **большая часть critical не доезжает до продакшена**. Из шести critical три — инструментальные: `vitest`, `@vitest/coverage-v8` и `concurrently`; ещё три транзитивные — `protobufjs`, `shell-quote`, `tar`. Ни один из них не исполняется в развёрнутом приложении. Уязвимость `vitest` вообще требует запущенного UI-сервера Vitest, которого в CI нет.

Реально в рантайме живут другие. Прежде всего `next` (`package.json`, сейчас `^15.1.6`) — отказ в обслуживании через оптимизацию изображений, и это касается именно self-hosted развёртываний, то есть нашего. Затем стек OpenTelemetry: `@opentelemetry/sdk-node`, `@opentelemetry/auto-instrumentations-node`, `@opentelemetry/exporter-trace-otlp-http` и транзитивный `@grpc/grpc-js` — они работают в серверном процессе (`src/lib/observability/server-otel.ts`). `postcss` и `vite` участвуют в сборке, но не в рантайме.

Отсюда порядок работы: сначала `next` и OpenTelemetry, потом транзитивные critical, потом инструментальные. Разделение на «рантайм» и «инструменты» — не отговорка, а способ не тратить срочность на то, что её не требует; всё, что остаётся неисправленным, должно быть названо в этой задаче с обоснованием.

Отдельная поверхность — Edge Functions на Deno (`supabase/functions/deno.lock`). Их зависимости `npm audit` не видит вовсе, и по ним нужен свой проход.

Мелочь, всплывшая при разборе: `@eslint/eslintrc` и `@playwright/test` лежат в `dependencies`, хотя это инструменты. На безопасность влияет слабо, но раздувает то, что считается рантаймом, и мешает читать результаты аудита.

Проверять после каждого шага: `npm audit`, полный `test-unit`, `quality` и сборку. Обновление `next` или OpenTelemetry способно сломать сборку или телеметрию, поэтому обновления стоит вести отдельными коммитами, а не одним махом.

## Progress

- [ ] Обновить `next` до версии с исправлением DoS в оптимизации изображений; проверить сборку и e2e.
- [ ] Обновить стек OpenTelemetry (`sdk-node`, `auto-instrumentations-node`, `exporter-trace-otlp-http`) и убедиться, что телеметрия по-прежнему доходит до Grafana.
- [ ] Закрыть транзитивные critical (`protobufjs`, `shell-quote`, `tar`) — через обновление родительских пакетов или `overrides`.
- [ ] Обновить инструментальные пакеты (`vitest`, `@vitest/coverage-v8`, `concurrently`, `vite`, `postcss`).
- [ ] Пройти отдельно по зависимостям Edge Functions в `supabase/functions/deno.lock`.
- [ ] Перенести `@eslint/eslintrc` и `@playwright/test` в `devDependencies`.
- [ ] Сверить итог с Dependabot и перечислить здесь всё, что осознанно оставлено.

## Decision Log

- Decision: приоритет определяется не уровнем severity, а тем, попадает ли пакет в развёрнутое приложение.
  Rationale: пять из шести critical — инструментальные или транзитивные и в рантайме не исполняются, тогда как `next` с уровнем high затрагивает работающий продакшен напрямую. Сортировка по одному severity увела бы усилия не туда.
  Date/Author: 2026-08-20 / автор задачи
