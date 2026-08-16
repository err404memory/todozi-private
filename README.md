# todozi-manage

Browser front door for the shared Todozi backend.

## Purpose

- show Todozi projects and tasks in a browser
- keep Todozi auth headers on the server side
- make task capture, search, and editing easier from phone or laptop

## Layout

```text
todozi-manage/
  server.js
  package.json
  public/
    index.html
    app.js
    styles.css
  deploy/
    manage-nginx.conf
    todozi-manage.env.example
    todozi-manage.service              (nova, legacy — nova is down indefinitely)
    todozi-manage-satellite.service    (satellite — current)
    todozi-satellite.service           (satellite — runs the Todozi backend itself)
    run-satellite-manage.sh
    run-satellite-todozi.sh
  sync-to-nova.sh
  devme.md
```

## Local run

```bash
cd /home/ash/storage/service-wing/engine-room/todozi-manage
MANAGE_HOST=127.0.0.1 MANAGE_PORT=3044 npm start
```

## Deploy target

- Host: `satellite` (`100.115.124.101`). Nova (`100.75.128.38`) hosted this originally but
  has been down for an extended, indefinite period — everything here now targets satellite.
- Browser hostname: `manage.err404memory.com`
- Backend: `http://100.115.124.101:8636`
- Satellite bind: `100.115.124.101:3044`
- Use `deploy/todozi-manage-satellite.service` + `deploy/run-satellite-manage.sh` and
  `deploy/todozi-satellite.service` + `deploy/run-satellite-todozi.sh` — these already default
  to satellite's IP. `deploy/todozi-manage.service` is the older nova-targeted unit, kept for
  reference only.
- The production service can reuse the Todozi bot env file on satellite, so the browser front
  door shares the validated Todozi keys instead of duplicating them.

## Notes

- Todozi keys stay in `deploy/todozi-manage.env` on satellite.
- The manage app only forwards requests server-side; the browser never sees the Todozi API key.
- **Known reliability gap:** this whole setup depends on one always-on machine (previously
  nova, now satellite) being reachable. When that machine has been down for extended periods,
  the app — and Todozi access generally — becomes unreachable for the duration. An offline-first
  client with local storage and sync-on-reconnect is planned to remove this single point of
  failure; see `devme.md`.
