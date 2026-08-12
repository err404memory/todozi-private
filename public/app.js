/* ---------- constants ---------- */

const VIEW_STATE_KEY = "todozi-manage:view-state:v1";
const MDOT = "·";

const AXES = [
  { key: "project", label: "project" },
  { key: "urgency", label: "urgency" },
  { key: "priority", label: "priority" },
  { key: "status", label: "status" },
  { key: "tag", label: "tag" },
];

const HIDE_RULES = [
  { key: "done", label: "done" },
  { key: "later", label: "later" },
  { key: "low", label: "low priority" },
];

const URGENCY_ORDER = ["Now", "Next", "Later", "Done"];
const PRIORITY_ORDER = ["urgent", "high", "medium", "low"];
const STATUS_ORDER = ["todo", "in_progress", "blocked", "done", "cancelled"];
const PRIORITY_COLORS = { urgent: "#c9452b", high: "#d98a3d", medium: "#6b3ee0", low: "#a396c9" };

const VIEWS = [
  { key: "by-project", label: "By project", axis: "project" },
  { key: "blocked-on-me", label: "Blocked on me", filter: (task) => isBlocked(task) },
  {
    key: "untriaged",
    label: "Untriaged",
    filter: (task) => formatTaskProject(task) === "general" && formatTags(task).length === 0,
  },
  { key: "shipped", label: "Shipped", filter: (task) => taskIsDone(task) },
];

const TASK_ID_RE = /\btask_[0-9a-f]{4,}\b/gi;

/* ---------- state ---------- */

const state = {
  bootstrap: null,
  platform: null,
  taskSteps: {},
  taskRefs: {},
  taskGit: {},
  peeks: {},
  openPeeks: new Set(),
  selectedTaskId: null,
  selectedProjectScope: "all",
  selectedView: "by-project",
  focusedRowKey: null,
  visibleRowOrder: [],
  confirmDeleteTaskId: null,
  message: null,
  searchQuery: "",
  searchResults: null,
  drag: null,
  savingView: false,
};

let viewState = loadViewState();
let hideRuleCursor = 0;

const elements = {};

function $(id) {
  return document.getElementById(id);
}

/* ---------- view-state persistence ---------- */

function defaultViewState() {
  return {
    axis: "project",
    foldedGroups: {},
    hideRules: { done: true, later: false, low: false },
    revealedResidues: {},
    expandedRows: {},
    groupOrder: {},
    savedViews: [],
    tombstones: [],
    showEffort: true,
  };
}

function loadViewState() {
  const base = defaultViewState();
  try {
    const raw = localStorage.getItem(VIEW_STATE_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw);
    return {
      ...base,
      ...parsed,
      hideRules: { ...base.hideRules, ...(parsed.hideRules || {}) },
    };
  } catch (error) {
    return base;
  }
}

function saveViewState() {
  try {
    localStorage.setItem(VIEW_STATE_KEY, JSON.stringify(viewState));
  } catch (error) {
    // storage unavailable (private mode, quota) — view state just won't persist
  }
}

/* ---------- generic helpers ---------- */

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatTaskProject(task) {
  return task.parent_project || task.project || task.project_name || "general";
}

function formatTags(task) {
  return Array.isArray(task.tags) ? task.tags : [];
}

function formatStatus(task) {
  return task.status || "todo";
}

function formatPriority(task) {
  return task.priority || "medium";
}

function normalizedStatus(task) {
  const status = String(formatStatus(task)).toLowerCase().replace("-", "_");
  if (status.includes("progress")) return "in_progress";
  if (status === "completed" || status === "complete") return "done";
  return status;
}

function taskIsDone(task) {
  const status = normalizedStatus(task);
  return status === "done" || status === "completed" || status === "complete";
}

function taskIsDeleted(task) {
  return normalizedStatus(task) === "deleted";
}

function statusTone(status) {
  const normalized = String(status).toLowerCase();
  if (normalized.includes("done")) return "done";
  if (normalized.includes("progress")) return "progress";
  if (normalized.includes("cancel")) return "cancel";
  return "todo";
}

function setMessage(text, kind = "info") {
  state.message = { text, kind };
  renderTaskDetail();
}

function clearMessage() {
  state.message = null;
}

function asTextList(value) {
  if (Array.isArray(value)) {
    return value.join(", ");
  }
  return value || "";
}

function normalizeStep(step) {
  if (step && typeof step === "object") {
    return {
      text: String(step.text || step.title || step.action || "").trim(),
      done: Boolean(step.done || step.completed || step.checked),
    };
  }
  return {
    text: String(step || "").trim(),
    done: false,
  };
}

function normalizeSteps(steps) {
  return Array.isArray(steps) ? steps.map(normalizeStep).filter((step) => step.text) : [];
}

function findTask(taskId) {
  return (state.bootstrap?.tasks || []).find((task) => task.id === taskId) || null;
}

function taskTitle(task) {
  return task?.action || task?.title || task?.id || "";
}

