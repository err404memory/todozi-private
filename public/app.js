const state = {
  bootstrap: null,
  selectedProject: "all",
  selectedTaskId: null,
  filteredTasks: [],
  searchQuery: "",
  remoteSearchResults: null,
  selectedTaskRaw: null,
  message: null,
};

const elements = {};

function $(id) {
  return document.getElementById(id);
}

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

async function refreshAll() {
  clearMessage();
  elements.refreshBtn.disabled = true;
  elements.refreshBtn.textContent = "Refreshing...";
  try {
    state.bootstrap = await api("/api/bootstrap");
    state.filteredTasks = state.bootstrap.tasks || [];
    if (!state.selectedTaskId && state.filteredTasks.length > 0) {
      state.selectedTaskId = state.filteredTasks[0].id;
    }
    syncTaskProjectOptions();
    applyViewFilters();
  } catch (error) {
    setMessage(`Refresh failed: ${error.message}`, "error");
  } finally {
    elements.refreshBtn.disabled = false;
    elements.refreshBtn.textContent = "Refresh";
  }
}

function syncTaskProjectOptions() {
  const projects = state.bootstrap?.projects || [];
  const options = [
    `<option value="general">general</option>`,
    ...projects
      .map((project) => {
        const name = project.name || project.project_name || "";
        if (!name || name === "general") {
          return null;
        }
        return `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`;
      })
      .filter(Boolean),
  ];
  elements.taskProject.innerHTML = options.join("");
}

function applyViewFilters() {
  if (!state.bootstrap) {
    return;
  }

  let tasks = Array.isArray(state.bootstrap.tasks) ? [...state.bootstrap.tasks] : [];
  if (state.selectedProject !== "all") {
    tasks = tasks.filter((task) => formatTaskProject(task) === state.selectedProject);
  }

  if (state.searchQuery) {
    const needle = state.searchQuery.toLowerCase();
    tasks = tasks.filter((task) => JSON.stringify(task).toLowerCase().includes(needle));
  }

  tasks.sort((left, right) => {
    const a = new Date(left.updated_at || left.created_at || 0).getTime();
    const b = new Date(right.updated_at || right.created_at || 0).getTime();
    return b - a;
  });

  state.filteredTasks = tasks;

  if (!tasks.some((task) => task.id === state.selectedTaskId)) {
    state.selectedTaskId = tasks[0]?.id || null;
  }

  renderAll();
}

