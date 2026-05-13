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
    todozi-manage.service
    todozi-manage.env.example
  sync-to-nova.sh
  devme.md
```

## Local run

```bash
cd /home/ash/storage/service-wing/engine-room/todozi-manage
MANAGE_HOST=127.0.0.1 MANAGE_PORT=3044 npm start
```

## Deploy target

- Host: `nova`
- Browser hostname: `manage.err404memory.com`
- Backend: `http://100.75.128.38:8636`
- Nova bind: `100.75.128.38:3044`
- The production service can reuse the Todozi bot env file on nova, so the browser front
  door shares the validated Todozi keys instead of duplicating them.

## Notes

- Todozi keys stay in `deploy/todozi-manage.env` on nova.
- The manage app only forwards requests server-side; the browser never sees the Todozi API key.
