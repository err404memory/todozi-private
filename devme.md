# todozi-manage

Browser front door for Todozi on satellite. (Nova originally hosted this; it has been down
for an extended, indefinite period, so satellite is now the sole target — see deploy/.)

## Purpose

- expose a normal browser UI for the shared Todozi backend
- keep API keys server-side only
- make project/task capture, search, and edits feel like part of the toolkit

## Active Objectives

- Rename/relocate: once the 2a redesign lands, this app is slated to be spun out of
  `todozi-private` into its own repo under its own name (working name: Slated — see the
  `slated`-tagged idea below), no longer branded as Todozi. Todozi stays as the backend
  data source; this UI becomes a distinct product on top of it. Not scheduled yet — do
  this after PR #1 merges, not as part of it.
- **Offline-first local copy + sync (planned, real requirement, not optional).** The whole
  app currently has a hard dependency on one always-on machine (satellite, previously nova)
  being reachable — when that machine is down, which has happened for weeks/months at a
  time, task capture/editing is unavailable for the whole outage and in-progress work gets
  abandoned. The fix is a genuine offline-first client: local storage of tasks/steps/refs on
  the device, full read/write while disconnected, and sync-on-reconnect against the real
  Todozi backend. This is a substantial feature — it needs a conflict-resolution strategy for
  edits made offline on multiple devices, not just a cache — so treat it like `doorman` was
  treated: a real design pass (what gets stored locally, what the sync/merge protocol is,
  what happens to server-only concepts like git status and file refs while offline) before
  any implementation, rather than bolting it onto the existing redesign PR. Not started.
  Explicitly ruled out as unnecessary for now: public internet exposure via Tailscale Funnel
  (the operator is never on someone else's devices, so Tailscale-only access is sufficient
  once reachable at all) — offline support is the actual problem, not more reachability.

## Current Status

- App root scaffolded.
- Browser UI and Todozi proxy routes are in place in the local checkout.
- Satellite service is active at `http://100.115.124.101:3044`, proxying to
  `todozi.service` at `http://100.115.124.101:8636`.
- Project display derives missing project names from `/tasks`, because Todozi's raw
  `/projects` endpoint currently reports only `general`.
- The browser UI is now the "2a" design: modes/filters collapsed into one query line, a
  first-class grouping axis (project/urgency/priority/status/tag), and object-permanence
  fold rules (folded/deleted rows leave a residue or tombstone in place instead of
  disappearing). The old Projects/Tasks/Done/Find/More/API/Feed mode tabs and separate
  status/priority/project filter form are gone; the existing capture forms and platform
  resource browser are still there, behind Capture/Platform toggle buttons in the left rail.
- Task steps are exposed through local manage routes backed by
  `/home/ash/.todozi/steps/*.json`.
- Ideas are exposed through local manage fallback records in `/home/ash/.todozi/ideas/*.json`
  because Todozi's native idea commands are currently stubs and the backend idea write route
  times out.
- Path refs (`{path, line?, kind}`) are exposed the same way through
  `/home/ash/.todozi/refs/*.json`. Real git status (branch, last commit matching the task
  id, ahead/behind, dirty count) and read-only file peek are wired to actual `git`/filesystem
  calls, scoped per-project via `/home/ash/.todozi/repo-map.json` (`{ "project-name":
  "/abs/path/to/repo" }`, not created automatically — add project entries there to turn git
  integration on for a project; unconfigured projects just say "no repo configured").
- Task delete is now a soft delete (`status: "deleted"`) instead of the real backend
  `DELETE`, so the tombstone row's "undo" is fully reliable. Deleted tasks are filtered out
  of every view and only reappear as a struck-through tombstone with an "undo" button.
- Visible task rows include interactive checkboxes that toggle Todozi task status between
  `todo` and `done`.

## Session Log

### 2026-08-12 — 2a design implemented: axis switcher + object permanence

- What changed: Implemented the "2a" screen from the `Layout and progressive disclosure`
  Claude Design handoff. Replaced the mode-tab/filter-form header with a top bar (search
  omnibar with `/task`, `/idea`, `/err`, `/queue` capture prefixes, queue/error counts, sync
  indicator) and an axis/fold toolbar (group-by chips for project/urgency/priority/status/tag,
  fold-rule chips for done/later/low priority, fold all/unfold all).
