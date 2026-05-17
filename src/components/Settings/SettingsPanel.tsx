import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useChatStore, type ProviderId } from '../../stores/chatStore';
import './SettingsPanel.css';

const PROVIDERS: { id: ProviderId; label: string; free: boolean; needsKey: boolean; defaultModel: string; hint?: string }[] = [
  { id: 'ollama',     label: 'Ollama (Local)',     free: true,  needsKey: false, defaultModel: 'gemma3:4b' },
  { id: 'groq',       label: 'Groq (Free)',         free: true,  needsKey: true,  defaultModel: 'llama-3.3-70b-versatile', hint: 'console.groq.com' },
  { id: 'openrouter', label: 'OpenRouter (Free)',   free: true,  needsKey: true,  defaultModel: 'meta-llama/llama-3.3-70b-instruct:free', hint: 'openrouter.ai' },
  { id: 'gemini',     label: 'Google Gemini',       free: false, needsKey: true,  defaultModel: 'gemini-2.0-flash', hint: 'aistudio.google.com' },
  { id: 'openai',     label: 'OpenAI',              free: false, needsKey: true,  defaultModel: 'gpt-4o-mini' },
  { id: 'anthropic',  label: 'Claude (Anthropic)',  free: false, needsKey: true,  defaultModel: 'claude-sonnet-4-6' },
];

const GROQ_MODELS = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'gemma2-9b-it', 'mixtral-8x7b-32768'];
const GEMINI_MODELS = ['gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-1.5-pro', 'gemini-1.5-flash'];
const OPENROUTER_FREE = ['meta-llama/llama-3.3-70b-instruct:free', 'meta-llama/llama-3.1-8b-instruct:free', 'google/gemma-3-27b-it:free', 'deepseek/deepseek-r1:free'];
const ANTHROPIC_MODELS = ['claude-sonnet-4-6', 'claude-opus-4-7', 'claude-haiku-4-5-20251001'];
const OPENAI_MODELS = ['gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo'];

function getModelList(id: ProviderId): string[] {
  switch (id) {
    case 'groq':       return GROQ_MODELS;
    case 'gemini':     return GEMINI_MODELS;
    case 'openrouter': return OPENROUTER_FREE;
    case 'anthropic':  return ANTHROPIC_MODELS;
    case 'openai':     return OPENAI_MODELS;
    default:           return [];
  }
}