function renderStats() {
  const projects = state.bootstrap?.projects || [];
  const tasks = state.bootstrap?.tasks || [];
  const queue = state.bootstrap?.activeQueue || [];
  const activeTasks = tasks.filter((task) => String(formatStatus(task)).toLowerCase() !== "done");

  const cards = [
    { label: "Projects", value: projects.length },
    { label: "Tasks", value: tasks.length },
    { label: "Active", value: activeTasks.length },
    { label: "Queue", value: queue.length },
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

function renderProjects() {
  const projects = state.bootstrap?.projects || [];
  const counts = new Map();

  for (const task of state.bootstrap?.tasks || []) {
    const project = formatTaskProject(task);
    counts.set(project, (counts.get(project) || 0) + 1);
  }

  const items = [
    { name: "all", description: "Everything" },
    ...projects
      .map((project) => ({
        name: project.name || project.project_name || "",
        description: project.description || "",
      }))
      .filter((project) => project.name),
  ];

  elements.projectCount.textContent = String(items.length - 1);
  elements.projectList.innerHTML = items
    .map((project) => {
      const count = project.name === "all" ? state.bootstrap?.tasks?.length || 0 : counts.get(project.name) || 0;
      const isActive = state.selectedProject === project.name;
      return `
        <button type="button" class="project-item ${isActive ? "active" : ""}" data-project="${escapeHtml(project.name)}">
          <span class="project-title">${escapeHtml(project.name)}</span>
          <span class="project-meta">${escapeHtml(project.description || (project.name === "all" ? "Unfiltered view" : "No description"))}</span>
          <span class="project-meta">${count} tasks</span>
        </button>
      `;
    })
    .join("");

  elements.taskProject.innerHTML = [
    `<option value="general">general</option>`,
    ...projects
      .map((project) => {
        const name = project.name || project.project_name || "";
        if (!name || name === "general") {
          return null;
        }
        return `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`;
      })
      .filter(Boolean),
  ].join("");

  const chip = elements.filterChip;
  chip.textContent = state.selectedProject === "all" ? "All projects" : `Project: ${state.selectedProject}`;
  chip.classList.toggle("active", state.selectedProject !== "all");
}

function renderTasks() {
  const tasks = state.filteredTasks || [];
  elements.taskCount.textContent = String(tasks.length);
  elements.taskList.innerHTML = tasks.length
    ? tasks
        .map((task) => {
          const active = task.id === state.selectedTaskId;
          const tags = formatTags(task)
            .slice(0, 5)
            .map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`)
            .join("");
          const status = formatStatus(task);
          return `
            <article class="task-card ${active ? "active" : ""}" data-task="${escapeHtml(task.id)}">
              <div class="task-top">
                <div>
                  <div class="task-title">${escapeHtml(task.action || task.title || task.id)}</div>
                  <div class="task-status">
                    <strong>${escapeHtml(task.id)}</strong>
                    <span> · </span>
                    <span>${escapeHtml(formatTaskProject(task))}</span>
                    <span> · </span>
                    <span>${escapeHtml(formatPriority(task))}</span>
                    <span> · </span>
                    <span class="tone-${statusTone(status)}">${escapeHtml(status)}</span>
                  </div>
                </div>
                <span class="badge">${escapeHtml(task.time || "ASAP")}</span>
              </div>
              <div class="task-tags">${tags}</div>
            </article>
          `;
        })
        .join("")
    : `<div class="muted">No tasks in this view.</div>`;

  const searchLabel = elements.searchChip;
  if (state.searchQuery) {
    searchLabel.textContent = `Search: ${state.searchQuery}`;
    searchLabel.classList.remove("hidden");
  } else {
    searchLabel.classList.add("hidden");
  }
}

function renderTaskDetail() {
  const task = (state.bootstrap?.tasks || []).find((item) => item.id === state.selectedTaskId) || null;
  if (!task) {
    elements.taskDetail.innerHTML = `
      <div class="detail-empty">
        Pick a task to inspect or edit it.
      </div>
    `;
    return;
  }

  const message = state.message
    ? `<div class="${state.message.kind === "error" ? "error" : "help"}">${escapeHtml(state.message.text)}</div>`
    : "";

  elements.taskDetail.innerHTML = `
    ${message}
    <div class="muted">${escapeHtml(task.id)}</div>
    <h3 style="margin-bottom: 0.35rem;">${escapeHtml(task.action || task.title || task.id)}</h3>
    <div class="muted" style="margin-bottom: 0.85rem;">
      ${escapeHtml(formatTaskProject(task))} · ${escapeHtml(formatPriority(task))} · ${escapeHtml(formatStatus(task))}
    </div>
    <pre class="detail-pre">${escapeHtml(JSON.stringify(task, null, 2))}</pre>

    <form id="detail-form" class="detail-form">
      <label>
        Action
        <textarea name="action" rows="3">${escapeHtml(task.action || "")}</textarea>
      </label>
      <div class="row">
        <label>
          Project
          <select name="parent_project"></select>
        </label>
        <label>
          Priority
          <select name="priority">
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
            <option value="urgent">urgent</option>
          </select>
        </label>
      </div>
      <div class="row">
        <label>
          Time
          <input name="time" value="${escapeHtml(task.time || "")}" />
        </label>
        <label>
          Status
          <input name="status" value="${escapeHtml(task.status || "")}" />
        </label>
      </div>
      <label>
        Notes
        <textarea name="context_notes" rows="4">${escapeHtml(task.context_notes || "")}</textarea>
      </label>
      <div class="row">
        <label>
          Tags
          <input name="tags" value="${escapeHtml(asTextList(task.tags))}" placeholder="tag1, tag2" />
        </label>
        <label>
          Dependencies
          <input name="dependencies" value="${escapeHtml(asTextList(task.dependencies))}" placeholder="task_123, task_456" />
        </label>
      </div>
      <div class="row">
        <label>
          Progress
          <input name="progress" value="${escapeHtml(task.progress ?? "")}" placeholder="0-100" />
        </label>
      </div>
      <div class="detail-actions">
        <button type="submit">Save task</button>
        <button type="button" class="secondary" data-action="done">Mark done</button>
        <button type="button" class="danger" data-action="delete">Delete</button>
      </div>
    </form>
  `;

  const detailForm = elements.taskDetail.querySelector("#detail-form");
  const projectSelect = detailForm.querySelector('select[name="parent_project"]');
  const projects = state.bootstrap?.projects || [];
  projectSelect.innerHTML = [
    `<option value="general">general</option>`,
    ...projects
      .map((project) => {
        const name = project.name || project.project_name || "";
        if (!name || name === "general") {
          return null;
        }
        return `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`;
      })
      .filter(Boolean),
  ].join("");
  projectSelect.value = formatTaskProject(task);
  detailForm.querySelector('select[name="priority"]').value = formatPriority(task);
  detailForm.querySelector('input[name="status"]').value = formatStatus(task);

  detailForm.addEventListener("submit", handleDetailSubmit);
  detailForm.querySelector('[data-action="done"]').addEventListener("click", handleMarkDone);
  detailForm.querySelector('[data-action="delete"]').addEventListener("click", handleDeleteTask);
}

function renderAll() {
  renderStats();
  renderProjects();
  renderTasks();
  renderTaskDetail();
}

function bindProjectButtons() {
  elements.projectList.querySelectorAll("[data-project]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedProject = button.dataset.project;
      applyViewFilters();
    });
  });
}

function bindTaskCards() {
  elements.taskList.querySelectorAll("[data-task]").forEach((card) => {
    card.addEventListener("click", () => {
      state.selectedTaskId = card.dataset.task;
      renderTaskDetail();
      renderTasks();
    });
  });
}

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

async function handleDetailSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  const task = (state.bootstrap?.tasks || []).find((item) => item.id === state.selectedTaskId);
  if (!task) {
    return;
  }

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

async function handleMarkDone(event) {
  event.preventDefault();
  const task = (state.bootstrap?.tasks || []).find((item) => item.id === state.selectedTaskId);
  if (!task) {
    return;
  }

  try {
    await api(`/api/tasks/${encodeURIComponent(task.id)}`, {
      method: "PUT",
      body: JSON.stringify({ status: "done", progress: 100 }),
    });
    await refreshAll();
    setMessage(`Marked ${task.id} done.`);
  } catch (error) {
    setMessage(`Mark-done failed: ${error.message}`, "error");
  }
}

async function handleDeleteTask(event) {
  event.preventDefault();
  const task = (state.bootstrap?.tasks || []).find((item) => item.id === state.selectedTaskId);
  if (!task) {
    return;
  }

  if (!window.confirm(`Delete ${task.id}?`)) {
    return;
  }

  try {
    await api(`/api/tasks/${encodeURIComponent(task.id)}`, {
      method: "DELETE",
    });
    state.selectedTaskId = null;
    await refreshAll();
    setMessage(`Deleted ${task.id}.`);
  } catch (error) {
    setMessage(`Delete failed: ${error.message}`, "error");
  }
}

async function handleSearchSubmit(event) {
  event.preventDefault();
  const query = elements.searchInput.value.trim();
  state.searchQuery = query;
  if (!query) {
    applyViewFilters();
    return;
  }

  try {
    const results = await api(`/api/search?q=${encodeURIComponent(query)}`);
    state.remoteSearchResults = results;
    state.filteredTasks = Array.isArray(results) ? results : [];
    state.selectedTaskId = state.filteredTasks[0]?.id || null;
    renderAll();
    bindProjectButtons();
    bindTaskCards();
  } catch (error) {
    setMessage(`Search failed: ${error.message}`, "error");
  }
}

function resetSearch() {
  elements.searchInput.value = "";
  state.searchQuery = "";
  state.remoteSearchResults = null;
  applyViewFilters();
}

function wireEvents() {
  elements.refreshBtn.addEventListener("click", refreshAll);
  elements.projectForm.addEventListener("submit", handleProjectSubmit);
  elements.taskForm.addEventListener("submit", handleTaskSubmit);
  elements.searchForm.addEventListener("submit", handleSearchSubmit);
  elements.clearSearch.addEventListener("click", resetSearch);
}

function bindStatic() {
  Object.assign(elements, {
    refreshBtn: $("refresh-btn"),
    projectForm: $("project-form"),
    taskForm: $("task-form"),
    searchForm: $("search-form"),
    searchInput: $("search-input"),
    clearSearch: $("clear-search"),
    projectList: $("project-list"),
    taskList: $("task-list"),
    taskDetail: $("task-detail"),
    stats: $("stats"),
    projectCount: $("project-count"),
    taskCount: $("task-count"),
    taskProject: $("task-project"),
    filterChip: $("filter-chip"),
    searchChip: $("search-chip"),
  });
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
