# todozi-manage

Browser front door for Todozi on nova.

## Purpose

- expose a normal browser UI for the shared Todozi backend
- keep API keys server-side only
- make project/task capture, search, and edits feel like part of the toolkit

## Active Objectives

- Objective: ship `manage.err404memory.com` as the browser front door for Todozi on nova.
- Planned locations: `server.js`, `public/`, `deploy/`, and the `err404memory-hosts` ingress bundle.

## Current Status

- App root scaffolded.
- Browser UI and Todozi proxy routes are in place in the local checkout.
- Nova install, host ingress, and DNS validation still need to be applied.

## Session Log

### 2026-05-13 — AO bootstrap failure traced

- What changed: Checked the local AO config and git state after startup failed with `Unable to resolve base ref for default branch "main"`.
- Current status: This checkout has `No commits yet on main`, and the host cannot resolve `github.com`, so AO cannot finish its branch/base-ref detection.
- Remaining blockers or next steps: Create the first commit or restore GitHub DNS/network, then rerun `ao start` or `ao update`.

### 2026-05-13 — Browser front door scaffolded

- What changed: Created a self-contained Node browser app for Todozi with server-side
  proxying, a project list, task list, search, quick create, and a task detail editor.
- Current status: The local app now has the right shape for `manage.err404memory.com`.
- Remaining blockers or next steps: Sync the app to nova, add the hostname to the
  `err404memory-hosts` ingress stack, and start the user service on nova.
