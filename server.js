const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { execFile } = require("node:child_process");

const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const TODOZI_DIR = path.join(process.env.HOME || "/home/ash", ".todozi");
const STEPS_DIR = path.join(TODOZI_DIR, "steps");
const IDEAS_DIR = path.join(TODOZI_DIR, "ideas");
const REFS_DIR = path.join(TODOZI_DIR, "refs");
const REPO_MAP_PATH = path.join(TODOZI_DIR, "repo-map.json");
const PROJECT_TASKS_DIR = path.join(TODOZI_DIR, "project_tasks");
const LEGACY_TASKS_DIR = path.join(TODOZI_DIR, "tasks");

const config = {
  host: process.env.MANAGE_HOST || "100.75.128.38",
  port: Number(process.env.MANAGE_PORT || "3044"),
  todoziBaseUrl: normalizeTodoziBaseUrl(process.env.TODOZI_BASE_URL || process.env.TODOZI_BASE),
  todoziApiKey: process.env.TODOZI_API_KEY?.trim() || null,
  todoziReadKey: process.env.TODOZI_READ_KEY?.trim() || null,
  todoziAdminKey: process.env.TODOZI_ADMIN_KEY?.trim() || null,
  timeoutMs: Number(process.env.TODOZI_TIMEOUT_SECONDS || "20") * 1000,
};

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function sendText(res, statusCode, body, contentType = "text/plain; charset=utf-8") {
  res.writeHead(statusCode, {
    "Content-Type": contentType,
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function normalizeTodoziBaseUrl(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return "http://100.75.128.38:8636";
  }
  return trimmed.replace(/\/api\/?$/, "").replace(/\/+$/, "");
}

function loadAsset(fileName) {
  const assetPath = path.join(PUBLIC_DIR, fileName);
  return fs.readFileSync(assetPath);
}

function serveAsset(res, fileName) {
  const ext = path.extname(fileName);
  const mime = MIME_TYPES[ext] || "application/octet-stream";
  try {
    const body = loadAsset(fileName);
    res.writeHead(200, {
      "Content-Type": mime,
      "Content-Length": body.length,
      "Cache-Control": "no-store",
    });
    res.end(body);
  } catch (error) {
    sendText(res, 404, `Asset not found: ${fileName}`);
  }
}

function authHeaders(useAdmin = false) {
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  const publicKey = config.todoziReadKey || config.todoziAdminKey || config.todoziApiKey;
  if (publicKey) {
    headers.Authorization = `Bearer ${publicKey}`;
  }

  const privateKey = config.todoziAdminKey || config.todoziApiKey;
  if (useAdmin && privateKey) {
    headers["X-API-Private-Key"] = privateKey;
  }

  return headers;
}

async function todoziRequest(method, route, { body = undefined, useAdmin = false } = {}) {
  const url = new URL(route, `${config.todoziBaseUrl}/`);
  const init = {
    method,
    headers: authHeaders(useAdmin),
    signal: AbortSignal.timeout(config.timeoutMs),
  };

  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }

  const response = await fetch(url, init);
  const raw = await response.text();
  let data = null;

  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch (error) {
      throw new Error(`${method} ${route} returned invalid JSON: ${raw.slice(0, 200)}`);
    }
  }

  if (!response.ok) {
    const detail = typeof data === "string" ? data : JSON.stringify(data);
    throw new Error(`${method} ${route} failed with HTTP ${response.status}: ${detail || response.statusText}`);
  }

  return data;
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf-8").trim();
  if (!raw) {
    return {};
  }
  return JSON.parse(raw);
}

function sortByUpdatedDesc(items) {
  return [...items].sort((left, right) => {
    const a = new Date(left.updated_at || left.created_at || 0).getTime();
    const b = new Date(right.updated_at || right.created_at || 0).getTime();
    return b - a;
  });
}

