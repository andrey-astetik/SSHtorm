# SSHtorm

*English first · [Русская версия ниже](#русская-версия)*

Desktop SSH client built on Electron. Connect to a server and work with it through a windowed interface: terminals, an SFTP file browser, a text editor, a Docker panel, port forwarding and a browser tunnelled through the connection. Multiple sessions to different hosts can be open at once.

The usual setup is separate apps — a terminal, an SFTP client, a browser — none of them tied to a session. Work several servers at once and you're jumping not only between those windows but between per-host tabs inside each. Here every tool is bound to its session, so one host's terminal, files and Docker stay together. And it all runs over SSH/SFTP on the client side — nothing is installed on the server, so editing a config doesn't mean `vi` on the box.

## Features

- Multiple SSH sessions to different hosts at the same time.
- Terminal over SSH (xterm.js, WebGL renderer), multiple at once.
- SFTP file browser: navigation, open a terminal in a folder, chmod (checkbox matrix or octal) and chown, optional recursive.
- Text editor for remote files over SFTP, syntax highlighting, save with `Ctrl+S`.
- Docker: list/start/stop/restart/remove containers and images, live CPU/mem, `docker logs -f` and `docker exec` as terminal tabs. Runs over the SSH exec channel.
- Local port forwarding (`ssh -L`) per session.
- Browser whose traffic goes only through the session's SSH tunnel (SOCKS5 over `forwardOut`, remote DNS, no direct fallback). User-agent and timezone match the remote host.

## Security

- Host keys pinned on first connect (TOFU); a changed key drops the connection and prompts before trusting the new one.
- Hosts, passwords and key fingerprints stored in a single AES-256-GCM vault behind a master password.
- The tunnelled browser is fail-closed: no tunnel, no traffic. `file:`/`chrome:`/`devtools:` schemes and permission requests are blocked on it.

## Layout

Monorepo of two parts, wired together by the root `package.json`: the Electron main process and the Vue renderer it loads.

```
SSHtorm/
├── package.json          # dev/build scripts for both parts
├── electron/             # Electron main process
│   ├── app.js            #   window, SSH management (ssh2), IPC
│   ├── preload.js        #   contextBridge → window.app API
│   └── modules/          #   vault, crypto, socksProxy, portForward, docker, …
├── web-app/              # renderer: Vue 3 + Vite + Tailwind 4
│   └── src/
│       ├── pages/Desktop.vue
│       ├── stores/       #   windows.js, ssh.js
│       └── components/desktop/   #   Taskbar, WindowFrame, TerminalWindow,
│                                 #   FileExplorer, WebBrowser, DockerManager, …
├── docker/sshd-test/     # test sshd container + integration tests
└── docs/project.md       # IPC channels and internals
```

Renderer talks to main over IPC (`ssh.*`, `browser.*`, `forward.*`, `docker.*`). Full list in [`docs/project.md`](docs/project.md).

Stack: Electron 33, Vue 3 + Vite 7 + Tailwind 4, xterm.js, `ssh2`.

## Running

Node.js 18+. Each part has its own `package.json`:

```bash
npm install
(cd web-app && npm install)
(cd electron && npm install)
```

Development:

```bash
npm run dev            # Vite dev-server + Electron
npm run dev:web        # Vite dev-server only
npm run dev:electron   # Electron only
```

Production:

```bash
npm run build:web            # renderer → web-app/dist
npm start                    # run Electron against dist/
npm run build:electron:mac   # .dmg
npm run build:electron:win   # .exe (x64)
```

Electron bundles `web-app/dist` via `extraResources`, so build the renderer first.

## Tests

Integration tests need an sshd container:

```bash
docker build -t sshtorm-sshd docker/sshd-test
docker run -d --name sshtorm-sshd -p 2222:22 sshtorm-sshd

node docker/sshd-test/tunnel.test.js
node docker/sshd-test/hostkey.test.js
node docker/sshd-test/vault.test.js
```

---

<a name="русская-версия"></a>

# SSHtorm — Русская версия

Десктопный SSH-клиент на Electron. Подключаешься к серверу и работаешь с ним через оконный интерфейс: терминалы, файловый менеджер по SFTP, текстовый редактор, панель Docker, проброс портов и браузер, туннелированный через соединение. Можно держать открытыми несколько сессий к разным хостам одновременно.

Обычно это разные приложения — терминал, SFTP-клиент, браузер, — и ни одно не привязано к сессии. Когда работаешь с несколькими серверами сразу, скачешь не только между окнами, но и между вкладками по хостам внутри каждого. Здесь каждый инструмент привязан к своей сессии, так что терминал, файлы и Docker одного хоста держатся вместе. И всё идёт через SSH/SFTP на стороне клиента — на сервер ничего не ставится, а чтобы поправить конфиг, не нужен `vi` на самой машине.

## Возможности

- Несколько SSH-сессий к разным хостам одновременно.
- Терминал по SSH (xterm.js, WebGL-рендерер), несколько сразу.
- Файловый менеджер по SFTP: навигация, открыть терминал в папке, chmod (матрица чекбоксов или octal) и chown, опционально рекурсивно.
- Текстовый редактор для удалённых файлов по SFTP, подсветка синтаксиса, сохранение по `Ctrl+S`.
- Docker: список/start/stop/restart/remove контейнеров и образов, живой CPU/mem, `docker logs -f` и `docker exec` вкладками терминала. Работает через SSH exec-канал.
- Локальный проброс портов (`ssh -L`) на сессию.
- Браузер, трафик которого идёт только через SSH-туннель сессии (SOCKS5 поверх `forwardOut`, remote DNS, без прямого фолбэка). User-agent и часовой пояс совпадают с удалённым хостом.

## Безопасность

- Host key пиннится на первом коннекте (TOFU); при смене ключа соединение рвётся и спрашивает подтверждение.
- Хосты, пароли и отпечатки ключей лежат в одном AES-256-GCM vault под мастер-паролем.
- Туннелированный браузер fail-closed: нет туннеля — нет трафика. Схемы `file:`/`chrome:`/`devtools:` и запросы прав на нём заблокированы.

## Структура

Монорепо из двух частей, связанных корневым `package.json`: main-процесс Electron и renderer на Vue, который он загружает.

```
SSHtorm/
├── package.json          # dev/build-скрипты для обеих частей
├── electron/             # Electron main process
│   ├── app.js            #   окно, SSH-менеджмент (ssh2), IPC
│   ├── preload.js        #   contextBridge → window.app API
│   └── modules/          #   vault, crypto, socksProxy, portForward, docker, …
├── web-app/              # renderer: Vue 3 + Vite + Tailwind 4
│   └── src/
│       ├── pages/Desktop.vue
│       ├── stores/       #   windows.js, ssh.js
│       └── components/desktop/   #   Taskbar, WindowFrame, TerminalWindow,
│                                 #   FileExplorer, WebBrowser, DockerManager, …
├── docker/sshd-test/     # контейнер с тестовым sshd + интеграционные тесты
└── docs/project.md       # IPC-каналы и внутренности
```

Renderer общается с main по IPC (`ssh.*`, `browser.*`, `forward.*`, `docker.*`). Полный список — в [`docs/project.md`](docs/project.md).

Стек: Electron 33, Vue 3 + Vite 7 + Tailwind 4, xterm.js, `ssh2`.

## Запуск

Node.js 18+. У каждой части свой `package.json`:

```bash
npm install
(cd web-app && npm install)
(cd electron && npm install)
```

Разработка:

```bash
npm run dev            # Vite dev-server + Electron
npm run dev:web        # только Vite dev-server
npm run dev:electron   # только Electron
```

Production:

```bash
npm run build:web            # renderer → web-app/dist
npm start                    # запустить Electron против dist/
npm run build:electron:mac   # .dmg
npm run build:electron:win   # .exe (x64)
```

Electron упаковывает `web-app/dist` через `extraResources`, так что renderer собирается первым.

## Тесты

Интеграционным тестам нужен контейнер с sshd:

```bash
docker build -t sshtorm-sshd docker/sshd-test
docker run -d --name sshtorm-sshd -p 2222:22 sshtorm-sshd

node docker/sshd-test/tunnel.test.js
node docker/sshd-test/hostkey.test.js
node docker/sshd-test/vault.test.js
```
