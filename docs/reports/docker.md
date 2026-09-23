# Docker: конфигурация подготовлена; запуск требует Docker Engine

ROLE: Docker

BASE_SHA: a787aaae885e6b45e8203ac09c9d67692b5388c7

BRANCH: parallel/docker

Дата проверок: 23.09.2026, около 16:38–16:49 UTC+05:00.

Полностью прочитаны `AGENTS.md` и `docs/EKT_PARALLEL_TASKS.md`. Работа выполнена только в worktree `ekt-docker`. Общие файлы, зависимости и lock-файл не изменены. До изменений выполнен `npm ci`.

## Изменённые файлы

- `Dockerfile`
- `docker-compose.yml`
- `.dockerignore`
- `scripts/docker/start.mjs`
- `scripts/docker/healthcheck.mjs`
- `scripts/docker/check-start.mjs`
- `docs/reports/docker.md`

## Подтверждённые проблемы и исправления

Проблемы конфигурации установлены чтением исходных файлов; запуск исходного контейнера не был возможен.

1. Исходный `CMD` выполнял `npm run catalog:sync & npm run start`: сервер запускался независимо от окончания и результата индексации. Теперь один Node-процесс последовательно запускает синхронизацию и Next. Ошибка синхронизации сохраняет ненулевой exit code и предотвращает запуск HTTP. Ошибка сервера завершает supervisor; автоматического повторения и бесконтрольной фоновой индексации нет. Сообщение о завершении синхронизации появляется только после её успешного выхода и не утверждает полноту live-каталога.
2. `SIGTERM`/`SIGINT` передаются текущему дочернему Node-процессу; supervisor ждёт его завершения. Compose использует `init: true` и `stop_grace_period: 30s`. POSIX-проверки включены в Docker build, но на текущем Windows-хосте пропущены. Фактическая остановка контейнера ещё не подтверждена.
3. Исходный том перекрывал весь `/app/data`, где находятся поставляемые `data/fixtures`. Теперь он монтируется только в `/app/storage`, а `DATABASE_PATH=/app/storage/app.sqlite` задан в Compose и как default образа. Fixtures копируются из нового образа в `/app/data/fixtures`; содержимое старого тома не перекрывает их. При повторном старте нужно сохранять DATA_MODE: существующий `ensureMode()` очищает сессии и корзины при переключении live/demo.
4. Внешний порт параметризован `${APP_PORT:-3000}:3000`. Все worker-проверки используют APP_PORT=3002 и проект `ekt-docker-worker`. Compose вычисляет отдельный именованный том `ekt-docker-worker_ekt_data`; явного общего `name` и `container_name` нет. Том фактически не создан, поскольку Engine недоступен.
5. В build-стадии добавлены Python, make и g++ для fallback-сборки native-модуля, если prebuilt binary недоступен. Сохранён Node 22 bookworm-slim и зависимости из lock: Next 16.3.6, better-sqlite3 12.4.1, tsx 4.23.15. Обе стадии используют одну базовую платформу. В финальной стадии добавлен SQL-запрос к `:memory:` через better-sqlite3 с загрузкой tsx и разрешением Next/TypeScript. Это проверка, которую выполнит будущая Docker-сборка, а не уже полученный результат Linux.
6. Runtime сохраняет node_modules с dev dependencies, потому что текущие команды требуют tsx и TypeScript для `next.config.ts`. Build toolchain остаётся в build-стадии; runtime работает от пользователя `node`. Копируются конкретные runtime-файлы, а не весь `/app` со случайно созданными при сборке данными. Каталог `public` создаётся при сборке, поскольку сейчас его нет в репозитории.
7. `.dockerignore` исключает локальные node_modules/.next, Git, env-файлы, SQLite/WAL и DB-файлы, uploads, изменяемые data/storage, тестовые артефакты и документацию. `data/fixtures` остаётся частью образа. Ключи передаются через runtime `env_file`, build args для них отсутствуют. Фактический состав Linux-образа пока не проверен.
8. Healthcheck использует встроенный Node fetch, без curl: HTTP 2xx, `ok`, `ready` и непустой каталог. До завершения синхронизации HTTP-сервер не запускается. Healthcheck не утверждает, что live-каталог выгружен полностью (`complete` может оставаться false).

Использованы локальные Next.js guides: `01-app/01-getting-started/17-deploying.md`, `01-app/02-guides/self-hosting.md` и раздел `next start` в `01-app/03-api-reference/06-cli/next.md`.

## Тесты/команды и фактический результат

Хост: Windows amd64, Node v20.20.0 из установленного NVM. Это отличается от Linux/Node 22 в Dockerfile.