export default function SettingsPanel() {
  const {
    settingsOpen, toggleSettings, settings, updateSettings,
    availableModels, currentModel, setModel, ollamaRunning,
  } = useChatStore();

  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [keyStatus, setKeyStatus] = useState<Record<string, 'idle' | 'testing' | 'ok' | 'error'>>({});
  const [savedKeys, setSavedKeys] = useState<Record<string, boolean>>({});

  const api = (window as any).electronAPI;

  // Load which providers have saved keys
  useEffect(() => {
    if (!settingsOpen || !api?.keystoreGetAll) return;
    api.keystoreGetAll().then((has: Record<string, boolean>) => setSavedKeys(has));
  }, [settingsOpen]);

  const handleSaveKey = useCallback(async (providerId: ProviderId) => {
    const key = apiKeys[providerId] || '';
    if (!api?.keystoreSet) return;
    await api.keystoreSet({ provider: providerId, key });
    setSavedKeys((prev) => ({ ...prev, [providerId]: !!key }));
    setApiKeys((prev) => ({ ...prev, [providerId]: '' })); // clear field after save
  }, [apiKeys]);

  const handleTestKey = useCallback(async (providerId: ProviderId) => {
    if (!api?.llmTestProvider) return;
    setKeyStatus((prev) => ({ ...prev, [providerId]: 'testing' }));
    const result = await api.llmTestProvider(providerId);
    setKeyStatus((prev) => ({ ...prev, [providerId]: result.ok ? 'ok' : 'error' }));
    setTimeout(() => setKeyStatus((prev) => ({ ...prev, [providerId]: 'idle' })), 3000);
  }, []);

  const handleProviderChange = useCallback((id: ProviderId) => {
    const meta = PROVIDERS.find((p) => p.id === id);
    updateSettings({ activeProvider: id, activeModel: meta?.defaultModel || '' });
    if (id === 'ollama') setModel(availableModels[0]?.name || '');
  }, [availableModels]);

  if (!settingsOpen) return null;

  const activeProvider = settings.activeProvider || 'ollama';
  const activeMeta = PROVIDERS.find((p) => p.id === activeProvider)!;
  const modelList = activeProvider === 'ollama'
    ? availableModels.map((m) => m.name)
    : getModelList(activeProvider);

  return (
    <AnimatePresence>
      <motion.div
        className="settings-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={toggleSettings}
      >
        <motion.div
          className="settings-panel"
          initial={{ opacity: 0, y: 20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.95 }}
          transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="settings-header">
            <span className="settings-title">SYSTEM CONFIGURATION</span>
            <button className="settings-close" onClick={toggleSettings}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>

          <div className="settings-body">

            {/* ── LLM Provider ─────────────────────────── */}
            <div className="settings-section">
              <div className="settings-section-title">INTELLIGENCE</div>

              <div className="settings-row">
                <label>Provider</label>
                <select
                  className="settings-select"
                  value={activeProvider}
                  onChange={(e) => handleProviderChange(e.target.value as ProviderId)}
                >
                  {PROVIDERS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}{p.free ? ' ✦' : ''}
                    </option>
                  ))}
                </select>
              </div>

              {activeProvider === 'ollama' ? (
                <>
                  <div className="settings-row">
                    <label>Endpoint</label>
                    <input
                      type="text"
                      className="settings-input"
                      value={settings.ollamaEndpoint}
                      onChange={(e) => updateSettings({ ollamaEndpoint: e.target.value })}
                      placeholder="http://localhost:11434"
                    />
                  </div>
                  <div className="settings-row">
                    <label>Model</label>
                    <select
                      className="settings-select"
                      value={currentModel}
                      onChange={(e) => setModel(e.target.value)}
                      disabled={!ollamaRunning}
                    >
                      {!ollamaRunning && <option>Ollama not running</option>}
                      {availableModels.map((m) => (
                        <option key={m.name} value={m.name}>
                          {m.name} ({(m.size / 1e9).toFixed(1)}GB)
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              ) : (
                <>
                  {/* API Key row */}
                  <div className="settings-row">
                    <label>API Key</label>
                    <div className="settings-key-row">
                      <input
                        type="password"
                        className="settings-input"
                        value={apiKeys[activeProvider] || ''}
                        onChange={(e) => setApiKeys((prev) => ({ ...prev, [activeProvider]: e.target.value }))}
                        placeholder={savedKeys[activeProvider] ? '••••••••  (saved)' : 'Paste key here'}
                      />
                      <button
                        className="settings-key-btn"
                        onClick={() => handleSaveKey(activeProvider)}
                        disabled={!apiKeys[activeProvider]}
                      >
                        Save
                      </button>
                      <button
                        className={`settings-key-btn settings-key-test ${keyStatus[activeProvider] || 'idle'}`}
                        onClick={() => handleTestKey(activeProvider)}
                        disabled={keyStatus[activeProvider] === 'testing' || !savedKeys[activeProvider]}
                      >
                        {keyStatus[activeProvider] === 'testing' ? '…' :
                         keyStatus[activeProvider] === 'ok'      ? '✓' :
                         keyStatus[activeProvider] === 'error'   ? '✗' : 'Test'}
                      </button>
                    </div>
                  </div>

                  {activeMeta.hint && !savedKeys[activeProvider] && (
                    <div className="settings-hint">
                      Get free key at <span className="settings-hint-link">{activeMeta.hint}</span>
                    </div>
                  )}

                  {/* Model */}
                  <div className="settings-row">
                    <label>Model</label>
                    {modelList.length > 0 ? (
                      <select
                        className="settings-select"
                        value={settings.activeModel || activeMeta.defaultModel}
                        onChange={(e) => updateSettings({ activeModel: e.target.value })}
                      >
                        {modelList.map((m) => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        className="settings-input"
                        value={settings.activeModel || activeMeta.defaultModel}
                        onChange={(e) => updateSettings({ activeModel: e.target.value })}
                        placeholder={activeMeta.defaultModel}
                      />
                    )}
                  </div>
                </>
              )}

              {/* Key status bar */}
              <div className="settings-provider-status">
                {PROVIDERS.filter((p) => p.needsKey).map((p) => (
                  <span
                    key={p.id}
                    className={`settings-provider-dot ${savedKeys[p.id] ? 'active' : ''}`}
                    title={`${p.label}: ${savedKeys[p.id] ? 'key saved' : 'no key'}`}
                  />
                ))}
                <span className="settings-provider-status-label">
                  {Object.values(savedKeys).filter(Boolean).length} API key(s) saved
                </span>
              </div>
            </div>

            {/* ── Voice ───────────────────────────────── */}
            <div className="settings-section">
              <div className="settings-section-title">VOICE</div>
              <div className="settings-row">
                <label>TTS Engine</label>
                <div className="settings-toggle-group">
                  <button
                    className={`settings-toggle-btn ${settings.ttsEngine === 'edge' ? 'active' : ''}`}
                    onClick={() => updateSettings({ ttsEngine: 'edge' })}
                  >Edge TTS</button>
                  <button
                    className={`settings-toggle-btn ${settings.ttsEngine === 'fish' ? 'active' : ''}`}
                    onClick={() => updateSettings({ ttsEngine: 'fish' })}
                  >Fish Speech</button>
                </div>
              </div>
              <div className="settings-row">
                <label>Persona</label>
                <div className="settings-toggle-group">
                  <button
                    className={`settings-toggle-btn ${settings.voice === 'jarvis' ? 'active' : ''}`}
                    onClick={() => updateSettings({ voice: 'jarvis' })}
                  >J.A.R.V.I.S.</button>
                  <button
                    className={`settings-toggle-btn ${settings.voice === 'friday' ? 'active' : ''}`}
                    onClick={() => updateSettings({ voice: 'friday' })}
                  >F.R.I.D.A.Y.</button>
                </div>
              </div>
              <div className="settings-row">
                <label>Rate ({settings.voiceRate > 0 ? '+' : ''}{settings.voiceRate}%)</label>
                <input type="range" className="settings-range" min="-50" max="50"
                  value={settings.voiceRate}
                  onChange={(e) => updateSettings({ voiceRate: parseInt(e.target.value) })} />
              </div>
              <div className="settings-row">
                <label>Pitch ({settings.voicePitch > 0 ? '+' : ''}{settings.voicePitch})</label>
                <input type="range" className="settings-range" min="-50" max="50"
                  value={settings.voicePitch}
                  onChange={(e) => updateSettings({ voicePitch: parseInt(e.target.value) })} />
              </div>
            </div>

            {/* ── Microphone ──────────────────────────── */}
            <div className="settings-section">
              <div className="settings-section-title">MICROPHONE</div>
              <div className="settings-row">
                <label>Always Listening</label>
                <button
                  className={`settings-switch ${settings.micAlwaysOn ? 'active' : ''}`}
                  onClick={() => updateSettings({ micAlwaysOn: !settings.micAlwaysOn })}
                >
                  <span className="settings-switch-knob" />
                </button>
              </div>
              <div className="settings-row">
                <label>Silence Timeout ({(settings.silenceMs / 1000).toFixed(1)}s)</label>
                <input type="range" className="settings-range" min="500" max="3000" step="100"
                  value={settings.silenceMs}
                  onChange={(e) => updateSettings({ silenceMs: parseInt(e.target.value) })} />
              </div>
            </div>

            {/* ── Knowledge Base ──────────────────────── */}
            <div className="settings-section">
              <div className="settings-section-title">KNOWLEDGE BASE</div>
              <div className="settings-row">
                <label>PDF Folder</label>
                <div className="settings-key-row">
                  <input
                    type="text"
                    className="settings-input"
                    readOnly
                    value={settings.ragFolder || ''}
                    placeholder="No folder selected"
                    title={settings.ragFolder || ''}
                  />
                  <button
                    className="settings-key-btn"
                    onClick={async () => {
                      const result = await api?.ragSelectFolder?.();
                      if (result && !result.canceled) {
                        updateSettings({ ragFolder: result.folderPath });
                      }
                    }}
                  >
                    Browse
                  </button>
                  {settings.ragFolder && (
                    <button
                      className="settings-key-btn"
                      onClick={() => updateSettings({ ragFolder: '' })}
                      title="Remove folder"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>
              {settings.ragFolder && (
                <div className="settings-hint">
                  PDFs in this folder are included as context with every message.
                </div>
              )}
            </div>

          </div>

          <div className="settings-footer">
            <span className="settings-hint-label">✦ = free tier available</span>
            <span className="settings-version">System AI v0.3.0</span>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
