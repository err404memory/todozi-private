const state = {
  bootstrap: null,
  selectedMode: "projects",
  selectedProject: "all",
  statusFilter: "all",
  priorityFilter: "all",
  selectedTaskId: null,
  filteredTasks: [],
  searchQuery: "",
  remoteSearchResults: null,
  selectedTaskRaw: null,
  platform: null,
  selectedResource: "agents",
  message: null,
  expandedStepTasks: new Set(),
  taskSteps: {},
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

function stepText(step) {
  return normalizeStep(step).text;
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

function renderTagSummary(tags) {
  const items = Array.isArray(tags) ? tags.filter(Boolean) : [];
  return items.length
    ? `<div class="detail-tags">${items.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div>`
    : `<div class="detail-tags muted">No tags</div>`;
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
          <small>${escapeHtml(dependency)} · ${escapeHtml(status)}</small>
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

async function refreshAll() {
  clearMessage();
  elements.refreshBtn.disabled = true;
  elements.refreshBtn.textContent = "Refreshing...";
  try {
    state.bootstrap = await api("/api/bootstrap");
    state.platform = await api("/api/platform");
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
    `<option value="all">all</option>`,
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
  const projectOptions = options.join("");
  elements.taskProject.innerHTML = projectOptions.replace('<option value="all">all</option>', "");
  elements.projectFilter.innerHTML = projectOptions;
  elements.projectFilter.value = state.selectedProject;
}

function applyViewFilters() {
  if (!state.bootstrap) {
    return;
  }

  let tasks = Array.isArray(state.bootstrap.tasks) ? [...state.bootstrap.tasks] : [];
  if (state.selectedMode === "done") {
    tasks = tasks.filter(taskIsDone);
  } else if (state.selectedMode === "tasks") {
    tasks = tasks.filter((task) => !taskIsDone(task));
  }

  if (state.selectedProject !== "all") {
    tasks = tasks.filter((task) => formatTaskProject(task) === state.selectedProject);
  }

  if (state.statusFilter !== "all") {
    tasks = tasks.filter((task) => normalizedStatus(task) === state.statusFilter);
  }

  if (state.priorityFilter !== "all") {
    tasks = tasks.filter((task) => String(formatPriority(task)).toLowerCase() === state.priorityFilter);
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
          const done = taskIsDone(task);
          const tags = formatTags(task)
            .slice(0, 5)
            .map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`)
            .join("");
          const status = formatStatus(task);
          const stepState = state.taskSteps[task.id];
          const stepData = stepState?.data || null;
          const steps = normalizeSteps(stepData?.steps);
          const stepCount = Array.isArray(stepData?.steps) ? steps.length : null;
          const doneStepCount = steps.filter((step) => step.done).length;
          const stepsExpanded = state.expandedStepTasks.has(task.id);
          const note = String(task.context_notes || stepData?.summary || "").trim();
          return `
            <article class="task-card ${active ? "active" : ""} ${done ? "done" : ""}" data-task="${escapeHtml(task.id)}">
              <div class="task-top">
                <label class="task-toggle" title="${done ? "Mark todo" : "Mark done"}">
                  <input
                    type="checkbox"
                    data-task-toggle="${escapeHtml(task.id)}"
                    ${done ? "checked" : ""}
                    aria-label="${escapeHtml(`${done ? "Mark todo" : "Mark done"}: ${task.action || task.title || task.id}`)}"
                  />
                  <span aria-hidden="true"></span>
                </label>
                <div class="task-main">
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
              ${note ? `<div class="task-note">${escapeHtml(note)}</div>` : ""}
              <div class="task-tags">${tags}</div>
              <div class="task-card-actions">
                <button
                  type="button"
                  class="steps-toggle"
                  data-step-toggle="${escapeHtml(task.id)}"
                  aria-expanded="${stepsExpanded ? "true" : "false"}"
                  title="${stepsExpanded ? "Hide subtasks" : "Show subtasks"}"
                >
                  <span class="steps-marker" aria-hidden="true">${stepsExpanded ? "&#9662;" : "&#9656;"}</span>
                  <span>Sub-actions</span>
                  <span class="steps-count">${stepCount === null ? "?" : escapeHtml(`${doneStepCount}/${stepCount}`)}</span>
                </button>
              </div>
              ${stepsExpanded ? renderTaskCardSteps(task, stepState) : ""}
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

function renderTaskCardSteps(task, stepState) {
  if (stepState?.loading) {
    return `<div class="task-steps-panel"><div class="muted">Loading steps...</div></div>`;
  }

  if (stepState?.error) {
    return `<div class="task-steps-panel"><div class="error">Steps unavailable: ${escapeHtml(stepState.error)}</div></div>`;
  }

  const data = stepState?.data || null;
  const steps = normalizeSteps(data?.steps);
  const summary = data?.summary || "";

  if (!summary && steps.length === 0) {
    return `
      <div class="task-steps-panel">
        <div class="muted">No sub-actions yet. Add steps in the side panel.</div>
      </div>
    `;
  }

  return `
    <div class="task-steps-panel">
      ${summary ? `<div class="task-steps-summary">${escapeHtml(summary)}</div>` : ""}
      ${
        steps.length
          ? `
            <div class="task-steps-list">
              ${steps
                .map(
                  (step, index) => `
                    <label class="subtask-row ${step.done ? "done" : ""}">
                      <input
                        type="checkbox"
                        data-step-check="${escapeHtml(task.id)}"
                        data-step-index="${escapeHtml(index)}"
                        ${step.done ? "checked" : ""}
                      />
                      <span>${escapeHtml(step.text)}</span>
                    </label>
                  `,
                )
                .join("")}
            </div>
          `
          : `<div class="muted">No sub-actions saved yet.</div>`
      }
    </div>
  `;
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
  const projects = state.bootstrap?.projects || [];
  const projectOptions = [
    "general",
    ...projects
      .map((project) => project.name || project.project_name || "")
      .filter((name) => name && name !== "general"),
  ];
  const priorityOptions = ["low", "medium", "high", "urgent"];
  const statusOptions = ["todo", "in_progress", "inprogress", "done", "completed", "blocked", "cancelled"];
  const projectValue = formatTaskProject(task);
  const priorityValue = formatPriority(task);
  const statusValue = formatStatus(task);
  const done = taskIsDone(task);

  elements.taskDetail.innerHTML = `
    ${message}
    <div class="detail-title-row">
      <textarea
        class="detail-title-input"
        name="action"
        form="detail-form"
        rows="2"
        aria-label="Task title"
      >${escapeHtml(taskTitle(task))}</textarea>
      <label class="detail-complete-toggle" title="${done ? "Mark todo" : "Mark done"}">
        <input
          type="checkbox"
          data-task-toggle="${escapeHtml(task.id)}"
          ${done ? "checked" : ""}
          aria-label="${escapeHtml(`${done ? "Mark todo" : "Mark done"}: ${taskTitle(task)}`)}"
        />
        <span aria-hidden="true"></span>
      </label>
    </div>
    <div class="muted detail-task-id">${escapeHtml(task.id)}</div>
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
        <button type="button" class="danger" data-action="delete">Delete</button>
      </div>
    </form>

    <form id="steps-form" class="steps-form">
      <div class="panel-header compact">
        <h3>Edit steps</h3>
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
  detailForm.querySelector('[data-action="delete"]').addEventListener("click", handleDeleteTask);
  const stepsForm = elements.taskDetail.querySelector("#steps-form");
  stepsForm.addEventListener("submit", handleStepsSubmit);
  loadTaskSteps(task);
}

function bindGhostSelectors(detailForm) {
  elements.taskDetail.querySelectorAll(".ghost-select").forEach((control) => {
    const field = control.dataset.metaField;
    const hiddenInput = detailForm.elements[field];
    if (!field || !hiddenInput) {
      return;
    }
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
  return [...detailForm.querySelectorAll("[data-dependency]")]
    .map((row) => row.dataset.dependency)
    .filter(Boolean);
}

function syncDependencyInput(detailForm) {
  const input = detailForm.elements.dependencies;
  if (input) {
    input.value = dependencyValues(detailForm).join(", ");
  }
}

function rerenderDependencyList(detailForm, dependencies) {
  const list = detailForm.querySelector("[data-dependency-list]");
  if (!list) {
    return;
  }
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
  if (!addButton || !addInput) {
    return;
  }

  const addDependency = () => {
    const dependency = addInput.value.trim();
    if (!dependency) {
      return;
    }
    const next = [...new Set([...dependencyValues(detailForm), dependency])];
    addInput.value = "";
    rerenderDependencyList(detailForm, next);
  };

  addButton.addEventListener("click", (event) => {
    event.preventDefault();
    addDependency();
  });
  addInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addDependency();
    }
  });
}

function renderAll() {
  renderStats();
  renderProjects();
  renderTasks();
  renderTaskDetail();
  renderPlatformResources();
  renderModePanels();
  bindProjectButtons();
  bindTaskCards();
}

function renderModePanels() {
  document.body.dataset.mode = state.selectedMode;
  elements.modeTabs.forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.mode === state.selectedMode);
  });
  elements.modePanels.forEach((panel) => {
    const modes = String(panel.dataset.panel || "").split(/\s+/);
    panel.hidden = !modes.includes(state.selectedMode);
  });
}

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

function platformValue(key) {
  if (key === "activeQueue") return state.bootstrap?.activeQueue || [];
  if (key === "analytics") return state.bootstrap?.analytics || null;
  return state.platform?.data?.[key] ?? null;
}

function renderPlatformResources() {
  if (!elements.platformTabs || !elements.platformList) {
    return;
  }
  const resources = RESOURCE_ORDER.map(([key, label]) => {
    const value = platformValue(key);
    return { key, label, count: resourceItems(value).length, value };
  });

  elements.platformCount.textContent = String(resources.reduce((total, resource) => total + resource.count, 0));
  elements.platformTabs.innerHTML = resources
    .map(
      (resource) => `
        <button type="button" class="resource-tab ${state.selectedResource === resource.key ? "active" : ""}" data-resource="${escapeHtml(resource.key)}">
          ${escapeHtml(resource.label)}
          <span>${escapeHtml(resource.count)}</span>
        </button>
      `,
    )
    .join("");

  const selected = resources.find((resource) => resource.key === state.selectedResource) || resources[0];
  state.selectedResource = selected?.key || "agents";
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

  bindResourceTabs();
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
  elements.taskList.querySelectorAll("[data-task-toggle]").forEach((checkbox) => {
    checkbox.addEventListener("click", (event) => {
      event.stopPropagation();
    });
    checkbox.addEventListener("change", handleTaskToggle);
  });

  elements.taskList.querySelectorAll("[data-step-toggle]").forEach((button) => {
    button.addEventListener("click", handleStepToggle);
  });

  elements.taskList.querySelectorAll("[data-step-check]").forEach((checkbox) => {
    checkbox.addEventListener("click", (event) => {
      event.stopPropagation();
    });
    checkbox.addEventListener("change", handleStepCheck);
  });

  elements.taskList.querySelectorAll("[data-task]").forEach((card) => {
    card.addEventListener("click", () => {
      const taskId = card.dataset.task;
      const alreadySelected = state.selectedTaskId === taskId;
      const shouldExpand = alreadySelected ? !state.expandedStepTasks.has(taskId) : true;
      state.selectedTaskId = taskId;
      if (shouldExpand) {
        state.expandedStepTasks.add(taskId);
      } else {
        state.expandedStepTasks.delete(taskId);
      }
      renderTaskDetail();
      if (!shouldExpand || state.taskSteps[taskId]?.data || state.taskSteps[taskId]?.loading) {
        renderTasks();
        bindTaskCards();
      } else {
        loadTaskCardSteps(taskId);
      }
    });
  });
}

function bindResourceTabs() {
  elements.platformTabs.querySelectorAll("[data-resource]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedResource = button.dataset.resource;
      renderPlatformResources();
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

async function loadTaskSteps(task) {
  const stepsForm = elements.taskDetail.querySelector("#steps-form");
  if (!stepsForm) return;
  const status = stepsForm.querySelector("#steps-status");
  try {
    const data = await api(`/api/tasks/${encodeURIComponent(task.id)}/steps`);
    state.taskSteps[task.id] = { data };
    const steps = normalizeSteps(data.steps);
    stepsForm.elements.steps.value = steps.map((step) => step.text).join("\n");
    stepsForm.elements.summary.value = data.summary || "";
    status.textContent = `${steps.filter((step) => step.done).length}/${steps.length} subtasks`;
  } catch (error) {
    status.textContent = `Steps unavailable: ${error.message}`;
  }
}

async function loadTaskCardSteps(taskId) {
  state.taskSteps[taskId] = { loading: true };
  renderTasks();
  bindTaskCards();
  try {
    const data = await api(`/api/tasks/${encodeURIComponent(taskId)}/steps`);
    state.taskSteps[taskId] = { data };
  } catch (error) {
    state.taskSteps[taskId] = { error: error.message };
  }
  renderTasks();
  bindTaskCards();
}

function handleStepToggle(event) {
  event.preventDefault();
  event.stopPropagation();
  const taskId = event.currentTarget.dataset.stepToggle;
  if (!taskId) {
    return;
  }

  if (state.expandedStepTasks.has(taskId)) {
    state.expandedStepTasks.delete(taskId);
    renderTasks();
    bindTaskCards();
    return;
  }

  state.expandedStepTasks.add(taskId);
  if (state.taskSteps[taskId]?.data || state.taskSteps[taskId]?.loading) {
    renderTasks();
    bindTaskCards();
    return;
  }
  loadTaskCardSteps(taskId);
}

async function handleStepCheck(event) {
  event.stopPropagation();
  const checkbox = event.currentTarget;
  const taskId = checkbox.dataset.stepCheck;
  const stepIndex = Number(checkbox.dataset.stepIndex);
  const task = (state.bootstrap?.tasks || []).find((item) => item.id === taskId);
  const stepRecord = state.taskSteps[taskId]?.data;
  const steps = normalizeSteps(stepRecord?.steps);
  if (!task || !Number.isInteger(stepIndex) || !steps[stepIndex]) {
    return;
  }

  steps[stepIndex] = {
    ...steps[stepIndex],
    done: checkbox.checked,
  };
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
    renderTasks();
    bindTaskCards();
    if (state.selectedTaskId === taskId) {
      await loadTaskSteps(task);
    }
  } catch (error) {
    checkbox.checked = !checkbox.checked;
    checkbox.disabled = false;
    setMessage(`Sub-action update failed: ${error.message}`, "error");
  }
}

async function handleStepsSubmit(event) {
  event.preventDefault();
  const task = (state.bootstrap?.tasks || []).find((item) => item.id === state.selectedTaskId);
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
    if (state.expandedStepTasks.has(task.id)) {
      renderTasks();
      bindTaskCards();
    }
    setMessage(`Saved steps for ${task.id}.`);
  } catch (error) {
    setMessage(`Step save failed: ${error.message}`, "error");
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

async function handleTaskToggle(event) {
  event.stopPropagation();
  const checkbox = event.currentTarget;
  const taskId = checkbox.dataset.taskToggle;
  const task = (state.bootstrap?.tasks || []).find((item) => item.id === taskId);
  if (!task) {
    return;
  }

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
  if (!task) {
    return;
  }

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
  elements.modeTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      state.selectedMode = tab.dataset.mode;
      if (state.selectedMode === "done") {
        state.statusFilter = "all";
        elements.statusFilter.value = "all";
      }
      applyViewFilters();
    });
  });
  elements.filterForm.addEventListener("change", () => {
    state.statusFilter = elements.statusFilter.value;
    state.priorityFilter = elements.priorityFilter.value;
    state.selectedProject = elements.projectFilter.value;
    applyViewFilters();
  });
  elements.projectForm.addEventListener("submit", handleProjectSubmit);
  elements.taskForm.addEventListener("submit", handleTaskSubmit);
  elements.ideaForm.addEventListener("submit", handleIdeaSubmit);
  elements.memoryForm.addEventListener("submit", handleMemorySubmit);
  elements.errorForm.addEventListener("submit", handleErrorSubmit);
  elements.queueForm.addEventListener("submit", handleQueueSubmit);
  elements.trainingForm.addEventListener("submit", handleTrainingSubmit);
  elements.searchForm.addEventListener("submit", handleSearchSubmit);
  elements.clearSearch.addEventListener("click", resetSearch);
}

function bindStatic() {
  Object.assign(elements, {
    refreshBtn: $("refresh-btn"),
    modeTabs: [...document.querySelectorAll("[data-mode]")],
    modePanels: [...document.querySelectorAll("[data-panel]")],
    filterForm: $("filter-form"),
    statusFilter: $("status-filter"),
    priorityFilter: $("priority-filter"),
    projectFilter: $("project-filter"),
    projectForm: $("project-form"),
    taskForm: $("task-form"),
    ideaForm: $("idea-form"),
    memoryForm: $("memory-form"),
    errorForm: $("error-form"),
    queueForm: $("queue-form"),
    trainingForm: $("training-form"),
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
    platformCount: $("platform-count"),
    platformTabs: $("platform-tabs"),
    platformList: $("platform-list"),
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
