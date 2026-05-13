const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, "public");

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

async function bootstrapData() {
  const [projectsResult, tasksResult, queueResult, analyticsResult] = await Promise.allSettled([
    todoziRequest("GET", "/projects"),
    todoziRequest("GET", "/tasks"),
    todoziRequest("GET", "/queue/list/active"),
    todoziRequest("GET", "/analytics/tasks"),
  ]);

  return {
    projects: projectsResult.status === "fulfilled" ? projectsResult.value : [],
    tasks: tasksResult.status === "fulfilled" ? tasksResult.value : [],
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

  if (req.method === "GET" && pathname === "/api/projects") {
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

  const taskMatch = pathname.match(/^\/api\/tasks\/([^/]+)$/);
  if (taskMatch) {
    const taskId = decodeURIComponent(taskMatch[1]);

    if (req.method === "GET") {
      const task = await todoziRequest("GET", `/tasks/${encodeURIComponent(taskId)}`);
      return sendJson(res, 200, task);
    }

    if (req.method === "PUT") {
      const payload = await readJsonBody(req);
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
  requestHandler(req, res);
});

server.listen(config.port, config.host, () => {
  console.log(`todozi-manage listening on http://${config.host}:${config.port}`);
  console.log(`todozi backend: ${config.todoziBaseUrl}`);
});