function splitList(value) {
  return String(value || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function resourceItems(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (!value || typeof value !== "object") {
    return [];
  }
  for (const key of ["items", "tasks", "memories", "ideas", "errors", "training", "agents", "chunks", "backups", "data"]) {
    if (Array.isArray(value[key])) {
      return value[key];
    }
  }
  return [value];
}

function humanizeKey(key) {
  return String(key || "")
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\s+/g, " ")
    .trim();
}

function humanizeValue(value) {
  if (value === null || value === undefined || value === "") {
    return "empty";
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "none";
    if (value.length > 12 && value.every((item) => typeof item === "number")) {
      return `${value.length} numeric values`;
    }
    return value.map(humanizeValue).join(", ");
  }
  if (typeof value === "object") {
    const keys = Object.keys(value);
    if (keys.length === 0) return "empty object";
    return keys.map((key) => `${humanizeKey(key)}: ${humanizeValue(value[key])}`).join("; ");
  }
  if (typeof value === "boolean") {
    return value ? "yes" : "no";
  }
  return String(value);
}

function renderFieldDetails(value, label = "Fields in use") {
  const entries = value && typeof value === "object" && !Array.isArray(value) ? Object.entries(value) : [["value", value]];
  return `
    <details class="field-details">
      <summary>${escapeHtml(label)}</summary>
      <div class="field-grid">
        ${entries
          .map(
            ([key, fieldValue]) => `
              <div class="field-row">
                <span class="field-key">${escapeHtml(key)}</span>
                <span class="field-value">${escapeHtml(humanizeValue(fieldValue))}</span>
              </div>
            `,
          )
          .join("")}
      </div>
    </details>
  `;
}

function renderGhostSelect(name, label, value, options) {
  const uniqueOptions = [...new Set(options.filter(Boolean))];
  return `
    <details class="ghost-select" data-meta-field="${escapeHtml(name)}">
      <summary>
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(value || "empty")}</strong>
      </summary>
      <div class="ghost-options">
        ${uniqueOptions
          .map(
            (option) => `
              <button
                type="button"
                class="${option === value ? "active" : ""}"
                data-meta-value="${escapeHtml(option)}"
              >${escapeHtml(option)}</button>
            `,
          )
          .join("")}
      </div>
    </details>
  `;
}

function renderDependencyEditor(task) {
  const dependencies = Array.isArray(task.dependencies) ? task.dependencies : [];
  const knownTasks = state.bootstrap?.tasks || [];
  const options = knownTasks
    .filter((item) => item.id !== task.id)
    .map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(taskTitle(item))}</option>`)
    .join("");

  return `
    <section class="dependency-editor">
      <input type="hidden" name="dependencies" value="${escapeHtml(dependencies.join(", "))}" />
      <div class="dependency-list" data-dependency-list>
        ${
          dependencies.length
            ? dependencies.map((dependency) => renderDependencyRow(dependency)).join("")
            : `<div class="muted">No dependencies linked.</div>`
        }
      </div>
      <div class="dependency-add">
        <input data-dependency-input list="dependency-options" placeholder="Search task id" />
        <button type="button" class="secondary" data-dependency-add>Add</button>
      </div>
      <datalist id="dependency-options">${options}</datalist>
    </section>
  `;
}

function renderDependencyRow(dependency) {
  const linkedTask = findTask(dependency);
  const done = linkedTask ? taskIsDone(linkedTask) : false;
  const status = linkedTask ? formatStatus(linkedTask) : "unmatched";
  const title = linkedTask ? taskTitle(linkedTask) : dependency;
  return `
    <div class="dependency-row ${done ? "done" : ""}" data-dependency="${escapeHtml(dependency)}">
      <label>
        <input
          type="checkbox"
          data-dependency-toggle="${escapeHtml(dependency)}"
          ${done ? "checked" : ""}
          ${linkedTask ? "" : "disabled"}
        />
        <span>
          <strong>${escapeHtml(title)}</strong>
          <small>${escapeHtml(dependency)} ${MDOT} ${escapeHtml(status)}</small>
        </span>
      </label>
      <button type="button" class="ghost-remove" data-dependency-remove="${escapeHtml(dependency)}">Remove</button>
    </div>
  `;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const detail = data?.error || response.statusText;
    throw new Error(detail);
  }

  return data;
}

/* ---------- task-relationship helpers ---------- */

function allTasks() {
  return (state.bootstrap?.tasks || []).filter((task) => !taskIsDeleted(task));
}

function openDependencies(task) {
  return (Array.isArray(task.dependencies) ? task.dependencies : [])
    .map((id) => findTask(id))
    .filter((dep) => dep && !taskIsDone(dep) && !taskIsDeleted(dep));
}

function isBlocked(task) {
  return openDependencies(task).length > 0;
}

let dependentsIndex = null;

function invalidateRelationshipCache() {
  dependentsIndex = null;
}

function getDependentsIndex() {
  if (dependentsIndex) return dependentsIndex;
  dependentsIndex = new Map();
  for (const task of allTasks()) {
    for (const depId of new Set(task.dependencies || [])) {
      if (!dependentsIndex.has(depId)) dependentsIndex.set(depId, []);
      dependentsIndex.get(depId).push(task);
    }
  }
  return dependentsIndex;
}

function dependentsOf(taskId) {
  return getDependentsIndex().get(taskId) || [];
}

function urgencyBucket(task) {
  if (taskIsDone(task)) return "Done";
  const priority = String(formatPriority(task)).toLowerCase();
  if (priority === "urgent" || priority === "high") return "Now";
  if (priority === "medium") return "Next";
  return "Later";
}

function fieldsForTask(task) {
  return {
    project: formatTaskProject(task),
    priority: formatPriority(task),
    status: normalizedStatus(task),
    urgency: urgencyBucket(task),
    tags: formatTags(task),
  };
}

function deriveEffort(task) {
  if (taskIsDone(task)) return "done";
  const stepState = state.taskSteps[task.id];
  if (!stepState || stepState.loading || !stepState.data) return "?";
  const steps = normalizeSteps(stepState.data.steps);
  if (steps.length <= 1) return "?";
  if (steps.length === 2) return "quick";
  if (steps.length === 3) return "hrs";
  return "day+";
}

function containsWholeId(haystack, id) {
  const idChar = /[A-Za-z0-9_.-]/;
  let from = 0;
  for (;;) {
    const index = haystack.indexOf(id, from);
    if (index === -1) return false;
    const before = haystack[index - 1];
    const after = haystack[index + id.length];
    if (!(before && idChar.test(before)) && !(after && idChar.test(after))) return true;
    from = index + 1;
  }
}

function mentionsTaskId(task, taskId) {
  const note = task.context_notes || "";
  const summary = state.taskSteps[task.id]?.data?.summary || "";
  return containsWholeId(note, taskId) || containsWholeId(summary, taskId);
}

function backlinksFor(taskId) {
  const dependents = dependentsOf(taskId);
  const dependentIds = new Set(dependents.map((task) => task.id));
  const mentionOnly = allTasks().filter(
    (task) => task.id !== taskId && !dependentIds.has(task.id) && mentionsTaskId(task, taskId),
  );
  return [
    ...dependents.map((task) => ({ id: task.id, title: taskTitle(task), why: "blocked by this" })),
    ...mentionOnly.map((task) => ({ id: task.id, title: taskTitle(task), why: "mentions" })),
  ];
}

/* ---------- axis grouping engine ---------- */

function groupKeysForFields(fields, axis) {
  switch (axis) {
    case "project":
      return [fields.project];
    case "priority":
      return [fields.priority];
    case "status":
      return [fields.status];
    case "urgency":
      return [fields.urgency];
    case "tag": {
      const uniqueTags = [...new Set(fields.tags)];
      return uniqueTags.length ? uniqueTags : ["untagged"];
    }
    default:
      return ["all"];
  }
}

function groupOrderIndex(axis, key) {
  if (axis === "urgency") return URGENCY_ORDER.indexOf(key);
  if (axis === "priority") return PRIORITY_ORDER.indexOf(String(key).toLowerCase());
  if (axis === "status") return STATUS_ORDER.indexOf(String(key).toLowerCase());
  return -1;
}

function sortGroupKeys(axis, keys) {
  return [...keys].sort((a, b) => {
    const ia = groupOrderIndex(axis, a);
    const ib = groupOrderIndex(axis, b);
    if (ia !== -1 || ib !== -1) {
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    }
    if (a === "untagged") return 1;
    if (b === "untagged") return -1;
    return String(a).localeCompare(String(b));
  });
}

function groupLabel(axis, key) {
  if (axis === "status" || axis === "priority") return String(key).replace(/_/g, " ");
  return key;
}

function taskMatchesHideRule(task, ruleKey) {
  if (ruleKey === "done") return taskIsDone(task);
  if (ruleKey === "later") return urgencyBucket(task) === "Later";
  if (ruleKey === "low") return String(formatPriority(task)).toLowerCase() === "low";
  return false;
}

function blocksCount(taskId) {
  return dependentsOf(taskId).length;
}

function activeHideRuleKeysFor(task) {
  if (blocksCount(task.id) > 0) return [];
  return HIDE_RULES.map((rule) => rule.key).filter(
    (key) => viewState.hideRules[key] && taskMatchesHideRule(task, key),
  );
}

function scopedTasks() {
  let tasks = allTasks();
  if (state.searchResults) {
    const ids = new Set(state.searchResults.map((task) => task.id));
    tasks = tasks.filter((task) => ids.has(task.id));
  }
  if (state.selectedProjectScope !== "all") {
    tasks = tasks.filter((task) => formatTaskProject(task) === state.selectedProjectScope);
  }
  const view = VIEWS.find((v) => v.key === state.selectedView);
  if (view?.filter) {
    tasks = tasks.filter(view.filter);
  }
  return tasks;
}

function tombstoneInScope(tomb) {
  if (state.searchResults) return false;
  if (state.selectedProjectScope !== "all" && tomb.axisSnapshot.project !== state.selectedProjectScope) {
    return false;
  }
  const view = VIEWS.find((v) => v.key === state.selectedView);
  if (view?.filter) {
    const rawTask = (state.bootstrap?.tasks || []).find((task) => task.id === tomb.taskId);
    if (!rawTask) return false;
    const preDeleteTask = { ...rawTask, status: tomb.restore.previousStatus };
    if (!view.filter(preDeleteTask)) return false;
  }
  return true;
}

function orderWithinGroup(groupId, items) {
  const override = viewState.groupOrder[groupId];
  if (!override || !override.length) {
    return [...items].sort((a, b) => {
      const ta = new Date(a.updated_at || a.created_at || 0).getTime();
      const tb = new Date(b.updated_at || b.created_at || 0).getTime();
      return tb - ta;
    });
  }
  const byId = new Map(items.map((task) => [task.id, task]));
  const ordered = [];
  for (const id of override) {
    if (byId.has(id)) {
      ordered.push(byId.get(id));
      byId.delete(id);
    }
  }
  for (const remaining of byId.values()) ordered.push(remaining);
  return ordered;
}

function buildGroups(axis) {
  const tasks = scopedTasks();
  const buckets = new Map();

  function bucket(rawKey) {
    const id = `${axis}::${rawKey}`;
    if (!buckets.has(id)) {
      buckets.set(id, { id, rawKey, visible: [], folded: [], tombs: [] });
    }
    return buckets.get(id);
  }

  for (const task of tasks) {
    const fields = fieldsForTask(task);
    const keys = groupKeysForFields(fields, axis);
    const hiddenBy = activeHideRuleKeysFor(task);
    for (const rawKey of keys) {
      const group = bucket(rawKey);
      if (hiddenBy.length) {
        group.folded.push({ task, hiddenBy });
      } else {
        group.visible.push(task);
      }
    }
  }

  for (const tomb of viewState.tombstones) {
    if (!tombstoneInScope(tomb)) continue;
    const keys = groupKeysForFields(tomb.axisSnapshot, axis);
    for (const rawKey of keys) {
      bucket(rawKey).tombs.push(tomb);
    }
  }

  const orderedRawKeys = sortGroupKeys(axis, [...buckets.values()].map((group) => group.rawKey));

  return orderedRawKeys.map((rawKey) => {
    const group = buckets.get(`${axis}::${rawKey}`);
    const visible = orderWithinGroup(group.id, group.visible);
    const folded = group.folded;
    const total = visible.length + folded.length;
    const doneCount = [...visible, ...folded.map((f) => f.task)].filter(taskIsDone).length;
    const priorityCounts = { urgent: 0, high: 0, medium: 0, low: 0 };
    for (const task of [...visible, ...folded.map((f) => f.task)]) {
      const p = String(formatPriority(task)).toLowerCase();
      if (priorityCounts[p] !== undefined) priorityCounts[p] += 1;
    }
    const revealed = !!viewState.revealedResidues[group.id];

    return {
      id: group.id,
      rawKey,
      label: groupLabel(axis, rawKey),
      total,
      doneCount,
      priorityCounts,
      rows: [
        ...visible.map((task) => ({ task, revealed: false })),
        ...(revealed ? folded.map((f) => ({ task: f.task, revealed: true })) : []),
      ],
      tombs: group.tombs,
      residue:
        !revealed && folded.length
          ? {
              count: folded.length,
              reasons: [...new Set(folded.flatMap((f) => f.hiddenBy))],
              titles: folded
                .slice(0, 3)
                .map((f) => taskTitle(f.task))
                .join(", "),
            }
          : null,
    };
  });
}

function groupSummary(group) {
  const openCount = group.total - group.doneCount;
  return `${openCount} open`;
}

function groupMixSegments(group) {
  const total = Object.values(group.priorityCounts).reduce((a, b) => a + b, 0) || 1;
  return PRIORITY_ORDER.map((key) => ({
    key,
    pct: (group.priorityCounts[key] / total) * 100,
    style: `flex:0 0 ${(group.priorityCounts[key] / total) * 100}%; background:${PRIORITY_COLORS[key]};`,
  })).filter((seg) => seg.pct > 0);
}

function groupPct(group) {
  if (!group.total) return "0%";
  return `${Math.round((group.doneCount / group.total) * 100)}%`;
}

/* ---------- autolinking ---------- */

function renderAutolinked(text) {
  const parts = [];
  let last = 0;
  const regex = new RegExp(TASK_ID_RE.source, "gi");
  let match;
  while ((match = regex.exec(text))) {
    if (match.index > last) parts.push(escapeHtml(text.slice(last, match.index)));
    const id = match[0];
    const known = !!findTask(id);
    parts.push(
      known
        ? `<a href="#" class="autolink" data-jump-task="${escapeHtml(id)}">${escapeHtml(id)}</a>`
        : `<span class="autolink autolink-unknown">${escapeHtml(id)}</span>`,
    );
    last = match.index + id.length;
  }
  if (last < text.length) parts.push(escapeHtml(text.slice(last)));
  return parts.join("");
}

function jumpToTask(taskId) {
  if (!findTask(taskId)) return;
  state.selectedTaskId = taskId;
  viewState.expandedRows[taskId] = true;
  saveViewState();
  ensureRowData(taskId);
  renderTaskStream();
  renderTaskDetail();
  requestAnimationFrame(() => {
    const el = elements.taskStream.querySelector(`.task-row[data-task="${CSS.escape(taskId)}"]`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  });
}

/* ---------- refs / git / peek (lazy row data) ---------- */

async function ensureRowData(taskId) {
  const task = findTask(taskId);
  if (!task) return;

  if (!state.taskRefs[taskId]) {
    state.taskRefs[taskId] = { loading: true };
    renderTaskStream();
    try {
      const data = await api(`/api/tasks/${encodeURIComponent(taskId)}/refs`);
      state.taskRefs[taskId] = { data };
    } catch (error) {
      state.taskRefs[taskId] = { error: error.message };
    }
  }

  if (!state.taskGit[taskId]) {
    state.taskGit[taskId] = { loading: true };
    renderTaskStream();
    try {
      const data = await api(
        `/api/tasks/${encodeURIComponent(taskId)}/git?project=${encodeURIComponent(formatTaskProject(task))}`,
      );
      state.taskGit[taskId] = { data };
    } catch (error) {
      state.taskGit[taskId] = { error: error.message };
    }
  }

  renderTaskStream();
  if (state.selectedTaskId === taskId) renderTaskDetail();
}

function peekKey(taskId, refId) {
  return `${taskId}::${refId}`;
}

async function toggleRefPeek(taskId, refId) {
  const key = peekKey(taskId, refId);
  if (state.openPeeks.has(key)) {
    state.openPeeks.delete(key);
    renderTaskStream();
    return;
  }
  const task = findTask(taskId);
  if (!task) return;
  state.openPeeks.add(key);
  state.peeks[key] = { loading: true };
  renderTaskStream();
  try {
    const data = await api(
      `/api/tasks/${encodeURIComponent(taskId)}/refs/peek?refId=${encodeURIComponent(refId)}&project=${encodeURIComponent(formatTaskProject(task))}`,
    );
    state.peeks[key] = { data };
  } catch (error) {
    state.peeks[key] = { error: error.message };
  }
  renderTaskStream();
}

async function removeRef(taskId, refId) {
  const current = state.taskRefs[taskId]?.data?.refs || [];
  const nextRefs = current.filter((ref) => ref.id !== refId);
  try {
    const data = await api(`/api/tasks/${encodeURIComponent(taskId)}/refs`, {
      method: "PUT",
      body: JSON.stringify({ refs: nextRefs }),
    });
    state.taskRefs[taskId] = { data };
    state.openPeeks.delete(peekKey(taskId, refId));
    renderTaskStream();
    if (state.selectedTaskId === taskId) renderTaskDetail();
  } catch (error) {
    setMessage(`Ref remove failed: ${error.message}`, "error");
  }
}

async function handleRefAddSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const taskId = form.dataset.refAdd;
  const raw = form.elements.ref.value.trim();
  if (!raw) return;
  const [rawPath, rawLine] = raw.split(":");
  const current = state.taskRefs[taskId]?.data?.refs || [];
  const nextRefs = [...current, { path: rawPath.trim(), line: rawLine ? Number(rawLine) : null, kind: "path" }];
  try {
    const data = await api(`/api/tasks/${encodeURIComponent(taskId)}/refs`, {
      method: "PUT",
      body: JSON.stringify({ refs: nextRefs }),
    });
    state.taskRefs[taskId] = { data };
    form.reset();
    renderTaskStream();
    if (state.selectedTaskId === taskId) renderTaskDetail();
  } catch (error) {
    setMessage(`Ref add failed: ${error.message}`, "error");
  }
}

function renderGitLine(gitState) {
  if (!gitState || gitState.loading) {
    return `<span class="muted">loading&hellip;</span>`;
  }
  if (gitState.error) {
    return `<span class="muted">git unavailable: ${escapeHtml(gitState.error)}</span>`;
  }
  const data = gitState.data;
  if (!data || !data.configured) {
    return `<span class="muted">no repo configured for this project</span>`;
  }
  const parts = [];
  parts.push(data.branch ? `<span class="mono">${escapeHtml(data.branch)}</span>` : `<span class="muted">no branch</span>`);
  if (data.lastCommit) parts.push(`<span class="git-commit">${escapeHtml(data.lastCommit)}</span>`);
  if (data.lastCommitAge) parts.push(`<span class="muted">${escapeHtml(data.lastCommitAge)}</span>`);
  const stat = [];
  if (data.ahead) stat.push(`${data.ahead} ahead`);
  if (data.behind) stat.push(`${data.behind} behind`);
  if (data.dirty) stat.push(`${data.dirty} dirty`);
  return `${parts.join(` ${MDOT} `)} <span class="muted">${escapeHtml(stat.join(` ${MDOT} `) || "clean")}</span>`;
}

function renderGitSummary(gitState) {
  if (!gitState || gitState.loading) return "&hellip;";
  if (gitState.error) return "unavailable";
  const data = gitState.data;
  if (!data || !data.configured) return "not configured";
  if (!data.branch) return "no branch";
  const branch = escapeHtml(data.branch);
  return data.lastCommitAge ? `${branch} ${MDOT} ${escapeHtml(data.lastCommitAge)}` : branch;
}

function renderOpenPeeks(refs, taskId) {
  const openRefs = refs.filter((ref) => state.openPeeks.has(peekKey(taskId, ref.id)));
  if (!openRefs.length) return "";
  return openRefs
    .map((ref) => {
      const peekState = state.peeks[peekKey(taskId, ref.id)];
      if (!peekState || peekState.loading) {
        return `<div class="peek-panel"><div class="muted">loading&hellip;</div></div>`;
      }
      if (peekState.error) {
        return `<div class="peek-panel"><div class="muted">peek failed: ${escapeHtml(peekState.error)}</div></div>`;
      }
      const data = peekState.data;
      return `
        <div class="peek-panel">
          <div class="peek-header">
            <span class="mono">${escapeHtml(data.path)}</span>
            <span class="flex-spacer"></span>
            <span class="muted">read-only peek</span>
          </div>
          ${data.lines
            .map(
              (line) => `
                <div class="peek-line">
                  <span class="peek-n">${line.n}</span>
                  <span class="peek-text">${escapeHtml(line.text)}</span>
                </div>
              `,
            )
            .join("")}
        </div>
      `;
    })
    .join("");
}

/* ---------- task stream rendering ---------- */

function renderTaskStream() {
  const axis = viewState.axis;
  const groups = buildGroups(axis);
  state.visibleRowOrder = [];

  const uniqueRowIds = new Set();
  for (const group of groups) {
    for (const row of group.rows) uniqueRowIds.add(row.task.id);
  }
  elements.taskCount.textContent = String(uniqueRowIds.size);

  elements.taskStream.innerHTML = groups.length
    ? groups.map((group) => renderGroup(group, axis)).join("")
    : `<div class="muted">No tasks match this view.</div>`;

  bindTaskStream();
  renderFoldSummary();
}

function renderGroup(group) {
  const folded = !!viewState.foldedGroups[group.id];
  const rowsExpandedMajority = group.rows.length > 0 && group.rows.every((row) => viewState.expandedRows[row.task.id]);
  const rowsLabel = rowsExpandedMajority ? "collapse rows" : "expand rows";

  const rowsHtml = folded
    ? ""
    : group.rows
        .map((row) => {
          state.visibleRowOrder.push({ groupId: group.id, taskId: row.task.id });
          return renderRow(row.task, group.id, row.revealed);
        })
        .join("");

  const tombsHtml = folded ? "" : group.tombs.map((tomb) => renderTomb(tomb)).join("");
  const residueHtml = folded || !group.residue ? "" : renderResidue(group);

  return `
    <div class="group-block">
      <div class="group-header" data-group-toggle="${escapeHtml(group.id)}">
        <span class="group-caret">${folded ? "&#9656;" : "&#9662;"}</span>
        <span class="group-heading">
          <span class="group-label">${escapeHtml(group.label)}</span>
          <span class="group-count">${group.total}</span>
          <span class="group-summary">${escapeHtml(groupSummary(group))}</span>
        </span>
        <span class="group-tools">
          <button type="button" class="chip-btn" data-group-rows="${escapeHtml(group.id)}">${rowsLabel}</button>
          <span class="mix-bar">${groupMixSegments(group)
            .map((seg) => `<span style="${seg.style}"></span>`)
            .join("")}</span>
          <span class="group-pct">${groupPct(group)}</span>
        </span>
      </div>
      ${rowsHtml}
      ${tombsHtml}
      ${residueHtml}
    </div>
  `;
}

function renderRow(task, groupId, revealed) {
  const done = taskIsDone(task);
  const expanded = !!viewState.expandedRows[task.id];
  const dependents = dependentsOf(task.id);
  const openDeps = openDependencies(task);
  const blockedPrimary = openDeps[0] || null;
  const stepState = state.taskSteps[task.id];
  const steps = normalizeSteps(stepState?.data?.steps);
  const doneSteps = steps.filter((s) => s.done).length;
  const refState = state.taskRefs[task.id];
  const refCount = refState?.data?.refs?.length;
  const effort = deriveEffort(task);
  const active = task.id === state.selectedTaskId;
  const rowKey = `${groupId}::${task.id}`;
  const focused = state.focusedRowKey === rowKey;

  const classes = ["task-row", active ? "active" : "", done ? "done" : "", revealed ? "revealed" : "", focused ? "focused" : ""]
    .filter(Boolean)
    .join(" ");

  return `
    <div class="task-row-wrap" data-row-key="${escapeHtml(rowKey)}">
      <div class="${classes}" draggable="true" data-task="${escapeHtml(task.id)}" data-group="${escapeHtml(groupId)}">
        <button type="button" class="row-caret" data-row-toggle="${escapeHtml(task.id)}">${expanded ? "&#9662;" : "&#9656;"}</button>
        <label class="row-check" title="${done ? "Mark todo" : "Mark done"}">
          <input type="checkbox" data-task-toggle="${escapeHtml(task.id)}" ${done ? "checked" : ""} />
          <span aria-hidden="true"></span>
        </label>
        <span class="row-title">
          <span class="row-title-text">${escapeHtml(taskTitle(task))}</span>
          <span class="row-meta">${escapeHtml(task.id)} ${MDOT} ${escapeHtml(formatTaskProject(task))} ${MDOT} ${escapeHtml(formatPriority(task))}</span>
          ${dependents.length ? `<span class="row-blocks-chip">blocks ${dependents.length}</span>` : ""}
        </span>
        <span class="row-stats">
          <span class="row-refs">${refCount === undefined ? "" : refCount}</span>
          <span class="row-progress"><span style="width:${Number(task.progress) || 0}%;"></span></span>
          <span class="row-steps">${stepState?.data ? `${doneSteps}/${steps.length}` : "&hellip;"}</span>
          <span class="row-effort effort-${effort === "?" ? "unknown" : effort.replace("+", "plus")}">${viewState.showEffort ? effort : ""}</span>
        </span>
      </div>
      ${
        blockedPrimary
          ? `
            <div class="row-blocked-line">
              <span class="row-blocked-icon">&#9888;</span>
              <span class="row-blocked-text">
                blocked by <span class="mono">${escapeHtml(blockedPrimary.id)}</span>
                <span class="row-blocked-title">${escapeHtml(taskTitle(blockedPrimary))}</span>
                ${openDeps.length > 1 ? `<span class="muted">+${openDeps.length - 1} more</span>` : ""}
              </span>
              <button type="button" class="ghost-remove" data-unblock="${escapeHtml(task.id)}" data-unblock-dep="${escapeHtml(blockedPrimary.id)}">unlink</button>
            </div>
          `
          : ""
      }
      ${expanded ? renderRowExpanded(task) : ""}
    </div>
  `;
}

function renderRowExpanded(task) {
  const stepState = state.taskSteps[task.id];
  const steps = normalizeSteps(stepState?.data?.steps);
  const refState = state.taskRefs[task.id];
  const refs = refState?.data?.refs || [];
  const gitState = state.taskGit[task.id];
  const note = task.context_notes || "";

  return `
    <div class="row-expanded">
      <div class="row-expanded-grid">
        <div class="row-steps-col">
          ${
            steps.length
              ? steps
                  .map(
                    (step, index) => `
                      <label class="expand-step ${step.done ? "done" : ""}">
                        <input type="checkbox" data-row-step-check="${escapeHtml(task.id)}" data-row-step-index="${index}" ${step.done ? "checked" : ""} />
                        <span>${escapeHtml(step.text)}</span>
                      </label>
                    `,
                  )
                  .join("")
              : `<div class="muted">No steps saved yet.</div>`
          }
        </div>
        <div class="row-note-col">
          <span class="col-label">Note</span>
          <p class="row-note">${note ? renderAutolinked(note) : `<span class="muted">No note.</span>`}</p>
        </div>
      </div>

      <div class="row-refs-line">
        <span class="col-label">refs</span>
        ${refs
          .map(
            (ref) => `
              <button type="button" class="ref-chip" data-ref-peek="${escapeHtml(task.id)}" data-ref-id="${escapeHtml(ref.id)}">
                <span class="ref-kind">${ref.kind === "file" ? "file:" : "path:"}</span>${escapeHtml(ref.label)}${ref.line ? `:${ref.line}` : ""}
              </button>
              <button type="button" class="ref-remove" data-ref-remove="${escapeHtml(task.id)}" data-ref-remove-id="${escapeHtml(ref.id)}" title="Remove ref">&times;</button>
            `,
          )
          .join("")}
        <form class="ref-add" data-ref-add="${escapeHtml(task.id)}">
          <input name="ref" placeholder="path/to/file.js:120" />
          <button type="submit" class="chip-btn">+ path</button>
        </form>
      </div>

      <div class="row-git-line">
        <span class="col-label">git</span>
        ${renderGitLine(gitState)}
      </div>

      ${renderOpenPeeks(refs, task.id)}
    </div>
  `;
}

function renderTomb(tomb) {
  return `
    <div class="tomb-row">
      <span class="tomb-icon">&times;</span>
      <span class="tomb-text">
        <span class="mono">${escapeHtml(tomb.taskId)}</span>
        <span class="tomb-title">${escapeHtml(tomb.title)}</span>
        <span class="muted">deleted</span>
      </span>
      <button type="button" class="ghost-remove" data-undo-delete="${escapeHtml(tomb.id)}">undo</button>
    </div>
  `;
}

function renderResidue(group) {
  const residue = group.residue;
  return `
    <div class="residue-row" data-residue-reveal="${escapeHtml(group.id)}">
      <span class="residue-icon">&#8942;</span>
      <span class="residue-text">
        <span>${residue.count} folded here &mdash; ${escapeHtml(residue.reasons.join(", "))}</span>
        <span class="muted">${escapeHtml(residue.titles)}</span>
      </span>
      <span class="residue-action">show</span>
    </div>
  `;
}

function bindTaskStream() {
  elements.taskStream.querySelectorAll("[data-group-toggle]").forEach((header) => {
    header.addEventListener("click", (event) => {
      if (event.target.closest("[data-group-rows]")) return;
      const id = header.dataset.groupToggle;
      viewState.foldedGroups[id] = !viewState.foldedGroups[id];
      saveViewState();
      renderTaskStream();
    });
  });

  elements.taskStream.querySelectorAll("[data-group-rows]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const id = button.dataset.groupRows;
      const group = buildGroups(viewState.axis).find((g) => g.id === id);
      if (!group) return;
      const allExpanded = group.rows.length > 0 && group.rows.every((row) => viewState.expandedRows[row.task.id]);
      for (const row of group.rows) {
        viewState.expandedRows[row.task.id] = !allExpanded;
      }
      saveViewState();
      renderTaskStream();
    });
  });

  elements.taskStream.querySelectorAll("[data-residue-reveal]").forEach((row) => {
    row.addEventListener("click", () => {
      viewState.revealedResidues[row.dataset.residueReveal] = true;
      saveViewState();
      renderTaskStream();
    });
  });

  elements.taskStream.querySelectorAll("[data-undo-delete]").forEach((button) => {
    button.addEventListener("click", () => undoDelete(button.dataset.undoDelete));
  });

  elements.taskStream.querySelectorAll("[data-row-toggle]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleRowExpanded(button.dataset.rowToggle);
    });
  });

  elements.taskStream.querySelectorAll("[data-task-toggle]").forEach((checkbox) => {
    checkbox.addEventListener("click", (event) => event.stopPropagation());
    checkbox.addEventListener("change", handleTaskToggle);
  });

  elements.taskStream.querySelectorAll("[data-unblock]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      removeDependency(button.dataset.unblock, button.dataset.unblockDep);
    });
  });

  elements.taskStream.querySelectorAll(".task-row").forEach((row) => {
    row.addEventListener("click", (event) => {
      if (event.target.closest("[data-task-toggle],[data-row-toggle]")) return;
      state.selectedTaskId = row.dataset.task;
      state.confirmDeleteTaskId = null;
      renderTaskDetail();
      renderTaskStream();
    });
    row.addEventListener("dragstart", handleRowDragStart);
    row.addEventListener("dragover", handleRowDragOver);
    row.addEventListener("dragleave", handleRowDragLeave);
    row.addEventListener("drop", handleRowDrop);
    row.addEventListener("dragend", handleRowDragEnd);
  });

  elements.taskStream.querySelectorAll("[data-row-step-check]").forEach((checkbox) => {
    checkbox.addEventListener("click", (event) => event.stopPropagation());
    checkbox.addEventListener("change", handleRowStepCheck);
  });

  elements.taskStream.querySelectorAll("[data-ref-peek]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleRefPeek(button.dataset.refPeek, button.dataset.refId);
    });
  });

  elements.taskStream.querySelectorAll("[data-ref-remove]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      removeRef(button.dataset.refRemove, button.dataset.refRemoveId);
    });
  });

  elements.taskStream.querySelectorAll("[data-ref-add]").forEach((form) => {
    form.addEventListener("click", (event) => event.stopPropagation());
    form.addEventListener("submit", handleRefAddSubmit);
  });

  elements.taskStream.querySelectorAll("[data-jump-task]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      jumpToTask(link.dataset.jumpTask);
    });
  });
}

function toggleRowExpanded(taskId) {
  const next = !viewState.expandedRows[taskId];
  viewState.expandedRows[taskId] = next;
  saveViewState();
  if (next) ensureRowData(taskId);
  renderTaskStream();
}

async function handleRowStepCheck(event) {
  event.stopPropagation();
  const checkbox = event.currentTarget;
  const taskId = checkbox.dataset.rowStepCheck;
  const stepIndex = Number(checkbox.dataset.rowStepIndex);
  const stepRecord = state.taskSteps[taskId]?.data;
  const steps = normalizeSteps(stepRecord?.steps);
  const task = findTask(taskId);
  if (!task || !steps[stepIndex]) return;
  steps[stepIndex] = { ...steps[stepIndex], done: checkbox.checked };
  checkbox.disabled = true;
  try {
    const data = await api(`/api/tasks/${encodeURIComponent(taskId)}/steps`, {
      method: "PUT",
      body: JSON.stringify({
        project_id: stepRecord?.project_id || formatTaskProject(task),
        status: stepRecord?.status || "active",
        summary: stepRecord?.summary || "",
        steps,
      }),
    });
    state.taskSteps[taskId] = { data };
    renderTaskStream();
    if (state.selectedTaskId === taskId) renderTaskDetail();
  } catch (error) {
    checkbox.checked = !checkbox.checked;
    checkbox.disabled = false;
    setMessage(`Step update failed: ${error.message}`, "error");
  }
}

/* ---------- dependencies (block / unblock) ---------- */

async function addDependency(taskId, depId) {
  const task = findTask(taskId);
  if (!task || taskId === depId) return;
  const next = [...new Set([...(task.dependencies || []), depId])];
  try {
    await api(`/api/tasks/${encodeURIComponent(taskId)}`, {
      method: "PUT",
      body: JSON.stringify({ dependencies: next }),
    });
    await refreshAll();
    setMessage(`${depId} now blocks ${taskId}.`);
  } catch (error) {
    setMessage(`Block failed: ${error.message}`, "error");
  }
}

async function removeDependency(taskId, depId) {
  const task = findTask(taskId);
  if (!task) return;
  const next = (task.dependencies || []).filter((id) => id !== depId);
  try {
    await api(`/api/tasks/${encodeURIComponent(taskId)}`, {
      method: "PUT",
      body: JSON.stringify({ dependencies: next }),
    });
    await refreshAll();
    setMessage(`Unlinked ${depId} from ${taskId}.`);
  } catch (error) {
    setMessage(`Unlink failed: ${error.message}`, "error");
  }
}

/* ---------- drag to block / reorder ---------- */

function handleRowDragStart(event) {
  const taskId = event.currentTarget.dataset.task;
  state.drag = { taskId };
  event.dataTransfer.setData("text/plain", taskId);
  event.dataTransfer.effectAllowed = "move";
}

function handleRowDragOver(event) {
  if (!state.drag) return;
  const row = event.currentTarget;
  if (row.dataset.task === state.drag.taskId) return;
  event.preventDefault();
  const rect = row.getBoundingClientRect();
  const zone = event.clientY - rect.top < rect.height * 0.3 ? "reorder" : "block";
  row.classList.remove("drop-block", "drop-reorder");
  row.classList.add(zone === "reorder" ? "drop-reorder" : "drop-block");
  row.dataset.dropZone = zone;
}

function handleRowDragLeave(event) {
  event.currentTarget.classList.remove("drop-block", "drop-reorder");
  delete event.currentTarget.dataset.dropZone;
}

function handleRowDrop(event) {
  event.preventDefault();
  const row = event.currentTarget;
  const zone = row.dataset.dropZone;
  row.classList.remove("drop-block", "drop-reorder");
  delete row.dataset.dropZone;
  if (!state.drag) return;
  const sourceId = state.drag.taskId;
  const targetId = row.dataset.task;
  const groupId = row.dataset.group;
  state.drag = null;
  if (sourceId === targetId) return;

  if (zone === "reorder") {
    reorderWithinGroup(groupId, sourceId, targetId);
  } else {
    addDependency(targetId, sourceId);
  }
}

function handleRowDragEnd() {
  state.drag = null;
  elements.taskStream.querySelectorAll(".drop-block,.drop-reorder").forEach((row) => {
    row.classList.remove("drop-block", "drop-reorder");
  });
}

function reorderWithinGroup(groupId, sourceId, targetId) {
  const group = buildGroups(viewState.axis).find((g) => g.id === groupId);
  if (!group) return;
  const order = group.rows.map((row) => row.task.id).filter((id) => id !== sourceId);
  const targetIndex = order.indexOf(targetId);
  order.splice(targetIndex === -1 ? order.length : targetIndex, 0, sourceId);
  viewState.groupOrder[groupId] = order;
  saveViewState();
  renderTaskStream();
}

/* ---------- delete impact + soft delete + tombstones ---------- */

function computeDeleteImpact(task) {
  const dependents = dependentsOf(task.id);
  const ownDependencies = Array.isArray(task.dependencies) ? task.dependencies.filter(Boolean) : [];
  const primaryOwnDependency = ownDependencies[0] || null;
  const refsCount = state.taskRefs[task.id]?.data?.refs?.length || 0;
  const stepsCount = normalizeSteps(state.taskSteps[task.id]?.data?.steps).length;
  const mentions = allTasks().filter((other) => other.id !== task.id && mentionsTaskId(other, task.id));
  return { dependents, primaryOwnDependency, refsCount, stepsCount, mentions };
}

function renderDeleteConfirm(task) {
  const impact = computeDeleteImpact(task);
  const lines = [];
  if (impact.stepsCount || impact.refsCount) {
    lines.push(`${impact.stepsCount} step(s) and ${impact.refsCount} ref(s) go with it.`);
  }
  if (impact.dependents.length) {
    lines.push(`${impact.dependents.length} task(s) waiting on it will be unblocked (or handed its blocker).`);
  }
  if (impact.primaryOwnDependency) {
    lines.push(`Its own link to ${escapeHtml(impact.primaryOwnDependency)} is discarded unless you pass it down.`);
  }
  if (impact.mentions.length) {
    lines.push(`${impact.mentions.length} note(s) mention it &mdash; text stays, link goes dead.`);
  }
  if (!lines.length) {
    lines.push("Nothing else depends on or references it.");
  }

  return `
    <div class="delete-confirm" data-delete-confirm>
      <div class="delete-confirm-title">Delete ${escapeHtml(task.id)} &mdash; what goes with it</div>
      <div class="delete-confirm-lines">
        ${lines.map((line) => `<div class="delete-confirm-line"><span>&middot;</span><span>${line}</span></div>`).join("")}
      </div>
      <div class="delete-confirm-actions">
        <button type="button" class="danger" data-delete-unlink>Delete and unlink</button>
        ${
          impact.primaryOwnDependency && impact.dependents.length
            ? `<button type="button" class="secondary" data-delete-transfer>Delete and pass its blocker down</button>`
            : ""
        }
        <button type="button" class="ghost" data-delete-cancel>Cancel</button>
      </div>
    </div>
  `;
}

async function performDelete(task, mode) {
  const impact = computeDeleteImpact(task);
  const snapshot = {
    id: `tomb_${Date.now().toString(36)}`,
    taskId: task.id,
    title: taskTitle(task),
    deletedAt: new Date().toISOString(),
    mode,
    axisSnapshot: fieldsForTask(task),
    restore: {
      previousStatus: formatStatus(task),
      dependents: impact.dependents.map((dep) => ({
        id: dep.id,
        previousDependencies: [...(dep.dependencies || [])],
      })),
    },
  };

  viewState.tombstones.push(snapshot);
  saveViewState();

  try {
    await api(`/api/tasks/${encodeURIComponent(task.id)}`, {
      method: "PUT",
      body: JSON.stringify({ status: "deleted" }),
    });

    await Promise.all(
      impact.dependents.map((dependent) => {
        const nextDeps =
          mode === "unlink"
            ? (dependent.dependencies || []).filter((id) => id !== task.id)
            : [
                ...new Set(
                  (dependent.dependencies || [])
                    .map((id) => (id === task.id ? impact.primaryOwnDependency : id))
                    .filter(Boolean),
                ),
              ];
        return api(`/api/tasks/${encodeURIComponent(dependent.id)}`, {
          method: "PUT",
          body: JSON.stringify({ dependencies: nextDeps }),
        });
      }),
    );

    state.confirmDeleteTaskId = null;
    state.selectedTaskId = null;
    await refreshAll();
    setMessage(`Deleted ${task.id}.`);
  } catch (error) {
    await refreshAll();
    setMessage(`Delete failed: ${error.message}`, "error");
  }
}

async function undoDelete(tombId) {
  const snapshot = viewState.tombstones.find((tomb) => tomb.id === tombId);
  if (!snapshot) return;
  try {
    await api(`/api/tasks/${encodeURIComponent(snapshot.taskId)}`, {
      method: "PUT",
      body: JSON.stringify({ status: snapshot.restore.previousStatus }),
    });
    await Promise.all(
      snapshot.restore.dependents.map((dependent) =>
        api(`/api/tasks/${encodeURIComponent(dependent.id)}`, {
          method: "PUT",
          body: JSON.stringify({ dependencies: dependent.previousDependencies }),
        }),
      ),
    );
    viewState.tombstones = viewState.tombstones.filter((tomb) => tomb.id !== tombId);
    saveViewState();
    await refreshAll();
    setMessage(`Restored ${snapshot.taskId}.`);
  } catch (error) {
    setMessage(`Undo failed: ${error.message}`, "error");
  }
}

/* ---------- top bar: stats, axis/fold chips, sync ---------- */

function renderStats() {
  const projects = state.bootstrap?.projects || [];
  const tasks = allTasks();
  const queue = state.bootstrap?.activeQueue || [];
  const platform = state.platform?.data || {};
  const activeTasks = tasks.filter((task) => !taskIsDone(task));
  const doneTasks = tasks.filter(taskIsDone);

  const cards = [
    { label: "Projects", value: projects.length },
    { label: "Tasks", value: tasks.length },
    { label: "Active", value: activeTasks.length },
    { label: "Done", value: doneTasks.length },
    { label: "Queue", value: queue.length },
    { label: "Agents", value: resourceItems(platform.agents).length },
    { label: "Memories", value: resourceItems(platform.memories).length },
    { label: "Ideas", value: resourceItems(platform.ideas).length },
    { label: "Errors", value: resourceItems(platform.errors).length },
  ];

  elements.stats.innerHTML = cards
    .map(
      (card) => `
        <div class="stat-card">
          <span class="stat-label">${escapeHtml(card.label)}</span>
          <span class="stat-value">${escapeHtml(card.value)}</span>
        </div>
      `,
    )
    .join("");
}

function renderTopStats() {
  const queue = state.bootstrap?.activeQueue || [];
  const errors = resourceItems(state.platform?.data?.errors);
  const ideas = resourceItems(state.platform?.data?.ideas);
  elements.statQueue.textContent = String(queue.length);
  elements.statErrors.textContent = String(errors.length);
  elements.railQueue.textContent = String(queue.length);
  elements.railIdeas.textContent = String(ideas.length);
  elements.railErrors.textContent = String(errors.length);
}

function renderSyncIndicator(ok) {
  elements.syncIndicator.textContent = ok ? "tui in sync" : "sync error";
  elements.syncIndicator.classList.toggle("tone-ok", ok);
  elements.syncIndicator.classList.toggle("tone-warn", !ok);
}

function renderAxisBar() {
  elements.axisChips.innerHTML = AXES.map(
    (axis) => `
      <button type="button" class="chip ${viewState.axis === axis.key ? "active" : ""}" data-axis="${axis.key}">${axis.label}</button>
    `,
  ).join("");

  elements.hideChips.innerHTML = HIDE_RULES.map((rule) => {
    const count = allTasks().filter((task) => taskMatchesHideRule(task, rule.key)).length;
    const active = !!viewState.hideRules[rule.key];
    return `
      <button type="button" class="chip ${active ? "active" : ""}" data-hide-rule="${rule.key}">${rule.label}<span class="chip-count">${count}</span></button>
    `;
  }).join("");

  const hiddenCount = allTasks().filter((task) => activeHideRuleKeysFor(task).length > 0).length;
  const axisLabel = AXES.find((a) => a.key === viewState.axis)?.label || viewState.axis;
  elements.axisStatus.textContent = `by ${axisLabel} ${MDOT} ${hiddenCount} hidden`;

  elements.axisChips.querySelectorAll("[data-axis]").forEach((button) => {
    button.addEventListener("click", () => {
      viewState.axis = button.dataset.axis;
      saveViewState();
      renderAxisBar();
      renderTaskStream();
    });
  });
  elements.hideChips.querySelectorAll("[data-hide-rule]").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.hideRule;
      viewState.hideRules[key] = !viewState.hideRules[key];
      saveViewState();
      renderAxisBar();
      renderTaskStream();
    });
  });
}

function renderFoldSummary() {
  const hiddenCount = allTasks().filter((task) => activeHideRuleKeysFor(task).length > 0).length;
  const foldedGroupCount = Object.values(viewState.foldedGroups).filter(Boolean).length;
  elements.foldSummary.textContent = `${hiddenCount} rows folded ${MDOT} ${foldedGroupCount} groups folded ${MDOT} remembered between sessions`;
}

/* ---------- rail: views + projects ---------- */

function countForView(view) {
  const tasks = allTasks();
  if (view.key === "by-project") return tasks.length;
  return tasks.filter(view.filter).length;
}

function renderViews() {
  const builtIn = VIEWS.map(
    (view) => `
      <button type="button" class="rail-row view-row ${state.selectedView === view.key ? "active" : ""}" data-view="${view.key}">
        <span>${escapeHtml(view.label)}</span>
        <span class="rail-count">${countForView(view)}</span>
      </button>
    `,
  ).join("");

  const saved = viewState.savedViews
    .map(
      (view) => `
        <button type="button" class="rail-row view-row" data-saved-view="${escapeHtml(view.id)}">
          <span>${escapeHtml(view.label)}</span>
          <span class="rail-count">&#9733;</span>
        </button>
      `,
    )
    .join("");

  const addRow = state.savingView
    ? `
      <form class="rail-row rail-add-form" data-save-view-form>
        <input type="text" name="label" class="rail-add-input" placeholder="Name this view" autofocus maxlength="60" />
        <button type="submit" class="rail-add-confirm" title="Save view">&#10003;</button>
        <button type="button" class="rail-add-cancel" data-save-view-cancel title="Cancel">&#10005;</button>
      </form>
    `
    : `<button type="button" class="rail-row rail-add" data-save-view-start>+ save this view</button>`;

  elements.viewsList.innerHTML = `${builtIn}${saved}${addRow}`;

  elements.viewsList.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedView = button.dataset.view;
      const view = VIEWS.find((v) => v.key === state.selectedView);
      if (view?.axis) {
        viewState.axis = view.axis;
        saveViewState();
      }
      renderAll();
    });
  });

  elements.viewsList.querySelectorAll("[data-saved-view]").forEach((button) => {
    button.addEventListener("click", () => {
      const saved = viewState.savedViews.find((view) => view.id === button.dataset.savedView);
      if (!saved) return;
      state.selectedView = null;
      viewState.axis = saved.axis;
      viewState.hideRules = { ...saved.hideRules };
      saveViewState();
      renderAll();
    });
  });

  elements.viewsList.querySelector("[data-save-view-start]")?.addEventListener("click", () => {
    state.savingView = true;
    renderViews();
    elements.viewsList.querySelector(".rail-add-input")?.focus();
  });

  elements.viewsList.querySelector("[data-save-view-cancel]")?.addEventListener("click", () => {
    state.savingView = false;
    renderViews();
  });

  const saveViewForm = elements.viewsList.querySelector("[data-save-view-form]");
  saveViewForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const label = new FormData(saveViewForm).get("label")?.toString().trim();
    if (!label) return;
    viewState.savedViews.push({
      id: `view_${Date.now().toString(36)}`,
      label,
      axis: viewState.axis,
      hideRules: { ...viewState.hideRules },
    });
    saveViewState();
    state.savingView = false;
    renderViews();
  });
  saveViewForm?.querySelector(".rail-add-input")?.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      state.savingView = false;
      renderViews();
    }
  });
}

function renderProjects() {
  const projects = state.bootstrap?.projects || [];
  const counts = new Map();
  for (const task of allTasks()) {
    const project = formatTaskProject(task);
    counts.set(project, (counts.get(project) || 0) + 1);
  }

  const items = [
    { name: "all", description: "Everything" },
    ...projects.map((p) => ({ name: p.name || p.project_name || "", description: p.description || "" })).filter((p) => p.name),
  ];

  elements.projectCount.textContent = String(items.length - 1);
  elements.projectList.innerHTML = items
    .map((project) => {
      const count = project.name === "all" ? allTasks().length : counts.get(project.name) || 0;
      const active = state.selectedProjectScope === project.name;
      return `
        <button type="button" class="rail-row project-item ${active ? "active" : ""}" data-project="${escapeHtml(project.name)}">
          <span>${escapeHtml(project.name)}</span>
          <span class="rail-count">${count}</span>
        </button>
      `;
    })
    .join("");

  elements.taskProject.innerHTML = [
    `<option value="general">general</option>`,
    ...projects
      .map((p) => {
        const name = p.name || p.project_name || "";
        if (!name || name === "general") return null;
        return `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`;
      })
      .filter(Boolean),
  ].join("");

  elements.projectList.querySelectorAll("[data-project]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedProjectScope = button.dataset.project;
      renderAll();
    });
  });
}

/* ---------- platform resources (kept from original) ---------- */

const RESOURCE_ORDER = [
  ["agents", "Agents"],
  ["availableAgents", "Available"],
  ["memories", "Memories"],
  ["ideas", "Ideas"],
  ["errors", "Errors"],
  ["training", "Training"],
  ["chunks", "Chunks"],
  ["readyChunks", "Ready chunks"],
  ["activeQueue", "Queue"],
  ["analytics", "Task analytics"],
  ["agentAnalytics", "Agent analytics"],
  ["performance", "Performance"],
  ["timeReport", "Time"],
  ["backups", "Backups"],
  ["memoryTypes", "Memory types"],
  ["trainingStats", "Training stats"],
  ["chunkGraph", "Chunk graph"],
  ["stats", "System stats"],
  ["health", "Health"],
];

let selectedResource = "agents";

function platformValue(key) {
  if (key === "activeQueue") return state.bootstrap?.activeQueue || [];
  if (key === "analytics") return state.bootstrap?.analytics || null;
  return state.platform?.data?.[key] ?? null;
}

function renderPlatformResources() {
  if (!elements.platformTabs || !elements.platformList) return;
  const resources = RESOURCE_ORDER.map(([key, label]) => {
    const value = platformValue(key);
    return { key, label, count: resourceItems(value).length, value };
  });

  elements.platformCount.textContent = String(resources.reduce((total, resource) => total + resource.count, 0));
  elements.platformTabs.innerHTML = resources
    .map(
      (resource) => `
        <button type="button" class="resource-tab ${selectedResource === resource.key ? "active" : ""}" data-resource="${escapeHtml(resource.key)}">
          ${escapeHtml(resource.label)}
          <span>${escapeHtml(resource.count)}</span>
        </button>
      `,
    )
    .join("");

  const selected = resources.find((resource) => resource.key === selectedResource) || resources[0];
  selectedResource = selected?.key || "agents";
  const items = resourceItems(selected?.value);
  elements.platformList.innerHTML = items.length
    ? items
        .slice(0, 80)
        .map((item) => {
          const title = item.name || item.title || item.id || item.idea || item.moment || item.task_name || selected.label;
          const sub = item.description || item.action || item.meaning || item.source || item.status || "";
          return `
            <article class="resource-card">
              <div>
                <strong>${escapeHtml(title)}</strong>
                <div class="muted">${escapeHtml(sub)}</div>
              </div>
              ${renderFieldDetails(item, "Fields in use")}
            </article>
          `;
        })
        .join("")
    : `<div class="muted">No ${escapeHtml(selected?.label || "resource")} records returned by Todozi.</div>`;

  elements.platformTabs.querySelectorAll("[data-resource]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedResource = button.dataset.resource;
      renderPlatformResources();
    });
  });
}

/* ---------- panel toggles (capture / platform) ---------- */

function togglePanel(key, resource) {
  const panel = key === "capture" ? elements.capturePanel : elements.platformPanel;
  const other = key === "capture" ? elements.platformPanel : elements.capturePanel;
  const opening = resource ? true : panel.hidden;
  other.hidden = true;
  panel.hidden = !opening;
  if (opening && key === "platform") {
    if (resource) selectedResource = resource;
    renderPlatformResources();
  }
}

/* ---------- detail pane ---------- */

function renderTaskDetail() {
  const message = state.message
    ? `<div class="${state.message.kind === "error" ? "error" : "help"}">${escapeHtml(state.message.text)}</div>`
    : "";

  const task = findTask(state.selectedTaskId);
  if (!task || taskIsDeleted(task)) {
    elements.taskDetail.innerHTML = `${message}<div class="detail-empty">Pick a task to inspect or edit it.</div>`;
    return;
  }

  const projects = state.bootstrap?.projects || [];
  const projectOptions = [
    "general",
    ...projects.map((p) => p.name || p.project_name || "").filter((name) => name && name !== "general"),
  ];
  const priorityOptions = ["low", "medium", "high", "urgent"];
  const statusOptions = ["todo", "in_progress", "inprogress", "done", "completed", "blocked", "cancelled"];
  const projectValue = formatTaskProject(task);
  const priorityValue = formatPriority(task);
  const statusValue = formatStatus(task);
  const done = taskIsDone(task);
  const gitState = state.taskGit[task.id];
  const effort = deriveEffort(task);
  const backlinks = backlinksFor(task.id);

  elements.taskDetail.innerHTML = `
    ${message}
    <div class="detail-title-row">
      <textarea class="detail-title-input" name="action" form="detail-form" rows="2" aria-label="Task title">${escapeHtml(taskTitle(task))}</textarea>
      <label class="detail-complete-toggle" title="${done ? "Mark todo" : "Mark done"}">
        <input type="checkbox" data-task-toggle="${escapeHtml(task.id)}" ${done ? "checked" : ""} />
        <span aria-hidden="true"></span>
      </label>
    </div>
    <div class="muted detail-task-id">${escapeHtml(task.id)}</div>

    <div class="detail-meta-grid">
      <span class="muted">status</span><span>${escapeHtml(statusValue)}</span>
      <span class="muted">priority</span><span>${escapeHtml(priorityValue)}</span>
      <span class="muted">project</span><span>${escapeHtml(projectValue)}</span>
      <span class="muted">effort</span><span>${escapeHtml(effort)} <span class="muted">${MDOT} fuzzy, not a date</span></span>
      <span class="muted">git</span><span class="mono">${renderGitSummary(gitState)}</span>
    </div>

    <div class="detail-meta-strip">
      ${renderGhostSelect("parent_project", "project", projectValue, [projectValue, ...projectOptions])}
      ${renderGhostSelect("priority", "priority", priorityValue, [priorityValue, ...priorityOptions])}
      ${renderGhostSelect("status", "status", statusValue, [statusValue, ...statusOptions])}
      <label class="ghost-input tags-input">
        <span>tags</span>
        <input name="tags" form="detail-form" value="${escapeHtml(asTextList(task.tags))}" placeholder="tag1, tag2" />
      </label>
      <label class="ghost-input">
        <span>time</span>
        <input name="time" form="detail-form" value="${escapeHtml(task.time || "")}" placeholder="ASAP" />
      </label>
      <label class="ghost-input compact">
        <span>progress</span>
        <input name="progress" form="detail-form" value="${escapeHtml(task.progress ?? "")}" placeholder="0-100" />
      </label>
    </div>

    ${
      backlinks.length
        ? `
          <div class="detail-backlinks">
            <span class="col-label">Referenced by</span>
            ${backlinks
              .map(
                (link) => `
                  <button type="button" class="backlink-row" data-jump-task="${escapeHtml(link.id)}">
                    <span class="mono">${escapeHtml(link.id)}</span>
                    <span>${escapeHtml(link.title)} <span class="muted">&mdash; ${escapeHtml(link.why)}</span></span>
                  </button>
                `,
              )
              .join("")}
          </div>
        `
        : ""
    }

    <form id="detail-form" class="detail-form">
      <input type="hidden" name="parent_project" value="${escapeHtml(projectValue)}" />
      <input type="hidden" name="priority" value="${escapeHtml(priorityValue)}" />
      <input type="hidden" name="status" value="${escapeHtml(statusValue)}" />
      <label>
        Notes
        <textarea name="context_notes" rows="4">${escapeHtml(task.context_notes || "")}</textarea>
      </label>
      ${renderDependencyEditor(task)}
      ${renderFieldDetails(task, "Fields in use")}
      <div class="detail-actions">
        <button type="submit">Save task</button>
        <button type="button" class="secondary" data-action="complete">Complete</button>
        <span class="flex-spacer"></span>
        <button type="button" class="danger" data-action="delete">Delete</button>
      </div>
    </form>

    ${state.confirmDeleteTaskId === task.id ? renderDeleteConfirm(task) : ""}

    <form id="steps-form" class="steps-form">
      <div class="panel-header compact">
        <h3>Steps</h3>
        <span id="steps-status" class="muted">Loading...</span>
      </div>
      <label>
        One step per line
        <textarea name="steps" rows="7" placeholder="Map each command to the Todozi endpoint and payload shape"></textarea>
      </label>
      <label>
        Summary
        <input name="summary" placeholder="optional note" />
      </label>
      <div class="detail-actions">
        <button type="submit" class="secondary">Save steps</button>
      </div>
    </form>
  `;

  const detailForm = elements.taskDetail.querySelector("#detail-form");
  const titleEditor = elements.taskDetail.querySelector(".detail-title-input");
  bindGhostSelectors(detailForm);
  bindDependencyEditor(detailForm);
  resizeTitleEditor(titleEditor);
  titleEditor.addEventListener("input", (event) => resizeTitleEditor(event.currentTarget));
  titleEditor.addEventListener("focus", (event) => event.currentTarget.select());
  elements.taskDetail.querySelector(".detail-complete-toggle input").addEventListener("change", handleTaskToggle);
  detailForm.addEventListener("submit", handleDetailSubmit);
  detailForm.querySelector('[data-action="complete"]').addEventListener("click", () => {
    detailForm.elements.status.value = "done";
    handleDetailSubmit({ preventDefault() {}, currentTarget: detailForm });
  });
  detailForm.querySelector('[data-action="delete"]').addEventListener("click", () => {
    state.confirmDeleteTaskId = task.id;
    renderTaskDetail();
  });
  elements.taskDetail.querySelectorAll("[data-jump-task]").forEach((button) => {
    button.addEventListener("click", () => jumpToTask(button.dataset.jumpTask));
  });

  const confirmBlock = elements.taskDetail.querySelector("[data-delete-confirm]");
  if (confirmBlock) {
    confirmBlock.querySelector("[data-delete-unlink]")?.addEventListener("click", () => performDelete(task, "unlink"));
    confirmBlock.querySelector("[data-delete-transfer]")?.addEventListener("click", () => performDelete(task, "transfer"));
    confirmBlock.querySelector("[data-delete-cancel]").addEventListener("click", () => {
      state.confirmDeleteTaskId = null;
      renderTaskDetail();
    });
  }

  const stepsForm = elements.taskDetail.querySelector("#steps-form");
  stepsForm.addEventListener("submit", handleStepsSubmit);
  loadTaskSteps(task);

  if (!state.taskRefs[task.id] || !state.taskGit[task.id]) {
    ensureRowData(task.id);
  }
}

function bindGhostSelectors(detailForm) {
  elements.taskDetail.querySelectorAll(".ghost-select").forEach((control) => {
    const field = control.dataset.metaField;
    const hiddenInput = detailForm.elements[field];
    if (!field || !hiddenInput) return;
    control.querySelectorAll("[data-meta-value]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const value = button.dataset.metaValue || "";
        hiddenInput.value = value;
        control.querySelector("summary strong").textContent = value || "empty";
        control.querySelectorAll("[data-meta-value]").forEach((option) => {
          option.classList.toggle("active", option === button);
        });
        control.open = false;
      });
    });
  });
}

function resizeTitleEditor(editor) {
  editor.style.height = "auto";
  editor.style.height = `${editor.scrollHeight}px`;
}

function dependencyValues(detailForm) {
  return [...detailForm.querySelectorAll("[data-dependency]")].map((row) => row.dataset.dependency).filter(Boolean);
}

function syncDependencyInput(detailForm) {
  const input = detailForm.elements.dependencies;
  if (input) {
    input.value = dependencyValues(detailForm).join(", ");
  }
}

function rerenderDependencyList(detailForm, dependencies) {
  const list = detailForm.querySelector("[data-dependency-list]");
  if (!list) return;
  list.innerHTML = dependencies.length
    ? dependencies.map((dependency) => renderDependencyRow(dependency)).join("")
    : `<div class="muted">No dependencies linked.</div>`;
  syncDependencyInput(detailForm);
  bindDependencyRows(detailForm);
}

function bindDependencyRows(detailForm) {
  detailForm.querySelectorAll("[data-dependency-remove]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      const dependency = button.dataset.dependencyRemove;
      const next = dependencyValues(detailForm).filter((item) => item !== dependency);
      rerenderDependencyList(detailForm, next);
    });
  });

  detailForm.querySelectorAll("[data-dependency-toggle]").forEach((checkbox) => {
    checkbox.addEventListener("change", handleDependencyToggle);
  });
}

function bindDependencyEditor(detailForm) {
  bindDependencyRows(detailForm);
  const addButton = detailForm.querySelector("[data-dependency-add]");
  const addInput = detailForm.querySelector("[data-dependency-input]");
  if (!addButton || !addInput) return;

  const addDependencyFromInput = () => {
    const dependency = addInput.value.trim();
    if (!dependency) return;
    const next = [...new Set([...dependencyValues(detailForm), dependency])];
    addInput.value = "";
    rerenderDependencyList(detailForm, next);
  };

  addButton.addEventListener("click", (event) => {
    event.preventDefault();
    addDependencyFromInput();
  });
  addInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addDependencyFromInput();
    }
  });
}

/* ---------- capture form handlers (reused) ---------- */

async function handleProjectSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  try {
    await api("/api/projects", {
      method: "POST",
      body: JSON.stringify({
        name: formData.get("name"),
        description: formData.get("description"),
      }),
    });
    form.reset();
    await refreshAll();
  } catch (error) {
    setMessage(`Project create failed: ${error.message}`, "error");
  }
}

async function handleTaskSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  try {
    await api("/api/tasks", {
      method: "POST",
      body: JSON.stringify({
        action: formData.get("action"),
        parent_project: formData.get("parent_project"),
        time: formData.get("time"),
        priority: formData.get("priority"),
      }),
    });
    form.reset();
    await refreshAll();
  } catch (error) {
    setMessage(`Task create failed: ${error.message}`, "error");
  }
}

async function handleIdeaSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  try {
    await api("/api/ideas", {
      method: "POST",
      body: JSON.stringify({
        idea: formData.get("idea"),
        share: formData.get("share"),
        importance: formData.get("importance"),
        tags: splitList(formData.get("tags")),
      }),
    });
    form.reset();
    await refreshAll();
    setMessage("Idea saved.");
  } catch (error) {
    setMessage(`Idea save failed: ${error.message}`, "error");
  }
}

async function handleMemorySubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  try {
    await api("/api/memories", {
      method: "POST",
      body: JSON.stringify({
        moment: formData.get("moment"),
        meaning: formData.get("meaning"),
        reason: formData.get("reason"),
        memory_type: formData.get("memory_type"),
        importance: "medium",
        term: formData.get("term"),
      }),
    });
    form.reset();
    await refreshAll();
    setMessage("Memory saved.");
  } catch (error) {
    setMessage(`Memory save failed: ${error.message}`, "error");
  }
}

async function handleErrorSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  try {
    await api("/api/errors", {
      method: "POST",
      body: JSON.stringify({
        title: formData.get("title"),
        description: formData.get("description"),
        source: formData.get("source"),
        severity: formData.get("severity"),
        category: "runtime",
      }),
    });
    form.reset();
    await refreshAll();
    setMessage("Error logged.");
  } catch (error) {
    setMessage(`Error log failed: ${error.message}`, "error");
  }
}

async function handleQueueSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  const payload = {
    task_name: formData.get("task_name"),
    task_description: formData.get("task_description"),
    priority: formData.get("priority"),
  };
  if (formData.get("project_id")) {
    payload.project_id = formData.get("project_id");
  }
  try {
    await api("/api/queue/plan", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    form.reset();
    await refreshAll();
    setMessage("Queue item planned.");
  } catch (error) {
    setMessage(`Queue plan failed: ${error.message}`, "error");
  }
}

async function handleTrainingSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  try {
    await api("/api/training", {
      method: "POST",
      body: JSON.stringify({
        prompt: formData.get("prompt"),
        completion: formData.get("completion"),
        data_type: formData.get("data_type"),
        source: formData.get("source") || "manual",
      }),
    });
    form.reset();
    await refreshAll();
    setMessage("Training pair saved.");
  } catch (error) {
    setMessage(`Training save failed: ${error.message}`, "error");
  }
}

/* ---------- steps (detail pane form) ---------- */

async function loadTaskSteps(task) {
  const stepsForm = elements.taskDetail.querySelector("#steps-form");
  if (!stepsForm) return;
  const status = stepsForm.querySelector("#steps-status");
  try {
    const data = state.taskSteps[task.id]?.data || (await api(`/api/tasks/${encodeURIComponent(task.id)}/steps`));
    state.taskSteps[task.id] = { data };
    const steps = normalizeSteps(data.steps);
    stepsForm.elements.steps.value = steps.map((step) => step.text).join("\n");
    stepsForm.elements.summary.value = data.summary || "";
    status.textContent = `${steps.filter((step) => step.done).length}/${steps.length} subtasks`;
  } catch (error) {
    status.textContent = `Steps unavailable: ${error.message}`;
  }
}

async function handleStepsSubmit(event) {
  event.preventDefault();
  const task = findTask(state.selectedTaskId);
  if (!task) return;
  const form = event.currentTarget;
  const existingSteps = normalizeSteps(state.taskSteps[task.id]?.data?.steps);
  const steps = String(form.elements.steps.value || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => ({
      text: line,
      done: existingSteps.find((step) => step.text === line)?.done || false,
    }));
  try {
    const data = await api(`/api/tasks/${encodeURIComponent(task.id)}/steps`, {
      method: "PUT",
      body: JSON.stringify({
        project_id: formatTaskProject(task),
        summary: form.elements.summary.value,
        steps,
      }),
    });
    state.taskSteps[task.id] = { data };
    await loadTaskSteps(task);
    renderTaskStream();
    setMessage(`Saved steps for ${task.id}.`);
  } catch (error) {
    setMessage(`Step save failed: ${error.message}`, "error");
  }
}

/* ---------- task-level actions ---------- */

async function handleDetailSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  const task = findTask(state.selectedTaskId);
  if (!task) return;

  const payload = {
    action: formData.get("action"),
    parent_project: formData.get("parent_project"),
    time: formData.get("time"),
    priority: formData.get("priority"),
    status: formData.get("status"),
    context_notes: formData.get("context_notes"),
    tags: String(formData.get("tags") || "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean),
    dependencies: String(formData.get("dependencies") || "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean),
    progress: formData.get("progress") === "" ? null : Number(formData.get("progress")),
  };

  try {
    await api(`/api/tasks/${encodeURIComponent(task.id)}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
    await refreshAll();
    setMessage(`Saved ${task.id}.`);
  } catch (error) {
    setMessage(`Task update failed: ${error.message}`, "error");
  }
}