| Команда / проверка | Результат |
| --- | --- |
| `npm ci` | Exit 0: 465 пакетов, npm audit сообщил 0 уязвимостей. В песочнице NVM недоступен; установка выполнена с разрешённым повышением доступа. |
| `docker version` вне песочницы | Exit 1; Docker Client 28.4.0, context `desktop-linux`; Engine недоступен, диагностика ниже. |
| `APP_PORT=3002 docker compose -p ekt-docker-worker config --quiet` | Exit 0; статическая проверка, без обращения к Engine. Здесь и далее синтаксис назначения env сокращён; PowerShell-команды приведены ниже. |
| Проверка Compose JSON с выводом только разрешённых полей | Подтверждены project `ekt-docker-worker`, published port `3002`, volume `ekt-docker-worker_ekt_data`, mount `/app/storage`, DATABASE_PATH `/app/storage/app.sqlite`. Секреты не выводились и не сохранялись. |
| `docker compose --env-file .env.example -p ekt-docker-worker config --format json` с тем же ограничением вывода | При отсутствии APP_PORT в окружении и файле интерполяции default — 3000. Первоначальная проверка с локальным `.env` увидела его worker-переопределение 3002; затем default проверен отдельно. Контейнер на 3000 не запускался. |
| `node --test scripts/docker/check-start.mjs` | 3 passed, 0 failed, 2 skipped. Реальные дочерние процессы: правильная последовательность; exit 7 индексации без старта сервера; exit 9 сервера без restart loop. SIGTERM-тесты пропущены на Windows. |
| Локальный `node --import tsx -e ...` | better-sqlite3 открыл `:memory:`, SELECT 1 вернул `{ ok: 1 }`; Next CLI и TypeScript разрешились. Это Windows binding. |
| `npm test` | 5 suites, 22 tests passed, exit 0. |
| `npm run lint` | Exit 0. |
| `npm run typecheck` | Exit 0, Next route types сгенерированы. |
| `npm run build` | Exit 0, Next 16.3.6/Turbopack, 10/10 static pages. DATA_MODE=demo, DATABASE_PATH=./data/docker-build.sqlite, APP_BASE_URL=http://localhost:3002. Выполнен после typecheck. |
| `node --import tsx scripts/sync-catalog.ts`, дважды | Оба exit 0, 4 demo-товара, mode demo, complete false; updated_at не изменился при втором запуске. Отдельная локальная DATABASE_PATH=./data/docker-runtime.sqlite, синхронизация 23.09.2026 11:48:40 UTC. |
| `node --check scripts/docker/healthcheck.mjs` | Exit 0; только синтаксис, HTTP healthcheck не запускался. |
| `git diff --check`; `git check-ignore .env data/docker-build.sqlite` | Exit 0; env и локальная БД исключены из Git. |

При первом запуске `npm test` новый Node test-файл назывался `start.test.mjs`, из-за чего Vitest попытался принять его за свой suite и завершился с ошибкой (22 существующих теста прошли). Файл переименован в `check-start.mjs`; повторный Node test и полный Vitest завершились с результатами из таблицы. Общий test config не менялся.

Первая попытка `docker version` из песочницы также сообщала отказ доступа к Docker config и отсутствие default pipe. Для точной диагностики выполнена одна повторная проверка вне песочницы; дальнейших попыток подключения, установки или перезапуска Docker не было:

```text
Context: desktop-linux
error during connect: Get "http://%2F%2F.%2Fpipe%2FdockerDesktopLinuxEngine/v1.51/version":
open //./pipe/dockerDesktopLinuxEngine: The system cannot find the file specified.
```

## Live-проверки: что именно, когда, на каких входах

Внешние EKT/OpenAI API и реальные пользовательские входы не проверялись. 23.09.2026 локальная demo-синхронизация использовала только четыре поставляемые fixtures; API-кредиты не расходовались. Контейнерные HTTP/browser-проверки не проводились.

## Что НЕ проверено и почему

Из-за недоступного Engine не выполнены Docker build, Linux native-сборка и загрузка better-sqlite3, пять lifecycle-тестов внутри Linux, работа пользователя `node` с новым томом, HTTP healthcheck, поиск/подтверждение корзины из контейнера, доставка сигналов и сохранение cookie-сессии/корзины после stop/start. Локальный успешный production build не заменяет сборку контейнера. Выдавать эту ветку за пройденную контейнерную приёмку нельзя.

После появления Engine, из этого worktree в PowerShell:

```powershell
# Локальный .env: DATA_MODE=demo, APP_BASE_URL=http://localhost:3002.
# Не печатать .env или полный вывод compose config.
$env:APP_PORT = '3002'
docker compose -p ekt-docker-worker config --quiet
docker compose -p ekt-docker-worker build
docker compose -p ekt-docker-worker up -d --wait --wait-timeout 180
$env:APP_BASE_URL = 'http://localhost:3002'
node scripts/smoke-http.mjs
```

Эти Docker build/up/smoke-команды здесь **не выполнялись**. Для первой контейнерной проверки нужен новый worker-том. Если он уже существует, сначала проверить его владельца и содержимое; не удалять автоматически и не использовать чужую БД.

Отдельная оставшаяся приёмка сохранности: создать новую cookie-сессию, выполнить поиск DEMO-AV16, создать предложение productId=1001/quantity=2, убедиться в пустой корзине до confirm, подтвердить и сохранить ответ `/api/cart` и cookie в памяти клиента. Выполнить `docker compose -p ekt-docker-worker stop app`, затем `docker compose -p ekt-docker-worker start app`, дождаться healthy и сравнить `/api/cart` с прежней cookie. DATA_MODE и именованный том сохраняются. `scripts/smoke-http.mjs` сам удаляет добавленную позицию в конце, поэтому его результат не доказывает сохранность корзины после рестарта. Не применять `down -v` или prune.

## INTEGRATION_REQUEST

Нет необходимых правок общих исходных файлов. Новый DATABASE_PATH согласован между Dockerfile и Compose; схема БД не изменена. Координатору нужно перенести подтверждённые результаты и ограничения в общий README/acceptance после интеграции, а контейнерную приёмку выполнить при доступном Engine. `AGENTS.md`/`CLAUDE.md` не изменились. Push не выполнялся.
