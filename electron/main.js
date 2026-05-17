const { app, BrowserWindow, ipcMain, globalShortcut, Tray, Menu, nativeImage, session } = require('electron');
const path = require('path');
const llm = require('./services/llm');
const keystore = require('./services/keystore');
const { ConversationManager } = require('./services/conversation');
const { generateSpeech, startServer: startTtsServer, shutdown: shutdownTts } = require('./services/tts');
const { transcribe, startServer: startSttServer, shutdown: shutdownStt } = require('./services/stt');
const fileops = require('./services/fileops');
const rag = require('./services/rag');

let mainWindow = null;
let tray = null;
const isDev = !app.isPackaged;

// Conversation state
const conversation = new ConversationManager();
let currentModel = 'gemma4:e4b';

// Clean AI response text for TTS — strip anything that would sound terrible spoken aloud
function cleanForSpeech(text) {
  return text
    .replace(/```[\s\S]*?```/g, '')           // code blocks
    .replace(/`([^`]+)`/g, '$1')              // inline code
    .replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1') // bold/italic
    .replace(/#{1,6}\s*/g, '')                // headers
    .replace(/>\s*/g, '')                     // blockquotes
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links → text only
    .replace(/[-*_]{3,}/g, '')                // horizontal rules
    .replace(/\([^)]*\)/g, '')                // parenthetical asides
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}]/gu, '') // all emoji
    .replace(/[:;]-?[)(DPpOo/\\|><3*]/g, '') // emoticons like :), ;), :D, :P
    .replace(/[/*@#>\[\](){}|\\~^_<>]+/g, '') // stray special chars
    .replace(/\s+/g, ' ')
    .trim();
}

function createWindow() {
  const iconPath = path.join(__dirname, '../build/icon.ico');
  const hasIcon = require('fs').existsSync(iconPath);

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    transparent: true,
    frame: false,
    backgroundColor: '#00000000',
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: -100, y: -100 },
    ...(hasIcon && { icon: iconPath }),
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Grant microphone permission for Web Speech API
  mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'media') {
      callback(true); // Allow microphone access
    } else {
      callback(false);
    }
  });
}

function createTray() {
  const iconPath = path.join(__dirname, '../build/icon.ico');
  let trayIcon;
  try {
    trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  } catch {
    trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon.isEmpty() ? nativeImage.createEmpty() : trayIcon);

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show System', click: () => mainWindow?.show() },
    { label: 'Hide', click: () => mainWindow?.hide() },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);

  tray.setToolTip('System AI Assistant');
  tray.setContextMenu(contextMenu);
  tray.on('click', () => mainWindow?.show());
}

// ─── IPC Handlers ──────────────────────────────────────
ipcMain.handle('window:minimize', () => mainWindow?.minimize());
ipcMain.handle('window:maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});
ipcMain.handle('window:close', () => mainWindow?.hide());
ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized());

// Hardware detection
ipcMain.handle('system:getHardwareInfo', async () => {
  try {
    const si = require('systeminformation');
    const [cpu, mem, graphics, osInfo] = await Promise.all([
      si.cpu(),
      si.mem(),
      si.graphics(),
      si.osInfo(),
    ]);
    return {
      cpu: {
        brand: cpu.brand,
        manufacturer: cpu.manufacturer,
        cores: cpu.cores,
        physicalCores: cpu.physicalCores,
        speed: cpu.speed,
      },
      memory: { total: mem.total, free: mem.free, used: mem.used },
      gpu: graphics.controllers.map((g) => ({
        model: g.model, vendor: g.vendor, vram: g.vram, driver: g.driverVersion,
      })),
      os: { platform: osInfo.platform, distro: osInfo.distro, arch: osInfo.arch },
    };
  } catch (err) {
    return { error: err.message };
  }
});

// LLM provider management
ipcMain.handle('llm:getProviders', () => llm.getProviderList());
ipcMain.handle('llm:getActive', () => llm.getActiveProvider());

ipcMain.handle('llm:setProvider', (_event, { provider, model }) => {
  llm.setProvider(provider, model);
  return llm.getActiveProvider();
});

ipcMain.handle('llm:listModels', async (_event, providerId) => {
  return llm.listModels(providerId);
});

ipcMain.handle('llm:testProvider', async (_event, providerId) => {
  return llm.testProvider(providerId);
});

// Keystore — encrypted API key storage
ipcMain.handle('keystore:set', (_event, { provider, key }) => {
  keystore.setKey(provider, key);
  llm.setKey(provider, key);
  return { ok: true };
});

ipcMain.handle('keystore:getAll', () => {
  // Return which providers have keys (not the keys themselves)
  const keys = keystore.getAllKeys();
  const result = {};
  for (const [k, v] of Object.entries(keys)) {
    result[k] = !!v; // just true/false
  }
  return result;
});

// Ollama status check (kept for setup wizard compatibility)
ipcMain.handle('ollama:status', async () => {
  return llm.checkOllamaStatus();
});

// RAG — folder management
ipcMain.handle('rag:selectFolder', async () => {
  const { dialog } = require('electron');
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select Knowledge Base Folder',
  });
  if (result.canceled || !result.filePaths.length) return { canceled: true };
  const folderPath = result.filePaths[0];
  rag.setFolder(folderPath);
  return { folderPath };
});

ipcMain.handle('rag:getFolder', () => rag.getFolder());

ipcMain.handle('rag:setFolder', (_event, folderPath) => {
  rag.setFolder(folderPath || null);
  return { ok: true };
});

ipcMain.handle('rag:clearFolder', () => {
  rag.setFolder(null);
  return { ok: true };
});

// Chat — routes through active LLM provider
ipcMain.handle('ollama:chat', async (event, { model, message, voiceEnabled, voice, ttsEngine, voiceRate, voicePitch }) => {
  conversation.addUserMessage(message);

  let fullResponse = '';

  // Inject PDF knowledge base context into the system prompt
  const ragContext = await rag.buildContext();
  const systemWithRag = conversation.systemPrompt + ragContext;

  try {
    fullResponse = await llm.chatStream(
      {
        model: model || undefined,
        messages: conversation.getMessages(),
        system: systemWithRag,
      },
      (delta) => {
        event.sender.send('ollama:stream', { content: delta, done: false });
      }
    );
  } catch (err) {
    event.sender.send('ollama:stream', {
      content: `\n[Error: ${err.message}]`,
      done: true,
    });
    event.sender.send('tts:chunk', { done: true });
    return { response: err.message };
  }

  conversation.addAssistantMessage(fullResponse);
  event.sender.send('ollama:stream', { content: '', done: true });

  // Generate TTS
  if (voiceEnabled !== false && fullResponse.trim()) {
    try {
      const cleaned = cleanForSpeech(fullResponse.trim());
      if (cleaned) {
        const audio = await generateSpeech(cleaned, voice || 'jarvis');
        mainWindow?.webContents.send('tts:chunk', {
          audio: audio.toString('base64'),
          done: false,
        });
      }
    } catch (err) {
      console.error('[TTS] Error:', err.message);
    }
  }

  mainWindow?.webContents.send('tts:chunk', { done: true });

  return { response: fullResponse };
});

// List available models (ollama-specific, for setup wizard)
ipcMain.handle('ollama:listModels', async () => {
  return llm.checkOllamaStatus();
});

// Clear conversation history
ipcMain.handle('ollama:clearHistory', async () => {
  conversation.clear();
  return { success: true };
});

// TTS: Generate speech (standalone, not streaming)
ipcMain.handle('tts:generate', async (_event, { text, voice }) => {
  try {
    const buffer = await generateSpeech(text, voice || 'jarvis');
    return { success: true, audio: buffer.toString('base64') };
  } catch (err) {
    console.error('[TTS]', err.message);
    return { success: false, error: err.message };
  }
});

// STT: Transcribe audio to text
ipcMain.handle('stt:transcribe', async (_event, audioBytes) => {
  try {
    const buffer = Buffer.from(audioBytes);
    const result = await transcribe(buffer);
    return result;
  } catch (err) {
    console.error('[STT]', err.message);
    return { text: '', error: err.message };
  }
});

// File operations
ipcMain.handle('file:read', async (_event, filePath) => fileops.readFile(filePath));
ipcMain.handle('file:write', async (_event, { path: filePath, content }) => fileops.writeFile(filePath, content));
ipcMain.handle('file:list', async (_event, { path: dirPath, maxDepth }) => fileops.listFiles(dirPath, maxDepth));
ipcMain.handle('file:openDialog', async () => fileops.openFileDialog(mainWindow));
ipcMain.handle('file:saveDialog', async (_event, { content, defaultName }) => fileops.saveFileDialog(mainWindow, content, defaultName));

// ─── Setup Wizard IPC ──────────────────────────────────
const pythonPath = require('./services/python');

ipcMain.handle('setup:checkDeps', async () => {
  const { execSync } = require('child_process');
  const fs = require('fs');

  const result = {
    ollama: { installed: false, running: false, endpoint: 'http://localhost:11434' },
    python: { installed: false, path: pythonPath },
    edgeTts: { installed: false },
    fasterWhisper: { installed: false },
    hardware: null,
    models: [],
  };

  // Check Ollama
  try {
    const res = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(3000) });
    const data = await res.json();
    result.ollama.running = true;
    result.ollama.installed = true;
    result.models = (data.models || []).map((m) => ({ name: m.name, size: m.size }));
  } catch {
    // Check if ollama binary exists
    try {
      execSync(process.platform === 'win32' ? 'where ollama' : 'which ollama', { encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'ignore'] });
      result.ollama.installed = true;
    } catch {}
  }

  // Check Python
  try {
    const ver = execSync(`"${pythonPath}" --version`, { encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'ignore'] });
    result.python.installed = !!ver.trim();
  } catch {}

  // Check edge-tts
  try {
    execSync(`"${pythonPath}" -c "import edge_tts"`, { encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'ignore'] });
    result.edgeTts.installed = true;
  } catch {}

  // Check faster-whisper
  try {
    execSync(`"${pythonPath}" -c "import faster_whisper"`, { encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'ignore'] });
    result.fasterWhisper.installed = true;
  } catch {}

  // Hardware info
  try {
    const si = require('systeminformation');
    const [cpu, mem, graphics] = await Promise.all([si.cpu(), si.mem(), si.graphics()]);
    result.hardware = {
      cpuBrand: cpu.brand,
      cores: cpu.cores,
      ramTotalGB: +(mem.total / 1e9).toFixed(1),
      ramFreeGB: +(mem.free / 1e9).toFixed(1),
      gpuModel: graphics.controllers[0]?.model || 'Unknown',
      gpuVram: graphics.controllers[0]?.vram || 0,
    };
  } catch {}

  return result;
});

ipcMain.handle('setup:pullModel', async (event, modelName) => {
  const { spawn } = require('child_process');
  return new Promise((resolve, reject) => {
    const child = spawn('ollama', ['pull', modelName], { stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';

    child.stdout.on('data', (data) => {
      output += data.toString();
      // Parse progress from Ollama output
      const lines = data.toString().split('\n');
      for (const line of lines) {
        const pctMatch = line.match(/(\d+)%/);
        if (pctMatch) {
          event.sender.send('setup:pullProgress', {
            model: modelName,
            percent: parseInt(pctMatch[1]),
            status: line.trim(),
          });
        }
      }
    });

    child.stderr.on('data', (data) => {
      output += data.toString();
    });

    child.on('close', (code) => {
      if (code === 0) {
        event.sender.send('setup:pullProgress', { model: modelName, percent: 100, status: 'Done' });
        resolve({ success: true });
      } else {
        resolve({ success: false, error: output.slice(-500) });
      }
    });

    child.on('error', (err) => {
      reject({ success: false, error: err.message });
    });
  });
});

// Stream pip install to renderer
ipcMain.handle('setup:installDeps', async (event) => {
  const { spawn } = require('child_process');
  const send = (text) => event.sender.send('setup:installOutput', text);

  return new Promise((resolve) => {
    const proc = spawn(pythonPath, [
      '-m', 'pip', 'install', 'edge-tts', 'faster-whisper', '--no-warn-script-location', '--progress-bar', 'off',
    ], { stdio: ['pipe', 'pipe', 'pipe'] });

    proc.stdout.on('data', (d) => send(d.toString()));
    proc.stderr.on('data', (d) => send(d.toString()));
    proc.on('close', (code) => resolve({ success: code === 0 }));
    proc.on('error', (err) => resolve({ success: false, error: err.message }));
  });
});

// Open URL in system browser (for Ollama download page)
ipcMain.handle('setup:openUrl', (_event, url) => {
  const { shell } = require('electron');
  shell.openExternal(url);
});

// Re-check deps (call after install)
ipcMain.handle('setup:recheckDeps', async () => {
  const { execSync } = require('child_process');
  const result = { edgeTts: false, fasterWhisper: false, ollama: false };
  try { execSync(`"${pythonPath}" -c "import edge_tts"`, { timeout: 5000, stdio: 'ignore' }); result.edgeTts = true; } catch {}
  try { execSync(`"${pythonPath}" -c "import faster_whisper"`, { timeout: 5000, stdio: 'ignore' }); result.fasterWhisper = true; } catch {}
  try {
    const r = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(2000) });
    result.ollama = r.ok;
  } catch {}
  return result;
});

ipcMain.handle('setup:writeUserMd', async (_event, content) => {
  const fs = require('fs');
  const userMdPath = path.join(__dirname, '../user.md');
  try {
    fs.writeFileSync(userMdPath, content, 'utf-8');
    // Reload user context in conversation manager
    conversation.reloadUserContext();
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ─── App Lifecycle ─────────────────────────────────────
app.whenReady().then(async () => {
  // Load saved API keys into LLM router
  const savedKeys = keystore.getAllKeys();
  for (const [provider, key] of Object.entries(savedKeys)) {
    if (key) llm.setKey(provider, key);
  }

  // Start Python TTS server
  try {
    const port = await startTtsServer();
    console.log(`[TTS] Server ready on port ${port}`);
  } catch (err) {
    console.error('[TTS] Failed to start server:', err.message);
  }

  // Start Python STT server (background, don't block startup)
  startSttServer().then((port) => {
    console.log(`[STT] Server ready on port ${port}`);
  }).catch((err) => {
    console.error('[STT] Failed to start server:', err.message);
  });

  createWindow();
  createTray();

  globalShortcut.register('Alt+J', () => {
    if (mainWindow?.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow?.show();
      mainWindow?.focus();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  shutdownTts();
  shutdownStt();
});