async function handleTaskToggle(event) {
  event.stopPropagation();
  const checkbox = event.currentTarget;
  const taskId = checkbox.dataset.taskToggle;
  const task = findTask(taskId);
  if (!task) return;

  const done = checkbox.checked;
  checkbox.disabled = true;
  state.selectedTaskId = task.id;

  try {
    await api(`/api/tasks/${encodeURIComponent(task.id)}`, {
      method: "PUT",
      body: JSON.stringify({
        status: done ? "done" : "todo",
        progress: done ? 100 : null,
      }),
    });
    await refreshAll();
    setMessage(`${done ? "Completed" : "Reopened"} ${task.id}.`);
  } catch (error) {
    checkbox.checked = !done;
    checkbox.disabled = false;
    setMessage(`Task toggle failed: ${error.message}`, "error");
  }
}

async function handleDependencyToggle(event) {
  event.stopPropagation();
  const checkbox = event.currentTarget;
  const taskId = checkbox.dataset.dependencyToggle;
  const task = findTask(taskId);
  if (!task) return;

  const done = checkbox.checked;
  checkbox.disabled = true;

  try {
    await api(`/api/tasks/${encodeURIComponent(task.id)}`, {
      method: "PUT",
      body: JSON.stringify({
        status: done ? "done" : "todo",
        progress: done ? 100 : null,
      }),
    });
    await refreshAll();
    setMessage(`${done ? "Completed" : "Reopened"} dependency ${task.id}.`);
  } catch (error) {
    checkbox.checked = !done;
    checkbox.disabled = false;
    setMessage(`Dependency update failed: ${error.message}`, "error");
  }
}

