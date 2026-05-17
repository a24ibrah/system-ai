const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Window controls
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximize: () => ipcRenderer.invoke('window:maximize'),
  close: () => ipcRenderer.invoke('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:isMaximized'),

  // System info
  getHardwareInfo: () => ipcRenderer.invoke('system:getHardwareInfo'),

  // Ollama
  getOllamaStatus: () => ipcRenderer.invoke('ollama:status'),
  chat: (opts) => ipcRenderer.invoke('ollama:chat', opts),
  listModels: () => ipcRenderer.invoke('ollama:listModels'),
  clearHistory: () => ipcRenderer.invoke('ollama:clearHistory'),
  onStreamChunk: (callback) => {
    const subscription = (_event, data) => callback(data);
    ipcRenderer.on('ollama:stream', subscription);
    return () => ipcRenderer.removeListener('ollama:stream', subscription);
  },

  // TTS
  generateSpeech: (opts) => ipcRenderer.invoke('tts:generate', opts),
  onTtsChunk: (callback) => {
    const subscription = (_event, data) => callback(data);
    ipcRenderer.on('tts:chunk', subscription);
    return () => ipcRenderer.removeListener('tts:chunk', subscription);
  },

  // STT
  sttTranscribe: (audioBytes) => ipcRenderer.invoke('stt:transcribe', audioBytes),

  // File operations
  fileRead: (filePath) => ipcRenderer.invoke('file:read', filePath),
  fileWrite: (opts) => ipcRenderer.invoke('file:write', opts),
  fileList: (opts) => ipcRenderer.invoke('file:list', opts),
  fileOpenDialog: () => ipcRenderer.invoke('file:openDialog'),
  fileSaveDialog: (opts) => ipcRenderer.invoke('file:saveDialog', opts),

  // Setup wizard
  checkDependencies: () => ipcRenderer.invoke('setup:checkDeps'),
  recheckDeps: () => ipcRenderer.invoke('setup:recheckDeps'),
  installDeps: () => ipcRenderer.invoke('setup:installDeps'),
  onInstallOutput: (callback) => {
    const subscription = (_event, data) => callback(data);
    ipcRenderer.on('setup:installOutput', subscription);
    return () => ipcRenderer.removeListener('setup:installOutput', subscription);
  },
  openUrl: (url) => ipcRenderer.invoke('setup:openUrl', url),
  pullModel: (modelName) => ipcRenderer.invoke('setup:pullModel', modelName),
  onPullProgress: (callback) => {
    const subscription = (_event, data) => callback(data);
    ipcRenderer.on('setup:pullProgress', subscription);
    return () => ipcRenderer.removeListener('setup:pullProgress', subscription);
  },
  writeUserMd: (content) => ipcRenderer.invoke('setup:writeUserMd', content),

  // LLM provider management
  llmGetProviders: () => ipcRenderer.invoke('llm:getProviders'),
  llmGetActive: () => ipcRenderer.invoke('llm:getActive'),
  llmSetProvider: (opts) => ipcRenderer.invoke('llm:setProvider', opts),
  llmListModels: (providerId) => ipcRenderer.invoke('llm:listModels', providerId),
  llmTestProvider: (providerId) => ipcRenderer.invoke('llm:testProvider', providerId),

  // Keystore
  keystoreSet: (opts) => ipcRenderer.invoke('keystore:set', opts),
  keystoreGetAll: () => ipcRenderer.invoke('keystore:getAll'),

  // RAG — knowledge base folder
  ragSelectFolder: () => ipcRenderer.invoke('rag:selectFolder'),
  ragGetFolder: () => ipcRenderer.invoke('rag:getFolder'),
  ragSetFolder: (folderPath) => ipcRenderer.invoke('rag:setFolder', folderPath),
  ragClearFolder: () => ipcRenderer.invoke('rag:clearFolder'),

  // Generic IPC
  send: (channel, data) => ipcRenderer.send(channel, data),
  on: (channel, callback) => {
    const subscription = (_event, ...args) => callback(...args);
    ipcRenderer.on(channel, subscription);
    return () => ipcRenderer.removeListener(channel, subscription);
  },
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
});