function taskProject(task) {
  return task.parent_project || task.project || task.project_name || "general";
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJsonFile(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function safeTaskId(taskId) {
  const cleaned = String(taskId || "").trim();
  if (!/^[A-Za-z0-9_.-]+$/.test(cleaned)) {
    throw new Error("Invalid task id.");
  }
  return cleaned;
}

function stepsPath(taskId) {
  return path.join(STEPS_DIR, `${safeTaskId(taskId)}.json`);
}

function defaultSteps(taskId) {
  return {
    created_at: new Date().toISOString(),
    project_id: "general",
    status: "active",
    steps: [],
    summary: "",
    task_id: safeTaskId(taskId),
    updated_at: new Date().toISOString(),
  };
}

function readTaskSteps(taskId) {
  const filePath = stepsPath(taskId);
  if (!fs.existsSync(filePath)) {
    return defaultSteps(taskId);
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeTaskSteps(taskId, payload) {
  fs.mkdirSync(STEPS_DIR, { recursive: true });
  const existing = readTaskSteps(taskId);
  const steps = Array.isArray(payload.steps)
    ? payload.steps
        .map((step) => {
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
        })
        .filter((step) => step.text)
    : [];
  const next = {
    ...existing,
    task_id: safeTaskId(taskId),
    project_id: typeof payload.project_id === "string" && payload.project_id.trim()
      ? payload.project_id.trim()
      : existing.project_id || "general",
    status: typeof payload.status === "string" && payload.status.trim() ? payload.status.trim() : existing.status || "active",
    summary: typeof payload.summary === "string" ? payload.summary : existing.summary || "",
    steps,
    updated_at: new Date().toISOString(),
  };
  fs.writeFileSync(stepsPath(taskId), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

function refsPath(taskId) {
  return path.join(REFS_DIR, `${safeTaskId(taskId)}.json`);
}

function defaultRefs(taskId) {
  return {
    created_at: new Date().toISOString(),
    task_id: safeTaskId(taskId),
    refs: [],
    updated_at: new Date().toISOString(),
  };
}

function readTaskRefs(taskId) {
  const filePath = refsPath(taskId);
  if (!fs.existsSync(filePath)) {
    return defaultRefs(taskId);
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function normalizeRef(ref, index) {
  const cleanPath = String(ref?.path || "").trim();
  const line = ref?.line === null || ref?.line === undefined || ref?.line === ""
    ? null
    : Number(ref.line);
  const kind = ref?.kind === "file" ? "file" : "path";
  return {
    id: String(ref?.id || `${Date.now().toString(36)}_${index}`),
    path: cleanPath,
    line: Number.isFinite(line) ? line : null,
    kind,
    label: String(ref?.label || cleanPath.split("/").pop() || cleanPath),
  };
}

function writeTaskRefs(taskId, payload) {
  fs.mkdirSync(REFS_DIR, { recursive: true });
  const existing = readTaskRefs(taskId);
  const refs = Array.isArray(payload.refs)
    ? payload.refs.map(normalizeRef).filter((ref) => ref.path)
    : [];
  const next = {
    ...existing,
    task_id: safeTaskId(taskId),
    refs,
    updated_at: new Date().toISOString(),
  };
  fs.writeFileSync(refsPath(taskId), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

function readRepoMap() {
  if (!fs.existsSync(REPO_MAP_PATH)) {
    return {};
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(REPO_MAP_PATH, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    return {};
  }
}

function resolveRepoPath(projectName) {
  const map = readRepoMap();
  const repoPath = map[projectName];
  if (!repoPath || typeof repoPath !== "string") {
    return null;
  }
  const resolved = path.resolve(repoPath);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    return null;
  }
  return resolved;
}

function runGit(repoPath, args) {
  return new Promise((resolve) => {
    execFile(
      "git",
      args,
      { cwd: repoPath, timeout: 5000, windowsHide: true },
      (error, stdout) => {
        resolve(error ? null : stdout.trim());
      },
    );
  });
}

async function gitStatusFor(taskId, projectName) {
  const repoPath = resolveRepoPath(projectName);
  if (!repoPath) {
    return { configured: false };
  }

  const [branch, lastCommit, lastCommitAge, aheadBehind, statusPorcelain] = await Promise.all([
    runGit(repoPath, ["branch", "--show-current"]),
    runGit(repoPath, ["log", `--grep=${taskId}`, "--oneline", "-1"]),
    runGit(repoPath, ["log", `--grep=${taskId}`, "--format=%cr", "-1"]),
    runGit(repoPath, ["rev-list", "--left-right", "--count", "@{upstream}...HEAD"]),
    runGit(repoPath, ["status", "--porcelain"]),
  ]);

  let ahead = null;
  let behind = null;
  if (aheadBehind) {
    const parts = aheadBehind.split(/\s+/).map(Number);
    if (parts.length === 2 && parts.every(Number.isFinite)) {
      [behind, ahead] = parts;
    }
  }

  const dirtyCount = statusPorcelain
    ? statusPorcelain.split("\n").filter((line) => line.trim()).length
    : 0;

  return {
    configured: true,
    repo: repoPath,
    branch: branch || null,
    lastCommit: lastCommit || null,
    lastCommitAge: lastCommit ? lastCommitAge || null : null,
    ahead,
    behind,
    dirty: dirtyCount,
  };
}

async function peekFile(projectName, refPath, line) {
  const repoPath = resolveRepoPath(projectName);
  if (!repoPath) {
    throw new Error("No repo configured for this project.");
  }
  const resolved = path.resolve(repoPath, refPath);
  const withSep = repoPath.endsWith(path.sep) ? repoPath : `${repoPath}${path.sep}`;
  if (resolved !== repoPath && !resolved.startsWith(withSep)) {
    throw new Error("Ref path escapes the configured repo.");
  }
  const content = fs.readFileSync(resolved, "utf8");
  const allLines = content.split("\n");
  const target = Number.isFinite(line) && line > 0 ? line : null;
  const start = target ? Math.max(0, target - 10) : 0;
  const end = target ? Math.min(allLines.length, target + 10) : Math.min(allLines.length, 20);
  const lines = allLines.slice(start, end).map((text, index) => ({
    n: start + index + 1,
    text,
  }));
  return { path: refPath, repo: repoPath, lines };
}

function normalizeTaskPatch(payload) {
  const patch = {};
  for (const [key, value] of Object.entries(payload || {})) {
    if (value === undefined) {
      continue;
    }
    if (["tags", "dependencies"].includes(key)) {
      patch[key] = Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : [];
    } else if (key === "progress") {
      patch[key] = value === null || value === "" ? 0 : Number(value);
    } else if (typeof value === "string") {
      patch[key] = value.trim();
    } else {
      patch[key] = value;
    }
  }
  return patch;
}

function updateTaskBucket(container, bucket, taskId, patch, now) {
  if (!container || !container[bucket] || !container[bucket][taskId]) {
    return null;
  }
  const task = {
    ...container[bucket][taskId],
    ...patch,
    id: taskId,
    updated_at: now,
  };
  container[bucket][taskId] = task;
  container.updated_at = now;
  return task;
}

function updateLocalTaskStore(taskId, payload) {
  const safeId = safeTaskId(taskId);
  const patch = normalizeTaskPatch(payload);
  const now = new Date().toISOString();
  const buckets = ["active_tasks", "completed_tasks", "archived_tasks", "deleted_tasks", "tasks"];
  let updated = null;

  if (fs.existsSync(PROJECT_TASKS_DIR)) {
    for (const fileName of fs.readdirSync(PROJECT_TASKS_DIR)) {
      if (!fileName.endsWith(".json")) {
        continue;
      }
      const filePath = path.join(PROJECT_TASKS_DIR, fileName);
      const container = readJsonFile(filePath);
      for (const bucket of buckets) {
        const task = updateTaskBucket(container, bucket, safeId, patch, now);
        if (task) {
          writeJsonFile(filePath, container);
          updated = task;
          break;
        }
      }
      if (updated) {
        break;
      }
    }
  }

  if (fs.existsSync(LEGACY_TASKS_DIR)) {
    for (const fileName of ["active.json", "completed.json", "archived.json"]) {
      const filePath = path.join(LEGACY_TASKS_DIR, fileName);
      if (!fs.existsSync(filePath)) {
        continue;
      }
      const container = readJsonFile(filePath);
      const task = updateTaskBucket(container, "tasks", safeId, patch, now);
      if (task) {
        writeJsonFile(filePath, container);
        updated = task;
      }
    }
  }

  return updated;
}

function readLocalIdeas() {
  if (!fs.existsSync(IDEAS_DIR)) {
    return [];
  }

  return fs.readdirSync(IDEAS_DIR)
    .filter((fileName) => fileName.endsWith(".json"))
    .sort()
    .flatMap((fileName) => {
      const filePath = path.join(IDEAS_DIR, fileName);
      try {
        return [JSON.parse(fs.readFileSync(filePath, "utf8"))];
      } catch (error) {
        return [{
          id: `invalid_${fileName.replace(/[^a-zA-Z0-9_-]/g, "_")}`,
          idea: `Invalid local idea file: ${fileName}`,
          importance: "low",
          share: "private",
          error: error.message,
        }];
      }
    });
}

function normalizeIdeaPayload(payload) {
  const now = new Date().toISOString();
  const title = typeof payload.title === "string" ? payload.title.trim() : "";
  const description = typeof payload.description === "string" ? payload.description.trim() : "";
  const idea = typeof payload.idea === "string" && payload.idea.trim()
    ? payload.idea.trim()
    : [title, description].filter(Boolean).join(": ");

  if (!idea) {
    throw new Error("Idea text is required.");
  }

  const tags = Array.isArray(payload.tags)
    ? payload.tags.map((tag) => String(tag).trim()).filter(Boolean)
    : typeof payload.tags === "string"
      ? payload.tags.split(",").map((tag) => tag.trim()).filter(Boolean)
      : [];

  return {
    id: `idea_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    idea,
    title: title || idea.slice(0, 80),
    description,
    importance: typeof payload.importance === "string" && payload.importance.trim()
      ? payload.importance.trim()
      : typeof payload.priority === "string" && payload.priority.trim()
        ? payload.priority.trim()
        : "medium",
    share: typeof payload.share === "string" && payload.share.trim() ? payload.share.trim() : "private",
    category: typeof payload.category === "string" ? payload.category.trim() : "",
    context: typeof payload.context === "string" ? payload.context.trim() : "",
    tags,
    source: "todozi-manage-local",
    created_at: now,
    updated_at: now,
  };
}

function writeLocalIdea(payload) {
  fs.mkdirSync(IDEAS_DIR, { recursive: true });
  const idea = normalizeIdeaPayload(payload);
  const filePath = path.join(IDEAS_DIR, `${idea.id}.json`);
  fs.writeFileSync(filePath, `${JSON.stringify(idea, null, 2)}\n`);
  return idea;
}

function normalizeItems(value) {
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
  return [];
}

function projectOptions(projects, tasks) {
  const byName = new Map();
  for (const project of Array.isArray(projects) ? projects : []) {
    const name = project.name || project.project_name || "";
    if (name) {
      byName.set(name, { ...project, name });
    }
  }
  for (const task of Array.isArray(tasks) ? tasks : []) {
    const name = taskProject(task);
    if (!byName.has(name)) {
      byName.set(name, { name, description: "Derived from tasks" });
    }
  }
  return [...byName.values()].sort((left, right) => left.name.localeCompare(right.name));
}

async function collectPlatformData() {
  const requests = {
    health: todoziRequest("GET", "/health"),
    stats: todoziRequest("GET", "/stats"),
    agents: todoziRequest("GET", "/agents"),
    availableAgents: todoziRequest("GET", "/agents/available"),
    memories: todoziRequest("GET", "/memories"),
    memoryTypes: todoziRequest("GET", "/memories/types"),
    ideas: todoziRequest("GET", "/ideas"),
    errors: todoziRequest("GET", "/errors"),
    training: todoziRequest("GET", "/training"),
    trainingStats: todoziRequest("GET", "/training/stats"),
    chunks: todoziRequest("GET", "/chunks"),
    readyChunks: todoziRequest("GET", "/chunks/ready"),
    chunkGraph: todoziRequest("GET", "/chunks/graph"),
    agentAnalytics: todoziRequest("GET", "/analytics/agents"),
    performance: todoziRequest("GET", "/analytics/performance"),
    timeReport: todoziRequest("GET", "/time/report"),
    backups: todoziRequest("GET", "/backups"),
  };

  const settled = await Promise.all(
    Object.entries(requests).map(async ([key, promise]) => {
      try {
        return [key, await promise, null];
      } catch (error) {
        return [key, null, error];
      }
    }),
  );
  const data = {};
  const errors = {};
  for (const [key, value, error] of settled) {
    if (error) {
      errors[key] = error.message;
    } else {
      data[key] = value;
    }
  }

  const localIdeas = readLocalIdeas();
  if (localIdeas.length) {
    const byId = new Map();
    for (const idea of normalizeItems(data.ideas)) {
      byId.set(idea.id || JSON.stringify(idea), idea);
    }
    for (const idea of localIdeas) {
      byId.set(idea.id || JSON.stringify(idea), idea);
    }
    data.ideas = [...byId.values()];
  }

  return { data, errors };
}

async function bootstrapData() {
  const [projectsResult, tasksResult, queueResult, analyticsResult] = await Promise.allSettled([
    todoziRequest("GET", "/projects"),
    todoziRequest("GET", "/tasks"),
    todoziRequest("GET", "/queue/list/active"),
    todoziRequest("GET", "/analytics/tasks"),
  ]);

  const rawProjects = projectsResult.status === "fulfilled" ? projectsResult.value : [];
  const tasks = tasksResult.status === "fulfilled" ? tasksResult.value : [];

  return {
    projects: projectOptions(rawProjects, tasks),
    rawProjects,
    tasks,
    activeQueue: queueResult.status === "fulfilled" ? queueResult.value : [],
    analytics: analyticsResult.status === "fulfilled" ? analyticsResult.value : null,
    errors: {
      projects: projectsResult.status === "rejected" ? projectsResult.reason.message : null,
      tasks: tasksResult.status === "rejected" ? tasksResult.reason.message : null,
      activeQueue: queueResult.status === "rejected" ? queueResult.reason.message : null,
      analytics: analyticsResult.status === "rejected" ? analyticsResult.reason.message : null,
    },
  };
}

async function handleApi(req, res, pathname, query) {
  if (req.method === "GET" && pathname === "/api/bootstrap") {
    const data = await bootstrapData();
    return sendJson(res, 200, data);
  }

  if (req.method === "GET" && pathname === "/api/platform") {
    const data = await collectPlatformData();
    return sendJson(res, 200, data);
  }

  if (req.method === "GET" && pathname === "/api/projects") {
    const [projects, tasks] = await Promise.all([todoziRequest("GET", "/projects"), todoziRequest("GET", "/tasks")]);
    return sendJson(res, 200, projectOptions(projects, tasks));
  }

  if (req.method === "GET" && pathname === "/api/raw-projects") {
    const projects = await todoziRequest("GET", "/projects");
    return sendJson(res, 200, projects);
  }

  if (req.method === "POST" && pathname === "/api/projects") {
    const payload = await readJsonBody(req);
    if (!payload.name || typeof payload.name !== "string") {
      return sendJson(res, 400, { error: "Project name is required." });
    }
    const project = await todoziRequest("POST", "/projects", {
      body: {
        name: payload.name.trim(),
        description: typeof payload.description === "string" ? payload.description.trim() : undefined,
      },
      useAdmin: true,
    });
    return sendJson(res, 200, project);
  }

  if (req.method === "GET" && pathname === "/api/tasks") {
    const tasks = await todoziRequest("GET", "/tasks");
    const projectFilter = query.get("project");
    const searchFilter = query.get("search");
    let filtered = Array.isArray(tasks) ? tasks : [];
    if (projectFilter && projectFilter !== "all") {
      filtered = filtered.filter((task) => taskProject(task) === projectFilter);
    }
    if (searchFilter) {
      const needle = searchFilter.toLowerCase();
      filtered = filtered.filter((task) => JSON.stringify(task).toLowerCase().includes(needle));
    }
    return sendJson(res, 200, sortByUpdatedDesc(filtered));
  }

  if (req.method === "GET" && pathname === "/api/search") {
    const q = query.get("q") || "";
    const results = q ? await todoziRequest("GET", `/tasks/search?q=${encodeURIComponent(q)}`) : [];
    return sendJson(res, 200, Array.isArray(results) ? results : []);
  }

  if (req.method === "GET" && pathname === "/api/semantic-search") {
    const q = query.get("q") || "";
    const results = q ? await todoziRequest("GET", `/semantic/search?q=${encodeURIComponent(q)}`) : [];
    return sendJson(res, 200, results);
  }

  if (req.method === "GET" && pathname === "/api/queue/active") {
    const items = await todoziRequest("GET", "/queue/list/active");
    return sendJson(res, 200, items);
  }

  if (req.method === "POST" && pathname === "/api/queue/plan") {
    const payload = await readJsonBody(req);
    const result = await todoziRequest("POST", "/queue/plan", { body: payload, useAdmin: true });
    return sendJson(res, 200, result);
  }

  if (req.method === "POST" && pathname === "/api/memories") {
    const payload = await readJsonBody(req);
    const result = await todoziRequest("POST", "/memories", { body: payload, useAdmin: true });
    return sendJson(res, 200, result);
  }

  if (req.method === "POST" && pathname === "/api/ideas") {
    const payload = await readJsonBody(req);
    const idea = writeLocalIdea(payload);
    return sendJson(res, 200, { stored: "local", idea });
  }

  if (req.method === "POST" && pathname === "/api/errors") {
    const payload = await readJsonBody(req);
    const result = await todoziRequest("POST", "/errors", { body: payload, useAdmin: true });
    return sendJson(res, 200, result);
  }

  if (req.method === "POST" && pathname === "/api/training") {
    const payload = await readJsonBody(req);
    const result = await todoziRequest("POST", "/training", { body: payload, useAdmin: true });
    return sendJson(res, 200, result);
  }

  const timeMatch = pathname.match(/^\/api\/time\/(start|stop)\/([^/]+)$/);
  if (timeMatch && req.method === "POST") {
    const action = timeMatch[1];
    const taskId = decodeURIComponent(timeMatch[2]);
    const result = await todoziRequest("POST", `/time/${action}/${encodeURIComponent(taskId)}`, { useAdmin: true });
    return sendJson(res, 200, result);
  }

  if (req.method === "POST" && pathname === "/api/backups") {
    const result = await todoziRequest("POST", "/backup", { useAdmin: true });
    return sendJson(res, 200, result);
  }

  const stepsMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/steps$/);
  if (stepsMatch) {
    const taskId = decodeURIComponent(stepsMatch[1]);
    if (req.method === "GET") {
      return sendJson(res, 200, readTaskSteps(taskId));
    }
    if (req.method === "PUT") {
      const payload = await readJsonBody(req);
      return sendJson(res, 200, writeTaskSteps(taskId, payload));
    }
  }

  const refsPeekMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/refs\/peek$/);
  if (refsPeekMatch && req.method === "GET") {
    const taskId = decodeURIComponent(refsPeekMatch[1]);
    const refId = query.get("refId") || "";
    const project = query.get("project") || "general";
    const record = readTaskRefs(taskId);
    const ref = record.refs.find((item) => item.id === refId);
    if (!ref) {
      return sendJson(res, 404, { error: "Ref not found." });
    }
    try {
      const peek = await peekFile(project, ref.path, ref.line);
      return sendJson(res, 200, peek);
    } catch (error) {
      return sendJson(res, 400, { error: error.message });
    }
  }

  const refsMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/refs$/);
  if (refsMatch) {
    const taskId = decodeURIComponent(refsMatch[1]);
    if (req.method === "GET") {
      return sendJson(res, 200, readTaskRefs(taskId));
    }
    if (req.method === "PUT") {
      const payload = await readJsonBody(req);
      return sendJson(res, 200, writeTaskRefs(taskId, payload));
    }
  }

  const gitMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/git$/);
  if (gitMatch && req.method === "GET") {
    const taskId = decodeURIComponent(gitMatch[1]);
    const project = query.get("project") || "general";
    const status = await gitStatusFor(taskId, project);
    return sendJson(res, 200, status);
  }

  const taskMatch = pathname.match(/^\/api\/tasks\/([^/]+)$/);
  if (taskMatch) {
    const taskId = decodeURIComponent(taskMatch[1]);

    if (req.method === "GET") {
      const task = await todoziRequest("GET", `/tasks/${encodeURIComponent(taskId)}`);
      return sendJson(res, 200, task);
    }

    if (req.method === "PUT") {
      const payload = await readJsonBody(req);
      const localTask = updateLocalTaskStore(taskId, payload);
      if (localTask) {
        return sendJson(res, 200, { ...localTask, stored: "local" });
      }
      const task = await todoziRequest("PUT", `/tasks/${encodeURIComponent(taskId)}`, {
        body: payload,
        useAdmin: true,
      });
      return sendJson(res, 200, task);
    }

    if (req.method === "DELETE") {
      const task = await todoziRequest("DELETE", `/tasks/${encodeURIComponent(taskId)}`, {
        useAdmin: true,
      });
      return sendJson(res, 200, task);
    }
  }

  if (req.method === "POST" && pathname === "/api/tasks") {
    const payload = await readJsonBody(req);
    const action = typeof payload.action === "string" ? payload.action.trim() : "";
    if (!action) {
      return sendJson(res, 400, { error: "Task action is required." });
    }

    const project = typeof payload.parent_project === "string" && payload.parent_project.trim()
      ? payload.parent_project.trim()
      : "general";

    const created = await todoziRequest("POST", "/tasks", {
      body: {
        action,
        time: typeof payload.time === "string" && payload.time.trim() ? payload.time.trim() : new Date().toISOString(),
        priority: typeof payload.priority === "string" && payload.priority.trim() ? payload.priority.trim() : "medium",
        parent_project: project,
      },
      useAdmin: true,
    });

    return sendJson(res, 200, created);
  }

  if (req.method === "GET" && pathname === "/api/health") {
    return sendJson(res, 200, {
      ok: true,
      manage: `${config.host}:${config.port}`,
      todozi: config.todoziBaseUrl,
    });
  }

  return sendJson(res, 404, { error: "Not found" });
}

async function requestHandler(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host || `${config.host}:${config.port}`}`);
    const { pathname, searchParams } = url;

    if (req.method === "HEAD" && pathname === "/") {
      return sendText(res, 200, "", "text/html; charset=utf-8");
    }

    if (req.method === "GET" && pathname === "/") {
      return serveAsset(res, "index.html");
    }

    if (req.method === "GET" && pathname === "/app.js") {
      return serveAsset(res, "app.js");
    }

    if (req.method === "GET" && pathname === "/styles.css") {
      return serveAsset(res, "styles.css");
    }

    if (pathname.startsWith("/api/")) {
      return handleApi(req, res, pathname, searchParams);
    }

    return sendJson(res, 404, { error: "Not found" });
  } catch (error) {
    console.error(error);
    return sendJson(res, 500, { error: error.message || "Unexpected error" });
  }
}

const server = http.createServer((req, res) => {
  requestHandler(req, res).catch((error) => {
    console.error(error);
    if (!res.headersSent) {
      sendJson(res, 500, { error: error.message || "Unexpected error" });
    } else {
      res.end();
    }
  });
});

server.listen(config.port, config.host, () => {
  console.log(`todozi-manage listening on http://${config.host}:${config.port}`);
  console.log(`todozi backend: ${config.todoziBaseUrl}`);
});