/* ---------- omnibar: search + /task /idea /err capture ---------- */

async function handleOmniSubmit(event) {
  event.preventDefault();
  const raw = elements.omniInput.value.trim();
  if (!raw) {
    state.searchResults = null;
    renderTaskStream();
    return;
  }

  const taskMatch = raw.match(/^\/task\s+(.+)$/i);
  const ideaMatch = raw.match(/^\/idea\s+(.+)$/i);
  const errMatch = raw.match(/^\/err\s+(.+)$/i);
  const queueMatch = raw.match(/^\/queue\s+(.+)$/i);

  try {
    if (taskMatch) {
      await api("/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          action: taskMatch[1],
          parent_project: state.selectedProjectScope !== "all" ? state.selectedProjectScope : "general",
          priority: "medium",
        }),
      });
      elements.omniInput.value = "";
      state.searchResults = null;
      await refreshAll();
      setMessage("Task captured.");
      return;
    }
    if (ideaMatch) {
      await api("/api/ideas", { method: "POST", body: JSON.stringify({ idea: ideaMatch[1] }) });
      elements.omniInput.value = "";
      state.searchResults = null;
      await refreshAll();
      setMessage("Idea captured.");
      return;
    }
    if (errMatch) {
      await api("/api/errors", {
        method: "POST",
        body: JSON.stringify({
          title: errMatch[1].slice(0, 80),
          description: errMatch[1],
          source: "omnibar",
          severity: "medium",
        }),
      });
      elements.omniInput.value = "";
      state.searchResults = null;
      await refreshAll();
      setMessage("Error logged.");
      return;
    }
    if (queueMatch) {
      const payload = {
        task_name: queueMatch[1].slice(0, 80),
        task_description: queueMatch[1],
        priority: "medium",
      };
      if (state.selectedProjectScope !== "all") payload.project_id = state.selectedProjectScope;
      await api("/api/queue/plan", { method: "POST", body: JSON.stringify(payload) });
      elements.omniInput.value = "";
      state.searchResults = null;
      await refreshAll();
      setMessage("Queue item planned.");
      return;
    }

    state.searchQuery = raw;
    const results = await api(`/api/search?q=${encodeURIComponent(raw)}`);
    state.searchResults = Array.isArray(results) ? results : [];
    renderAll();
  } catch (error) {
    setMessage(`Capture/search failed: ${error.message}`, "error");
  }
}