- What changed: Rebuilt the task list as a grouped stream: group headers carry a
  count/summary/priority-mix-bar/percent-done and a per-group expand-rows toggle. Fold rules
  never delete rows — hidden items collapse into a dashed "N folded here" residue row with
  the reasons and first few titles, revealed in place on click. Row state (axis, folded
  groups, hide rules, revealed residues, expanded rows, manual drag reorder, saved views,
  delete tombstones) persists in `localStorage` across reloads.
- What changed: Task rows expand inline to show a steps checklist, the note with `task_*`
  ids autolinked (click to jump to that task), path refs as chips with an on-demand read-only
  peek (new `GET /api/tasks/:id/refs/peek`), and a real git status line (new
  `GET /api/tasks/:id/git`, shelling `git branch`/`git log --grep=<id>`/`git status
  --porcelain` via `execFile`, scoped to a repo path from `~/.todozi/repo-map.json`).
- What changed: Dragging a row onto another row's body creates a dependency
  (block/blocked-by) via the existing task PUT route; dragging onto a row's top ~30% instead
  reorders within the group (client-side order override, not a new backend field) — the two
  drop zones render with visibly different highlights so one can't be mistaken for the
  other. Blocked rows show a permanent "blocked by …" line with an unlink action.
- What changed: Delete is now a two-step flow: an inline (non-modal) impact preview in the
  detail pane listing what depends on the task, what it depends on, and which notes mention
  it, with "Delete and unlink" and (when relevant) "Delete and pass its blocker down".
  Delete itself became a soft delete (`status: "deleted"` via the existing task PUT route,
  not the real backend `DELETE`) so the resulting tombstone row's "undo" reliably restores
  both the task and every dependent's link, snapshotted client-side.
- What changed: Added a `refs` local JSON store (`~/.todozi/refs/*.json`, mirrors the
  existing `steps`/`ideas` pattern) plus `GET/PUT /api/tasks/:id/refs`,
  `GET /api/tasks/:id/refs/peek`, and `GET /api/tasks/:id/git` routes in `server.js`. Peek
  reads are path-traversal-guarded to the configured repo root; git/peek both no-op
  gracefully ("no repo configured") when a project has no `repo-map.json` entry.
- What changed: Existing capture forms (idea/memory/error/queue/training, plus quick task
  create) and the platform-resource browser (agents/memories/errors/etc.) were kept
  unchanged and moved behind new Capture/Platform toggle buttons in the left rail instead of
  being removed.
- Current status: `node --check server.js` and `node --check public/app.js` passed. Ran the
  app against a local stub Todozi backend and a scratch git repo (never against the real
  nova deployment or real `~/.todozi` data). A headless-browser pass covering axis
  switching, fold/residue rows and their reload-persistence, real git-branch/commit display
  for a configured repo vs. "no repo configured" for an unconfigured one, real file peek,
  drag-to-block vs. drag-to-reorder (distinct zone highlighting, verified via dispatched
  `DragEvent`s since Playwright's mouse emulation doesn't fire native HTML5 drag events),
  delete-impact preview, unlink + tombstone + undo (including that undo survives a reload),
  omnibar `/task` capture, and the Capture/Platform panel toggles all passed (27/27 checks).
