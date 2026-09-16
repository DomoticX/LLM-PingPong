(() => {
  "use strict";

  const STORAGE_KEY = "llm-pingpong-settings";
  const CONFIG_MARKER = "PingPong-agent-config";

  const els = {
    conversation: document.getElementById("conversation"),
    initialPrompt: document.getElementById("initial-prompt"),
    maxTurns: document.getElementById("max-turns"),
    turnDelay: document.getElementById("turn-delay"),
    startBtn: document.getElementById("start-btn"),
    stopBtn: document.getElementById("stop-btn"),
    clearBtn: document.getElementById("clear-btn"),
  };

  function agentEls(n) {
    return {
      name: document.getElementById(`a${n}-name`),
      baseUrl: document.getElementById(`a${n}-baseurl`),
      apiKey: document.getElementById(`a${n}-apikey`),
      model: document.getElementById(`a${n}-model`),
      loadModelsBtn: document.getElementById(`a${n}-load-models`),
      system: document.getElementById(`a${n}-system`),
      temp: document.getElementById(`a${n}-temp`),
      maxTokens: document.getElementById(`a${n}-maxtokens`),
      testBtn: document.getElementById(`a${n}-test`),
      status: document.getElementById(`a${n}-status`),
      saveConfigBtn: document.getElementById(`a${n}-save-config`),
      loadConfigBtn: document.getElementById(`a${n}-load-config`),
      importConfigBtn: document.getElementById(`a${n}-import-config`),
      configSelect: document.getElementById(`a${n}-config-select`),
      loadConfigFile: document.getElementById(`a${n}-load-config-file`),
    };
  }

  const agent1 = agentEls(1);
  const agent2 = agentEls(2);
  const folderStatusEl = document.getElementById("config-folder-status");
  const chooseFolderBtn = document.getElementById("choose-folder-btn");

  const CONFIG_FILENAME_RE = /^llmpingpong_.*\.json$/i;
  const supportsFsAccess = typeof window.showDirectoryPicker === "function";
  let configDirHandle = null;

  let running = false;
  let stopRequested = false;

  function normalizeBaseUrl(url) {
    return url.trim().replace(/\/+$/, "");
  }

  function getAgentConfig(a) {
    return {
      name: a.name.value.trim() || "Agent",
      baseUrl: normalizeBaseUrl(a.baseUrl.value),
      apiKey: a.apiKey.value.trim(),
      model: a.model.value,
      system: a.system.value.trim(),
      temperature: parseFloat(a.temp.value),
      maxTokens: parseInt(a.maxTokens.value, 10),
    };
  }

  function headers(apiKey) {
    const h = { "Content-Type": "application/json" };
    if (apiKey) h["Authorization"] = `Bearer ${apiKey}`;
    return h;
  }

  async function fetchModels(cfg) {
    const res = await fetch(`${cfg.baseUrl}/models`, {
      method: "GET",
      headers: headers(cfg.apiKey),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return (data.data || []).map((m) => m.id).sort();
  }

  async function chatCompletion(cfg, messages, signal) {
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: headers(cfg.apiKey),
      signal,
      body: JSON.stringify({
        model: cfg.model,
        messages,
        temperature: cfg.temperature,
        max_tokens: cfg.maxTokens,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} ${text.slice(0, 200)}`);
    }
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("No content in response");
    return content;
  }

  function addBubble(kind, name, text) {
    const div = document.createElement("div");
    div.className = `bubble ${kind}`;
    if (name) {
      const nameEl = document.createElement("span");
      nameEl.className = "bubble-name";
      nameEl.textContent = name;
      div.appendChild(nameEl);
    }
    const textEl = document.createElement("span");
    textEl.textContent = text;
    div.appendChild(textEl);
    els.conversation.appendChild(div);
    els.conversation.scrollTop = els.conversation.scrollHeight;
    return div;
  }

  function setStatus(el, ok, message) {
    el.textContent = message;
    el.className = "status " + (ok ? "ok" : "err");
  }

  async function testConnection(a) {
    const cfg = getAgentConfig(a);
    if (!cfg.baseUrl) {
      setStatus(a.status, false, "Base URL required");
      return;
    }
    setStatus(a.status, true, "Testing...");
    try {
      await fetchModels(cfg);
      setStatus(a.status, true, "Connected");
    } catch (err) {
      setStatus(a.status, false, `Failed: ${err.message}`);
    }
  }

  async function loadModels(a) {
    const cfg = getAgentConfig(a);
    if (!cfg.baseUrl) {
      setStatus(a.status, false, "Base URL required");
      return;
    }
    setStatus(a.status, true, "Loading models...");
    try {
      const models = await fetchModels(cfg);
      const current = a.model.value;
      a.model.innerHTML = "";
      for (const id of models) {
        const opt = document.createElement("option");
        opt.value = id;
        opt.textContent = id;
        a.model.appendChild(opt);
      }
      if (models.includes(current)) a.model.value = current;
      setStatus(a.status, true, `Loaded ${models.length} model(s)`);
      saveSettings();
    } catch (err) {
      setStatus(a.status, false, `Failed: ${err.message}`);
    }
  }

  function sleep(ms, signalCheck) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const tick = () => {
        if (stopRequested) return reject(new Error("stopped"));
        if (Date.now() - start >= ms) return resolve();
        setTimeout(tick, 100);
      };
      tick();
    });
  }

  async function runConversation() {
    const cfg1 = getAgentConfig(agent1);
    const cfg2 = getAgentConfig(agent2);

    if (!cfg1.baseUrl || !cfg2.baseUrl) {
      addBubble("error", null, "Both agents need a Base URL before starting.");
      return;
    }
    if (!cfg1.model || !cfg2.model) {
      addBubble("error", null, "Both agents need a model selected before starting.");
      return;
    }

    const initialPrompt = els.initialPrompt.value.trim();
    const maxTurns = Math.max(1, parseInt(els.maxTurns.value, 10) || 1);
    const delayMs = Math.max(0, parseFloat(els.turnDelay.value) || 0) * 1000;

    const history1 = [];
    const history2 = [];
    if (cfg1.system) history1.push({ role: "system", content: cfg1.system });
    if (cfg2.system) history2.push({ role: "system", content: cfg2.system });

    running = true;
    stopRequested = false;
    els.startBtn.disabled = true;
    els.stopBtn.disabled = false;

    addBubble("system", null, `Conversation started (max ${maxTurns} turns)`);

    try {
      let lastMessage = initialPrompt;
      history1.push({ role: "user", content: lastMessage });
      addBubble("system", null, `Initial prompt: ${initialPrompt}`);

      for (let turn = 0; turn < maxTurns; turn++) {
        if (stopRequested) break;

        const reply1 = await chatCompletion(cfg1, history1);
        if (stopRequested) break;
        history1.push({ role: "assistant", content: reply1 });
        addBubble("agent-1", cfg1.name, reply1);

        history2.push({ role: "user", content: reply1 });
        if (delayMs > 0) await sleep(delayMs);
        if (stopRequested) break;

        const reply2 = await chatCompletion(cfg2, history2);
        if (stopRequested) break;
        history2.push({ role: "assistant", content: reply2 });
        addBubble("agent-2", cfg2.name, reply2);

        history1.push({ role: "user", content: reply2 });
        if (delayMs > 0) await sleep(delayMs);
      }

      if (!stopRequested) {
        addBubble("system", null, "Conversation finished (max turns reached).");
      } else {
        addBubble("system", null, "Conversation stopped.");
      }
    } catch (err) {
      if (err.message !== "stopped") {
        addBubble("error", null, `Error: ${err.message}`);
      } else {
        addBubble("system", null, "Conversation stopped.");
      }
    } finally {
      running = false;
      stopRequested = false;
      els.startBtn.disabled = false;
      els.stopBtn.disabled = true;
    }
  }

  function saveSettings() {
    const data = {
      initialPrompt: els.initialPrompt.value,
      maxTurns: els.maxTurns.value,
      turnDelay: els.turnDelay.value,
      agent1: {
        name: agent1.name.value,
        baseUrl: agent1.baseUrl.value,
        apiKey: agent1.apiKey.value,
        model: agent1.model.value,
        modelOptions: Array.from(agent1.model.options).map((o) => o.value),
        system: agent1.system.value,
        temp: agent1.temp.value,
        maxTokens: agent1.maxTokens.value,
      },
      agent2: {
        name: agent2.name.value,
        baseUrl: agent2.baseUrl.value,
        apiKey: agent2.apiKey.value,
        model: agent2.model.value,
        modelOptions: Array.from(agent2.model.options).map((o) => o.value),
        system: agent2.system.value,
        temp: agent2.temp.value,
        maxTokens: agent2.maxTokens.value,
      },
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (_) {
      // ignore storage errors
    }
  }

  function restoreAgent(a, saved) {
    if (!saved) return;
    if (saved.name !== undefined) a.name.value = saved.name;
    if (saved.baseUrl !== undefined) a.baseUrl.value = saved.baseUrl;
    if (saved.apiKey !== undefined) a.apiKey.value = saved.apiKey;
    if (Array.isArray(saved.modelOptions)) {
      a.model.innerHTML = "";
      for (const id of saved.modelOptions) {
        const opt = document.createElement("option");
        opt.value = id;
        opt.textContent = id;
        a.model.appendChild(opt);
      }
    }
    if (saved.model) {
      if (![...a.model.options].some((o) => o.value === saved.model)) {
        const opt = document.createElement("option");
        opt.value = saved.model;
        opt.textContent = saved.model;
        a.model.appendChild(opt);
      }
      a.model.value = saved.model;
    }
    if (saved.system !== undefined) a.system.value = saved.system;
    if (saved.temp !== undefined) a.temp.value = saved.temp;
    if (saved.maxTokens !== undefined) a.maxTokens.value = saved.maxTokens;
  }

  function loadSettings() {
    let raw;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch (_) {
      return;
    }
    if (!raw) return;
    let data;
    try {
      data = JSON.parse(raw);
    } catch (_) {
      return;
    }
    if (data.initialPrompt !== undefined) els.initialPrompt.value = data.initialPrompt;
    if (data.maxTurns !== undefined) els.maxTurns.value = data.maxTurns;
    if (data.turnDelay !== undefined) els.turnDelay.value = data.turnDelay;
    restoreAgent(agent1, data.agent1);
    restoreAgent(agent2, data.agent2);
  }

  function sanitizeFilenamePart(str) {
    return (str || "").trim().replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "agent";
  }

  function agentConfigFilename(cfg) {
    return `llmpingpong_${sanitizeFilenamePart(cfg.name)}_${sanitizeFilenamePart(cfg.model)}.json`;
  }

  // --- IndexedDB: remember the chosen config folder handle across reloads ---
  const IDB_NAME = "llm-pingpong-db";
  const IDB_STORE = "handles";
  const IDB_FOLDER_KEY = "configDir";

  function idbOpen() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbSet(key, value) {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function idbGet(key) {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  // --- Config folder (File System Access API) ---

  function setFolderStatus(text, cls) {
    folderStatusEl.textContent = text;
    folderStatusEl.className = "folder-status" + (cls ? ` ${cls}` : "");
  }

  async function listConfigFiles() {
    if (!configDirHandle) return [];
    const names = [];
    for await (const [name, handle] of configDirHandle.entries()) {
      if (handle.kind === "file" && CONFIG_FILENAME_RE.test(name)) names.push(name);
    }
    return names.sort();
  }

  async function refreshConfigFileLists() {
    const files = await listConfigFiles();
    for (const a of [agent1, agent2]) {
      const current = a.configSelect.value;
      a.configSelect.innerHTML = "";
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = files.length ? "Select a config…" : "No configs found";
      a.configSelect.appendChild(placeholder);
      for (const name of files) {
        const opt = document.createElement("option");
        opt.value = name;
        opt.textContent = name;
        a.configSelect.appendChild(opt);
      }
      if (files.includes(current)) a.configSelect.value = current;
    }
  }

  async function chooseConfigFolder() {
    if (!supportsFsAccess) {
      setFolderStatus("Not supported in this browser — use Import/Save-as-download instead", "warn");
      return;
    }
    try {
      const handle = await window.showDirectoryPicker();
      configDirHandle = handle;
      try {
        await idbSet(IDB_FOLDER_KEY, handle);
      } catch (_) {
        // IndexedDB persistence is best-effort
      }
      setFolderStatus(handle.name, "ok");
      await refreshConfigFileLists();
    } catch (err) {
      if (err.name !== "AbortError") setFolderStatus(`Folder access failed: ${err.message}`, "warn");
    }
  }

  async function tryRestoreConfigFolder() {
    if (!supportsFsAccess) {
      setFolderStatus("Not supported in this browser", "warn");
      chooseFolderBtn.disabled = true;
      return;
    }
    let handle;
    try {
      handle = await idbGet(IDB_FOLDER_KEY);
    } catch (_) {
      return;
    }
    if (!handle) return;
    configDirHandle = handle;
    try {
      const perm = await handle.queryPermission({ mode: "readwrite" });
      if (perm === "granted") {
        setFolderStatus(handle.name, "ok");
        await refreshConfigFileLists();
      } else {
        setFolderStatus(`${handle.name} (click Choose folder to reconnect)`, "warn");
      }
    } catch (_) {
      setFolderStatus("Click Choose folder to reconnect", "warn");
    }
  }

  async function ensureFolderPermission(mode) {
    if (!configDirHandle) return false;
    const perm = await configDirHandle.queryPermission({ mode });
    if (perm === "granted") return true;
    const requested = await configDirHandle.requestPermission({ mode });
    return requested === "granted";
  }

  function buildAgentConfigFile(a) {
    const cfg = getAgentConfig(a);
    return {
      pingpong: CONFIG_MARKER,
      version: 1,
      savedAt: new Date().toISOString(),
      agent: {
        name: cfg.name,
        baseUrl: a.baseUrl.value,
        apiKey: cfg.apiKey,
        model: cfg.model,
        modelOptions: Array.from(a.model.options).map((o) => o.value),
        system: cfg.system,
        temp: a.temp.value,
        maxTokens: a.maxTokens.value,
      },
    };
  }

  function downloadConfigFile(fileData, filename) {
    const blob = new Blob([JSON.stringify(fileData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  async function saveAgentConfig(a) {
    const fileData = buildAgentConfigFile(a);
    const filename = agentConfigFilename(fileData.agent);

    if (configDirHandle) {
      try {
        const ok = await ensureFolderPermission("readwrite");
        if (!ok) throw new Error("Permission denied");
        const fileHandle = await configDirHandle.getFileHandle(filename, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(JSON.stringify(fileData, null, 2));
        await writable.close();
        setStatus(a.status, true, `Saved ${filename} to ${configDirHandle.name}`);
        await refreshConfigFileLists();
        return;
      } catch (err) {
        setStatus(a.status, false, `Save to folder failed: ${err.message}`);
        return;
      }
    }

    downloadConfigFile(fileData, filename);
    setStatus(a.status, true, `Downloaded ${filename} (choose a config folder to save directly)`);
  }

  function applyConfigData(a, data, sourceLabel) {
    if (!data || data.pingpong !== CONFIG_MARKER || !data.agent) {
      setStatus(a.status, false, "Not a PingPong config file");
      return;
    }
    restoreAgent(a, data.agent);
    saveSettings();
    setStatus(a.status, true, `Loaded ${sourceLabel}`);
  }

  function loadAgentConfigFromFile(a, file) {
    const reader = new FileReader();
    reader.onload = () => {
      let data;
      try {
        data = JSON.parse(reader.result);
      } catch (_) {
        setStatus(a.status, false, "Invalid JSON file");
        return;
      }
      applyConfigData(a, data, file.name);
    };
    reader.onerror = () => {
      setStatus(a.status, false, "Could not read file");
    };
    reader.readAsText(file);
  }

  async function loadAgentConfigFromFolder(a) {
    const filename = a.configSelect.value;
    if (!filename) {
      setStatus(a.status, false, "Select a config first");
      return;
    }
    if (!configDirHandle) {
      setStatus(a.status, false, "No config folder connected");
      return;
    }
    try {
      const ok = await ensureFolderPermission("read");
      if (!ok) throw new Error("Permission denied");
      const fileHandle = await configDirHandle.getFileHandle(filename);
      const file = await fileHandle.getFile();
      const text = await file.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch (_) {
        setStatus(a.status, false, "Invalid JSON file");
        return;
      }
      applyConfigData(a, data, filename);
    } catch (err) {
      setStatus(a.status, false, `Load failed: ${err.message}`);
    }
  }

  function wireAutoSave() {
    const inputs = document.querySelectorAll("input, textarea, select");
    inputs.forEach((el) => {
      el.addEventListener("change", saveSettings);
    });
  }

  agent1.testBtn.addEventListener("click", () => testConnection(agent1));
  agent2.testBtn.addEventListener("click", () => testConnection(agent2));
  agent1.loadModelsBtn.addEventListener("click", () => loadModels(agent1));
  agent2.loadModelsBtn.addEventListener("click", () => loadModels(agent2));

  agent1.saveConfigBtn.addEventListener("click", () => saveAgentConfig(agent1));
  agent2.saveConfigBtn.addEventListener("click", () => saveAgentConfig(agent2));
  agent1.loadConfigBtn.addEventListener("click", () => loadAgentConfigFromFolder(agent1));
  agent2.loadConfigBtn.addEventListener("click", () => loadAgentConfigFromFolder(agent2));
  agent1.importConfigBtn.addEventListener("click", () => agent1.loadConfigFile.click());
  agent2.importConfigBtn.addEventListener("click", () => agent2.loadConfigFile.click());
  agent1.loadConfigFile.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) loadAgentConfigFromFile(agent1, file);
    e.target.value = "";
  });
  agent2.loadConfigFile.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) loadAgentConfigFromFile(agent2, file);
    e.target.value = "";
  });
  chooseFolderBtn.addEventListener("click", () => chooseConfigFolder());

  els.startBtn.addEventListener("click", () => {
    if (!running) runConversation();
  });

  els.stopBtn.addEventListener("click", () => {
    stopRequested = true;
  });

  els.clearBtn.addEventListener("click", () => {
    els.conversation.innerHTML = "";
  });

  loadSettings();
  wireAutoSave();
  tryRestoreConfigFolder();
})();