/* ---------- keyboard shortcuts ---------- */

function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

function moveFocus(delta) {
  if (!state.visibleRowOrder.length) return;
  const currentIndex = state.visibleRowOrder.findIndex((row) => `${row.groupId}::${row.taskId}` === state.focusedRowKey);
  const nextIndex =
    currentIndex === -1
      ? (delta > 0 ? 0 : state.visibleRowOrder.length - 1)
      : Math.min(state.visibleRowOrder.length - 1, Math.max(0, currentIndex + delta));
  const next = state.visibleRowOrder[nextIndex];
  state.focusedRowKey = `${next.groupId}::${next.taskId}`;
  renderTaskStream();
  elements.taskStream.querySelector(`[data-row-key="${CSS.escape(state.focusedRowKey)}"]`)?.scrollIntoView({ block: "nearest" });
}

function cycleHideRule() {
  if (!HIDE_RULES.length) return;
  const rule = HIDE_RULES[hideRuleCursor % HIDE_RULES.length];
  hideRuleCursor += 1;
  viewState.hideRules[rule.key] = !viewState.hideRules[rule.key];
  saveViewState();
  renderAxisBar();
  renderTaskStream();
}

function toggleFoldAll() {
  const groups = buildGroups(viewState.axis);
  const allFolded = groups.length > 0 && groups.every((group) => viewState.foldedGroups[group.id]);
  for (const group of groups) {
    viewState.foldedGroups[group.id] = !allFolded;
  }
  saveViewState();
  renderTaskStream();
}