- Remaining blockers or next steps: `~/.todozi/repo-map.json` doesn't exist yet on nova, so
  every project will show "no repo configured" until entries are added for the real repo
  paths. Attachments (non-repo files) still need a manual drop-in under
  `~/.todozi/attachments/<task_id>/` plus a path ref pointing at it — no upload widget was
  built, to avoid adding a dependency to an otherwise zero-dependency app. Manual row
  reordering is view-local (per axis/group, in `localStorage`) rather than a backend field.
  27/27 headless checks passing covers UI interaction only, not the full PR: manual backend
  smoke testing against a real Todozi/nova deployment is still outstanding, and a structured
  code review found 18 issues not yet triaged at the time those checks ran (some have since
  been fixed on top of this entry — see PR #1 for current status), including the keyboard
  `Enter` expand shortcut extracting the wrong id, task-step data never refreshing after the
  first load, ref counts not populating on collapsed rows, an unawaited-fetch race in the
  delete-impact preview, and `dependentsOf` driving an O(n²) render on large task lists.

### 2026-08-11 — Wrapped titles, toggled sub-actions, and stronger hierarchy

- What changed: Changed the selected-task inline title editor from a single-line input to
  an auto-growing textarea so long task titles wrap inside the task data panel while still
  saving through Todozi's existing `action` field.
- What changed: Updated task-card clicks so selecting a different card opens its
  sub-actions, while clicking the already-selected card toggles its sub-action panel
  closed or open.
- What changed: Tightened the dense UI further and added stronger hierarchy cues: panel
  headers now read as section bars, selected cards/detail headings use left rules, nested
  notes/steps/dependencies/fields have grouped backgrounds, and repeated card spacing is
  smaller.
- Current status: `node --check public/app.js` and `node --check server.js` passed.
  Restarted `todozi-manage.service`; `/api/health` returned OK. Headless browser
  verification confirmed the title editor is a wrapping textarea, long titles do not
  overflow the panel, repeated card clicks open/close/open sub-actions, and the tighter
  hierarchy styles are applied.
- Remaining blockers or next steps: None for this UI pass.

### 2026-08-11 — Inline title editing and compact scan density

- What changed: Replaced the selected-task title button plus separate action textarea with
  an inline editable task-title input that still submits the Todozi `action` field through
  the existing Save Task form.
- What changed: Removed Start Timer and Stop Timer controls from the selected-task panel
  and deleted the now-unused client handlers. Dependency add still uses the queried
  existing-task datalist and now prompts `Search task id`.
- What changed: Tightened the active browser shell density: smaller task/project/resource
  cards, reduced panel padding and row gaps, smaller metadata/field/dependency controls,
  and a more compact selected-task panel.
- Current status: `node --check public/app.js` and `node --check server.js` passed.
  Restarted `todozi-manage.service`. Headless browser verification confirmed no
  `.action-editor`, no timer action buttons, inline title editing updates
  `FormData(action)` without saving during the probe, dependency lookup exposes 25 task
  options, and rendered card/panel padding is compact.
- Remaining blockers or next steps: Save Task remains the explicit persistence action for
  edited titles and dependency add/remove changes.

### 2026-08-11 — Selected-task title, completion, tags, and dependencies refined

- What changed: Removed the static `Selected task` panel header. The selected task now
  renders its own title inside the panel; clicking that title focuses and selects the
  editable action textarea.
- What changed: Removed the Mark Done button and added a synced completion checkbox in the
  top-right of the selected-task panel. The panel checkbox and main task-card checkbox use
  the same task update path and stay in sync after refresh.
- What changed: Moved tags into the compact metadata strip and redesigned dependencies as
  row-based dependency controls with add/remove behavior and checkbox-style status for
  matched dependency tasks.
- Current status: `node --check public/app.js` and `node --check server.js` passed.
  Restarted `todozi-manage.service`. Headless browser verification confirmed the static
  header is absent, title click focuses the editor, completion toggles sync between panel
  and card, the Mark Done button is absent, tags are in the metadata row, and dependency
  add/remove updates the hidden saved field. The test task was restored to `done` with
  progress `100` and no dependencies.
- Remaining blockers or next steps: Dependency rows can toggle matched dependency task
  status, but dependency edits still require Save Task to persist add/remove changes.

### 2026-08-11 — Readable fields and compact metadata controls

- What changed: Replaced raw JSON display in selected-task details and platform resource
  cards with closed-by-default `Fields in use` disclosures that show human-readable
  key/value rows while preserving the exact field names.
- What changed: Moved the task action textarea to the top of the selected-task form under
  the title, metadata, and tags. Replaced large project/priority/status inputs with
  compact ghosted option selectors that update the existing hidden form fields.
- Current status: `node --check public/app.js` and `node --check server.js` passed.
  Restarted `todozi-manage.service`. Headless browser verification found zero `<pre>` raw
  JSON blocks, 24 closed field disclosures, 23 platform resource field disclosures, three
  closed metadata selectors, and the action textarea as the first visible detail control.
- Remaining blockers or next steps: Time and progress remain compact inline inputs rather
  than option-list selectors because they do not yet have a stable finite option set.

### 2026-08-11 — Task notes and checkable sub-actions refined

- What changed: Moved task notes onto task cards as visible summaries, made task-card
  clicks automatically open the collapsible sub-action panel, and changed saved steps from
  ordered display items into checkable subtasks.
- What changed: Updated step persistence to accept both legacy string steps and newer
  `{ text, done }` step records, preserving existing plain step files while allowing
  subtask checkbox state to persist.
- Current status: `node --check public/app.js` and `node --check server.js` passed.
  Restarted `todozi-manage.service`. Headless browser verification confirmed
  `task_fa2d73cd` shows its task note, card click opens five sub-actions, a subtask
  checkbox persists and was restored, and the disclosure marker collapses the panel.
- Remaining blockers or next steps: The side-panel step editor remains line-based; it
  preserves checked state for unchanged step text but does not yet expose checkbox editing
  inside the editor itself.

### 2026-08-11 — Collapsible task-card steps added

- What changed: Added collapsible steps panels to visible task cards in `public/app.js` and
  `public/styles.css`. Each card now has a steps toggle that lazy-loads the existing
  `/api/tasks/:id/steps` record and shows the saved implementation summary and ordered
  step list inline.
- Current status: `node --check public/app.js` and `node --check server.js` passed.
  Restarted `todozi-manage.service`. Headless browser verification expanded
  `task_fa2d73cd`, loaded its five saved steps, collapsed the panel, and selected the task
  normally.
- Remaining blockers or next steps: Existing tasks without saved steps show an empty-state
  prompt; richer AI-generated step suggestions can be added later as a separate write path.

### 2026-08-11 — Completion controls restored

- What changed: Fixed checkbox, Mark Done, and Save Task writes by routing
  `PUT /api/tasks/:id` through a local Todozi task-store updater before falling back to
  the hanging upstream HTTP update route.
- Current status: `node --check server.js` and `node --check public/app.js` passed.
  Restarted `todozi-manage.service`. Verified in a headless browser that a visible task
  checkbox changed `task_5ccd8c5f` from `done` to `todo`, then Mark Done changed it back to
  `done`; final bootstrap status is `done` with progress `100`.
- Remaining blockers or next steps: The upstream `tdz`-owned `PUT /tasks/:id` route still
  times out, so the manager uses local store writes for task updates while that backend
  route remains unreliable.

### 2026-08-11 — Task-card reselection fixed

- What changed: Fixed task-card selection in `public/app.js` by rebinding task card and
  checkbox handlers after the task list re-renders from a card click.
- Current status: `node --check public/app.js` passed. A headless browser clicked four
  different visible task cards through `http://100.115.124.101:3044`, and the side-panel
  heading updated to each selected task.
- Remaining blockers or next steps: A future cleanup can replace manual rebinding with
  delegated list-level click handling.

### 2026-08-11 — Chat highlights moved onto Clipboard

- What changed: Added interactive checkboxes to visible task cards in `public/app.js` and
  `public/styles.css`, using the existing task update route to toggle tasks between `todo`
  and `done`.
- What changed: Captured the chat highlights into Slated/Clipboard state. Added 6 active
  `slated` project tasks covering the record taxonomy, backend-backed FrankenTUI, agent
  logging contract, Ollama/Open WebUI provider lane, local persistence hardening, and
  release/name boundary checks.
- What changed: Added 4 categorized local idea records for the SynapseFS/Slated boundary,
  Slated surface design, AI provider plan, and backend write-path caveat.
- Current status: `todozi-manage.service` is active at `http://100.115.124.101:3044`.
  Verified `/api/bootstrap` reports 12 projects and 26 tasks, including 6 `slated` tasks.
  Verified `/api/platform` reports 6 ideas, including 5 Slated records. A tall screenshot
  confirmed the task checkboxes render in the visible task list.
- Remaining blockers or next steps: Task updates still depend on Todozi backend write
  responsiveness; backend timeout handling was hardened so manager-level async failures
  return an error instead of exiting the Node process.

### 2026-08-11 — Slated idea captured

- What changed: Added local idea persistence in `server.js`. `POST /api/ideas` now writes a
  local JSON idea record under `/home/ash/.todozi/ideas/`, and `/api/platform` merges local
  ideas with any backend ideas returned by Todozi.
- What changed: Captured `Slated working name` as a private, medium-importance product idea
  tagged `slated`, `naming`, `product-direction`, `todozi-derived`, and
  `mother-clipboard`.
- Current status: `todozi-manage.service` is active at `http://100.115.124.101:3044`;
  `/api/platform` returned 2 ideas total and includes the Slated record.
- Remaining blockers or next steps: Todozi's native `tdz idea create/list` commands still
  report that the feature is coming soon. The previous backend `/ideas` write timed out and
  restarted the manager before this local fallback was added.

### 2026-08-11 — TUI parity pass and backend wrapper

- What changed: Reworked the browser UI into a dense Todozi shell matching Ash's screenshot:
  mode tabs for Projects, Tasks, Done, Find, More, API, and Feed; a filter strip; mode-aware
  panels; and task step viewing/editing in the selected-task panel.
- What changed: Added `deploy/run-satellite-todozi.sh` plus
  `deploy/todozi-satellite.service`, and pointed
  `/home/ash/.config/systemd/user/todozi.service` at it so the systemd backend waits when
  the `tdz` TUI already owns `100.115.124.101:8636` instead of crash-looping.
- Current status: `todozi.service` is active/enabled as the waiting backend wrapper,
  `todozi-manage.service` is active/enabled at `http://100.115.124.101:3044`, and
  `todoziview.service` remains inactive/disabled. Verified `node --check` for server/app
  JavaScript, manage `/api/health`, step retrieval for `task_fa2d73cd`, and desktop/mobile
  headless screenshots.
- Remaining blockers or next steps: Todozi backend `/errors` and `/backups` still return
  errors through the proxy. Satellite user systemd is logging inotify watcher exhaustion
  separately from Todozi.

### 2026-08-10 — Platform surface restored on satellite

- What changed: Re-enabled `todozi-manage.service` and expanded the browser UI beyond the
  earlier tasks/queue/search slice. The UI now fetches broader Todozi platform resources:
  agents, available agents, memories, memory types, ideas, errors, training data,
  training stats, chunks, ready chunks, chunk graph, task analytics, agent analytics,
  performance, time report, and backups where the backend endpoint responds.
- What changed: Added quick capture forms for ideas, memories, errors, queue plans, and
  training pairs, plus task time start/stop controls in the selected-task panel.
- Current status: `todozi-manage.service` is active/enabled at
  `http://100.115.124.101:3044`; `todoziview.service` was disabled because it only
  mirrored a thin status slice. Verified manage proxy counts: 11 derived projects, 20
  tasks, 23 agents, 1 memory, and 1 idea.
- Remaining blockers or next steps: Todozi backend `/errors` and `/backups` currently
  return errors through the proxy. The terminal/TUI path still needs to be rebuilt as a
  backend-backed Todozi command palette rather than a direct JSON-store clone.

### 2026-08-10 — Satellite manage fallback enabled

- What changed: Added `deploy/run-satellite-manage.sh` and
  `deploy/todozi-manage-satellite.service`, then installed the service as
  `/home/ash/.config/systemd/user/todozi-manage.service`.
- Current status: `todozi-manage.service` is active and enabled on satellite at
  `http://100.115.124.101:3044`, pointing at the satellite Todozi backend at
  `http://100.115.124.101:8636`. `/api/health` passed and `/api/bootstrap` returned 1
  project, 20 tasks, and 0 queue items.
- Remaining blockers or next steps: The manage UI is only protected by private tailnet
  reachability right now. Add browser-level auth before exposing it through a public
  domain or non-tailnet route.

### 2026-08-10 — Satellite manage fallback disabled

- What changed: Disabled and stopped `todozi-manage.service` after live comparison showed
  it was not the `tdz` TUI Ash remembered and its `/api/projects` view returned only
  `general`.
- Current status: The service template and launcher remain in `deploy/` as reference
  artifacts, but the running browser front door is inactive/disabled.
- Remaining blockers or next steps: Do not revive this UI as the Todozi entry point
  unless it is rebuilt around the same store the chosen canonical Todozi surface uses.

### 2026-05-13 — AO bootstrap failure traced

- What changed: Checked the local AO config and git state after startup failed with `Unable to resolve base ref for default branch "main"`.
- Current status: This checkout has `No commits yet on main`, and the host cannot resolve `github.com`, so AO cannot finish its branch/base-ref detection.
- Remaining blockers or next steps: Create the first commit or restore GitHub DNS/network, then rerun `ao start` or `ao update`.

### 2026-05-13 — Browser front door scaffolded

- What changed: Created a self-contained Node browser app for Todozi with server-side
  proxying, a project list, task list, search, quick create, and a task detail editor.
- Current status: The local app now has the right shape for `manage.err404memory.com`
  and the live hostname is serving it.
- Remaining blockers or next steps: None for the browser front door itself. Keep
  iterating on capture/search/task-edit behavior as needed.

### 2026-05-13 — Browser front door made live

- What changed: Wired the manage app into the real Zane route on nova and fixed the
  deployment-service proxy config so `manage.err404memory.com` now serves the Todozi
  UI instead of the fallback page.
- Current status: `https://manage.err404memory.com` is live and points at the shared
  Todozi backend on nova.
- Remaining blockers or next steps: None for the ingress path. Future work is feature
  work inside the manage app.

### 2026-05-13 — Temporary proxy helpers removed

- What changed: Removed the extra debugging proxy services that were created while
  tracing the ingress mismatch.
- Current status: Only the live Zane-managed deployment service remains, and the public
  hostname still returns the manage app.
- Remaining blockers or next steps: None.