function handleGlobalKeydown(event) {
  if (isTypingTarget(event.target)) return;
  if (event.metaKey || event.ctrlKey || event.altKey) return;

  if (event.key === "j" || event.key === "k") {
    event.preventDefault();
    moveFocus(event.key === "j" ? 1 : -1);
  } else if (event.key === "Enter") {
    if (state.focusedRowKey) {
      event.preventDefault();
      const taskId = state.focusedRowKey.split("::").pop();
      toggleRowExpanded(taskId);
    }
  } else if (event.key === "g") {
    event.preventDefault();
    const index = AXES.findIndex((axis) => axis.key === viewState.axis);
    viewState.axis = AXES[(index + 1) % AXES.length].key;
    saveViewState();
    renderAxisBar();
    renderTaskStream();
  } else if (event.key === "z") {
    if (state.focusedRowKey) {
      event.preventDefault();
      const groupId = state.focusedRowKey.split("::").slice(0, -1).join("::");
      viewState.foldedGroups[groupId] = !viewState.foldedGroups[groupId];
      saveViewState();
      renderTaskStream();
    }
  } else if (event.key === "Z") {
    event.preventDefault();
    toggleFoldAll();
  } else if (event.key === "h") {
    event.preventDefault();
    cycleHideRule();
  }
}

/* ---------- boot ---------- */

async function bulkLoadSteps(force = false) {
  const tasks = state.bootstrap?.tasks || [];
  await Promise.all(
    tasks.map(async (task) => {
      if (!force && state.taskSteps[task.id]?.data) return;
      state.taskSteps[task.id] = { loading: true };
      try {
        const data = await api(`/api/tasks/${encodeURIComponent(task.id)}/steps`);
        state.taskSteps[task.id] = { data };
      } catch (error) {
        state.taskSteps[task.id] = { error: error.message };
      }
    }),
  );
}

async function bulkLoadRefs(force = false) {
  const tasks = state.bootstrap?.tasks || [];
  await Promise.all(
    tasks.map(async (task) => {
      if (!force && state.taskRefs[task.id]?.data) return;
      state.taskRefs[task.id] = { loading: true };
      try {
        const data = await api(`/api/tasks/${encodeURIComponent(task.id)}/refs`);
        state.taskRefs[task.id] = { data };
      } catch (error) {
        state.taskRefs[task.id] = { error: error.message };
      }
    }),
  );
}

async function refreshAll() {
  clearMessage();
  elements.refreshBtn.disabled = true;
  elements.refreshBtn.textContent = "Refreshing...";
  try {
    const [bootstrap, platform] = await Promise.all([api("/api/bootstrap"), api("/api/platform")]);
    state.bootstrap = bootstrap;
    state.platform = platform;
    invalidateRelationshipCache();
    state.taskSteps = {};
    state.taskRefs = {};
    state.taskGit = {};
    if (!state.selectedTaskId || !findTask(state.selectedTaskId) || taskIsDeleted(findTask(state.selectedTaskId))) {
      state.selectedTaskId = allTasks()[0]?.id || null;
    }
    await Promise.all([bulkLoadSteps(true), bulkLoadRefs(true)]);
    const expandedIds = Object.keys(viewState.expandedRows).filter((id) => viewState.expandedRows[id]);
    await Promise.all(expandedIds.map((id) => ensureRowData(id)));
    renderAll();
    renderSyncIndicator(true);
  } catch (error) {
    setMessage(`Refresh failed: ${error.message}`, "error");
    renderSyncIndicator(false);
  } finally {
    elements.refreshBtn.disabled = false;
    elements.refreshBtn.textContent = "Refresh";
  }
}

function renderAll() {
  renderStats();
  renderTopStats();
  renderAxisBar();
  renderViews();
  renderProjects();
  renderTaskStream();
  renderTaskDetail();
  if (!elements.platformPanel.hidden) {
    renderPlatformResources();
  }
}

function bindStatic() {
  Object.assign(elements, {
    refreshBtn: $("refresh-btn"),
    omniForm: $("omni-form"),
    omniInput: $("omni-input"),
    statQueue: $("stat-queue"),
    statErrors: $("stat-errors"),
    syncIndicator: $("sync-indicator"),
    axisChips: $("axis-chips"),
    hideChips: $("hide-chips"),
    foldAllBtn: $("fold-all-btn"),
    unfoldAllBtn: $("unfold-all-btn"),
    effortToggleBtn: $("effort-toggle-btn"),
    axisStatus: $("axis-status"),
    viewsList: $("views-list"),
    projectList: $("project-list"),
    projectCount: $("project-count"),
    railQueue: $("rail-queue"),
    railIdeas: $("rail-ideas"),
    railErrors: $("rail-errors"),
    projectForm: $("project-form"),
    taskForm: $("task-form"),
    taskProject: $("task-project"),
    ideaForm: $("idea-form"),
    memoryForm: $("memory-form"),
    errorForm: $("error-form"),
    queueForm: $("queue-form"),
    trainingForm: $("training-form"),
    capturePanel: $("capture-panel"),
    platformPanel: $("platform-panel"),
    stats: $("stats"),
    taskCount: $("task-count"),
    taskStream: $("task-stream"),
    taskDetail: $("task-detail"),
    platformCount: $("platform-count"),
    platformTabs: $("platform-tabs"),
    platformList: $("platform-list"),
    foldSummary: $("fold-summary"),
  });
}

function wireEvents() {
  elements.effortToggleBtn.classList.toggle("active", viewState.showEffort);
  elements.refreshBtn.addEventListener("click", refreshAll);
  elements.omniForm.addEventListener("submit", handleOmniSubmit);
  elements.omniInput.addEventListener("input", () => {
    if (!elements.omniInput.value.trim()) {
      state.searchResults = null;
      renderTaskStream();
    }
  });
  elements.foldAllBtn.addEventListener("click", () => {
    const groups = buildGroups(viewState.axis);
    for (const group of groups) viewState.foldedGroups[group.id] = true;
    saveViewState();
    renderTaskStream();
  });
  elements.unfoldAllBtn.addEventListener("click", () => {
    viewState.foldedGroups = {};
    saveViewState();
    renderTaskStream();
  });
  elements.effortToggleBtn.addEventListener("click", () => {
    viewState.showEffort = !viewState.showEffort;
    saveViewState();
    elements.effortToggleBtn.classList.toggle("active", viewState.showEffort);
    renderTaskStream();
  });
  elements.projectForm.addEventListener("submit", handleProjectSubmit);
  elements.taskForm.addEventListener("submit", handleTaskSubmit);
  elements.ideaForm.addEventListener("submit", handleIdeaSubmit);
  elements.memoryForm.addEventListener("submit", handleMemorySubmit);
  elements.errorForm.addEventListener("submit", handleErrorSubmit);
  elements.queueForm.addEventListener("submit", handleQueueSubmit);
  elements.trainingForm.addEventListener("submit", handleTrainingSubmit);
  document.querySelectorAll("[data-panel-toggle]").forEach((button) => {
    button.addEventListener("click", () => togglePanel(button.dataset.panelToggle, button.dataset.panelResource));
  });
  document.addEventListener("keydown", handleGlobalKeydown);
}

function boot() {
  bindStatic();
  wireEvents();
  refreshAll().catch((error) => setMessage(`Boot failed: ${error.message}`, "error"));

  setInterval(() => {
    if (!document.hidden) {
      refreshAll().catch(() => {});
    }
  }, 5 * 60 * 1000);
}

document.addEventListener("DOMContentLoaded", () => {
  boot();
});
