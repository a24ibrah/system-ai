import { create } from 'zustand';
import type { Message } from '../types/chat';

// ── Types ──────────────────────────────────────────────
interface OllamaModel {
  name: string;
  size: number;
}

export type ProviderId = 'ollama' | 'groq' | 'openrouter' | 'gemini' | 'openai' | 'anthropic';

interface AppSettings {
  ttsEngine: 'edge' | 'fish';
  voice: 'jarvis' | 'friday';
  voiceRate: number;
  voicePitch: number;
  micAlwaysOn: boolean;
  silenceMs: number;
  ollamaEndpoint: string;
  // Multi-provider
  activeProvider: ProviderId;
  activeModel: string;
  // RAG knowledge base folder
  ragFolder: string;
  // Legacy (kept for compat)
  apiProvider: 'ollama' | 'openai';
  apiKey: string;
  apiModel: string;
}

interface ChatState {
  messages: Message[];
  isStreaming: boolean;
  currentModel: string;
  ollamaRunning: boolean;
  availableModels: OllamaModel[];
  voiceEnabled: boolean;
  isSpeaking: boolean;
  micActive: boolean;
  micStatus: string;
  settingsOpen: boolean;
  settings: AppSettings;

  sendMessage: (text: string) => Promise<void>;
  checkOllamaStatus: () => Promise<void>;
  setModel: (model: string) => void;
  clearChat: () => void;
  toggleVoice: () => void;
  stopSpeaking: () => void;
  toggleMic: () => void;
  toggleSettings: () => void;
  updateSettings: (patch: Partial<AppSettings>) => void;
}

// ── Text cleanup for TTS ──────────────────────────────
function cleanForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1')
    .replace(/#{1,6}\s*/g, '')
    .replace(/>\s*/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[-*_]{3,}/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}]/gu, '')
    .replace(/[:;]-?[)(DPpOo/\\|><3*]/g, '')
    .replace(/[/*@#>\[\](){}|\\~^_<>]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Audio Queue ────────────────────────────────────────
let audioQueue: string[] = [];
let isPlayingQueue = false;
let audioPlayer: HTMLAudioElement | null = null;

function enqueueAudio(base64Audio: string) {
  audioQueue.push(base64Audio);
  if (!isPlayingQueue) playNextInQueue();
}

async function playNextInQueue() {
  if (audioQueue.length === 0) {
    isPlayingQueue = false;
    return;
  }
  isPlayingQueue = true;
  const base64 = audioQueue.shift()!;

  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: 'audio/mp3' });
    const url = URL.createObjectURL(blob);

    await new Promise<void>((resolve) => {
      audioPlayer = new Audio(url);
      audioPlayer.volume = 0.9;
      audioPlayer.onended = () => {
        URL.revokeObjectURL(url);
        resolve();
      };
      audioPlayer.onerror = () => {
        URL.revokeObjectURL(url);
        resolve();
      };
      audioPlayer.play().catch(() => resolve());
    });
  } catch (err) {
    console.error('[TTS] Playback error:', err);
  }

  playNextInQueue();
}

function stopAllAudio() {
  audioQueue = [];
  isPlayingQueue = false;
  if (audioPlayer) {
    audioPlayer.pause();
    audioPlayer.currentTime = 0;
    audioPlayer = null;
  }
  if (standalonePlayer) {
    standalonePlayer.pause();
    standalonePlayer.currentTime = 0;
    standalonePlayer = null;
  }
}

// ── Standalone TTS (for boot greeting etc) ─────────────
let standalonePlayer: HTMLAudioElement | null = null;

export async function speakText(text: string, voice: 'jarvis' | 'friday' = 'jarvis'): Promise<void> {
  const api = (window as any).electronAPI;
  if (!api?.generateSpeech || !text) return;

  const cleaned = cleanForSpeech(text);
  if (!cleaned) return;

  try {
    const result = await api.generateSpeech({ text: cleaned, voice });
    if (!result.success || !result.audio) return;

    const binary = atob(result.audio);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: 'audio/mp3' });
    const url = URL.createObjectURL(blob);

    await new Promise<void>((resolve) => {
      standalonePlayer = new Audio(url);
      standalonePlayer.volume = 0.9;
      standalonePlayer.onended = () => { URL.revokeObjectURL(url); resolve(); };
      standalonePlayer.onerror = () => { URL.revokeObjectURL(url); resolve(); };
      standalonePlayer.play().catch(() => resolve());
    });
  } catch (err) {
    console.error('[TTS] Standalone error:', err);
  }
}

// ── STT — MediaRecorder + Whisper ──────────────────────
let micStream: MediaStream | null = null;
let mediaRecorder: MediaRecorder | null = null;
let recordedChunks: Blob[] = [];
let silenceTimer: ReturnType<typeof setTimeout> | null = null;
let audioContext: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let silenceMonitorRaf: number | null = null;
const SILENCE_THRESHOLD = 0.015;

// Voice interrupt monitor — separate from STT
let interruptAudioContext: AudioContext | null = null;
let interruptAnalyser: AnalyserNode | null = null;
let interruptMonitorRaf: number | null = null;
let interruptStream: MediaStream | null = null;

async function startVoiceInterruptMonitor(onVoiceDetected: () => void) {
  try {
    interruptStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    return; // no mic access, skip
  }

  interruptAudioContext = new AudioContext();
  interruptAnalyser = interruptAudioContext.createAnalyser();
  interruptAnalyser.fftSize = 512;
  const source = interruptAudioContext.createMediaStreamSource(interruptStream);
  source.connect(interruptAnalyser);

  const dataArray = new Float32Array(interruptAnalyser.fftSize);
  let voiceFrames = 0;
  const VOICE_FRAMES_THRESHOLD = 5; // ~5 frames of voice = intentional speech

  const check = () => {
    if (!interruptAnalyser) return;
    interruptAnalyser.getFloatTimeDomainData(dataArray);

    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) sum += dataArray[i] * dataArray[i];
    const rms = Math.sqrt(sum / dataArray.length);

    if (rms > 0.03) { // higher threshold for interrupt — must be actual speech
      voiceFrames++;
      if (voiceFrames >= VOICE_FRAMES_THRESHOLD) {
        onVoiceDetected();
        stopVoiceInterruptMonitor();
        return;
      }
    } else {
      voiceFrames = Math.max(0, voiceFrames - 1);
    }

    interruptMonitorRaf = requestAnimationFrame(check);
  };

  interruptMonitorRaf = requestAnimationFrame(check);
}

function stopVoiceInterruptMonitor() {
  if (interruptMonitorRaf) { cancelAnimationFrame(interruptMonitorRaf); interruptMonitorRaf = null; }
  if (interruptAudioContext) { interruptAudioContext.close(); interruptAudioContext = null; }
  interruptAnalyser = null;
  if (interruptStream) {
    interruptStream.getTracks().forEach(t => t.stop());
    interruptStream = null;
  }
}

async function startRecording(
  onStatus: (status: string) => void,
  onResult: (text: string) => void,
  silenceMs: number
): Promise<boolean> {
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err: any) {
    console.error('[STT] Mic permission denied:', err.message);
    return false;
  }

  recordedChunks = [];
  mediaRecorder = new MediaRecorder(micStream, { mimeType: 'audio/webm' });

  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) recordedChunks.push(e.data);
  };

  mediaRecorder.onstop = async () => {
    stopSilenceMonitor();
    if (micStream) {
      micStream.getTracks().forEach(t => t.stop());
      micStream = null;
    }

    if (recordedChunks.length === 0) {
      onStatus('');
      return;
    }

    onStatus('Transcribing...');

    const blob = new Blob(recordedChunks, { type: 'audio/webm' });
    const arrayBuffer = await blob.arrayBuffer();
    const audioBytes = Array.from(new Uint8Array(arrayBuffer));

    const api = (window as any).electronAPI;
    if (!api?.sttTranscribe) {
      onStatus('');
      return;
    }

    try {
      const result = await api.sttTranscribe(audioBytes);
      onStatus('');
      if (result?.text?.trim()) {
        onResult(result.text.trim());
      }
    } catch (err: any) {
      console.error('[STT] Transcription error:', err.message);
      onStatus('');
    }
  };

  mediaRecorder.start(250);
  startSilenceMonitor(micStream, silenceMs);
  return true;
}

function startSilenceMonitor(stream: MediaStream, silenceMs: number) {
  audioContext = new AudioContext();
  analyser = audioContext.createAnalyser();
  analyser.fftSize = 512;
  const source = audioContext.createMediaStreamSource(stream);
  source.connect(analyser);

  const dataArray = new Float32Array(analyser.fftSize);

  const checkVolume = () => {
    if (!analyser || !mediaRecorder || mediaRecorder.state !== 'recording') return;
    analyser.getFloatTimeDomainData(dataArray);

    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) sum += dataArray[i] * dataArray[i];
    const rms = Math.sqrt(sum / dataArray.length);

    if (rms < SILENCE_THRESHOLD) {
      if (!silenceTimer) {
        silenceTimer = setTimeout(() => {
          if (mediaRecorder && mediaRecorder.state === 'recording') {
            mediaRecorder.stop();
            mediaRecorder = null;
          }
        }, silenceMs);
      }
    } else {
      if (silenceTimer) {
        clearTimeout(silenceTimer);
        silenceTimer = null;
      }
    }

    silenceMonitorRaf = requestAnimationFrame(checkVolume);
  };

  silenceMonitorRaf = requestAnimationFrame(checkVolume);
}

function stopSilenceMonitor() {
  if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; }
  if (silenceMonitorRaf) { cancelAnimationFrame(silenceMonitorRaf); silenceMonitorRaf = null; }
  if (audioContext) { audioContext.close(); audioContext = null; }
  analyser = null;
}

function stopRecording() {
  stopSilenceMonitor();
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
    mediaRecorder = null;
  }
}

// ── Always-on mic loop ────────────────────────────────
let alwaysOnActive = false;

async function startAlwaysOnLoop(
  onStatus: (status: string) => void,
  onResult: (text: string) => void,
  silenceMs: number
) {
  alwaysOnActive = true;

  const loop = async () => {
    if (!alwaysOnActive) return;

    // Start recording
    const success = await startRecording(
      onStatus,
      (text) => {
        if (text) onResult(text);
        // After result, restart the loop
        if (alwaysOnActive) {
          setTimeout(loop, 300);
        }
      },
      silenceMs
    );

    if (!success) {
      alwaysOnActive = false;
    }
  };

  loop();
}

function stopAlwaysOnLoop() {
  alwaysOnActive = false;
  stopRecording();
}

// ── Default settings ──────────────────────────────────
const DEFAULT_SETTINGS: AppSettings = {
  ttsEngine: 'edge',
  voice: 'jarvis',
  voiceRate: 0,
  voicePitch: -10,
  micAlwaysOn: false,
  silenceMs: 1500,
  ollamaEndpoint: 'http://localhost:11434',
  activeProvider: 'ollama',
  activeModel: '',
  ragFolder: '',
  apiProvider: 'ollama',
  apiKey: '',
  apiModel: '',
};

// ── Load saved settings ───────────────────────────────
function loadSettings(): AppSettings {
  try {
    const saved = localStorage.getItem('system-ai-settings');
    if (saved) return { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
  } catch {}
  return DEFAULT_SETTINGS;
}

// ── Store ─────────────────────────────────────────────
export const useChatStore = create<ChatState>((set, get) => ({
  messages: [
    {
      id: 'init',
      role: 'assistant',
      content: 'All systems are online, sir. Standing by.',
      timestamp: new Date(),
    },
  ],
  isStreaming: false,
  currentModel: '',
  ollamaRunning: false,
  availableModels: [],
  voiceEnabled: true,
  isSpeaking: false,
  micActive: false,
  micStatus: '',
  settingsOpen: false,
  settings: loadSettings(),

  sendMessage: async (text: string) => {
    const api = (window as any).electronAPI;
    if (!api) return;

    // Smart interrupt: stop AI speech when user sends a message
    stopAllAudio();
    stopVoiceInterruptMonitor();
    set({ isSpeaking: false });

    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: text,
      timestamp: new Date(),
    };

    const assistantId = (Date.now() + 1).toString();
    const assistantMsg: Message = {
      id: assistantId,
      role: 'assistant',
      content: '',
      timestamp: new Date(),
    };

    set((state) => ({
      messages: [...state.messages, userMsg, assistantMsg],
      isStreaming: true,
    }));

    const unsubStream = api.onStreamChunk((data: { content: string; done: boolean }) => {
      if (data.done) {
        set({ isStreaming: false });
        unsubStream();
        return;
      }
      set((state) => {
        const msgs = [...state.messages];
        const last = msgs[msgs.length - 1];
        if (last && last.id === assistantId) {
          msgs[msgs.length - 1] = { ...last, content: last.content + data.content };
        }
        return { messages: msgs };
      });
    });

    let hasAudio = false;
    const unsubTts = api.onTtsChunk((data: { audio?: string; done: boolean }) => {
      if (data.done) {
        unsubTts();
        if (hasAudio) set({ isSpeaking: false });
        // Start voice interrupt monitor after AI finishes speaking
        if (hasAudio && get().settings.micAlwaysOn) {
          startVoiceInterruptMonitor(() => {
            // Voice detected while AI is about to speak again — this handles
            // the case where TTS is queued. For immediate interrupt,
            // we rely on sendMessage calling stopAllAudio.
          });
        }
        return;
      }
      if (data.audio) {
        hasAudio = true;
        set({ isSpeaking: true });
        enqueueAudio(data.audio);
      }
    });

    try {
      await api.chat({
        message: text,
        model: get().currentModel || undefined,
        voiceEnabled: get().voiceEnabled,
        ttsEngine: get().settings.ttsEngine,
        voice: get().settings.voice,
        voiceRate: get().settings.voiceRate,
        voicePitch: get().settings.voicePitch,
      });
    } catch (err: any) {
      set((state) => {
        const msgs = [...state.messages];
        const last = msgs[msgs.length - 1];
        if (last && last.id === assistantId) {
          msgs[msgs.length - 1] = {
            ...last,
            content: last.content || `[Connection error: ${err.message}]`,
          };
        }
        return { messages: msgs, isStreaming: false };
      });
      unsubStream();
      unsubTts();
    }
  },

  checkOllamaStatus: async () => {
    const api = (window as any).electronAPI;
    if (!api) return;
    try {
      const status = await api.listModels();
      set({
        ollamaRunning: status.running,
        availableModels: status.models,
        currentModel: status.models[0]?.name || '',
      });
    } catch {
      set({ ollamaRunning: false, availableModels: [] });
    }
  },

  setModel: (model: string) => set({ currentModel: model }),

  toggleVoice: () => {
    const next = !get().voiceEnabled;
    if (!next) {
      stopAllAudio();
      stopVoiceInterruptMonitor();
      set({ voiceEnabled: false, isSpeaking: false });
    } else {
      set({ voiceEnabled: true });
    }
  },

  stopSpeaking: () => {
    stopAllAudio();
    stopVoiceInterruptMonitor();
    set({ isSpeaking: false });
  },

  clearChat: () => {
    stopAllAudio();
    (window as any).electronAPI?.clearHistory();
    set({
      isSpeaking: false,
      messages: [
        {
          id: Date.now().toString(),
          role: 'assistant',
          content: 'Memory banks cleared, sir. Ready for new instructions.',
          timestamp: new Date(),
        },
      ],
    });
  },

  toggleSettings: () => set((s) => ({ settingsOpen: !s.settingsOpen })),

  updateSettings: (patch) => {
    set((state) => {
      const newSettings = { ...state.settings, ...patch };
      localStorage.setItem('system-ai-settings', JSON.stringify(newSettings));

      const api = (window as any).electronAPI;
      // Sync provider change to main process
      if (patch.activeProvider || patch.activeModel) {
        api?.llmSetProvider({
          provider: newSettings.activeProvider,
          model: newSettings.activeModel || undefined,
        });
      }

      return { settings: newSettings };
    });
  },

  // ── Mic ───────────────────────────────────────────────
  toggleMic: () => {
    const { micActive, settings } = get();
    if (micActive) {
      stopRecording();
      stopAlwaysOnLoop();
      set({ micActive: false, micStatus: '' });
    } else {
      set({ micActive: true, micStatus: '' });

      if (settings.micAlwaysOn) {
        // Always-on mode: keep listening in a loop
        startAlwaysOnLoop(
          (status) => set({ micStatus: status }),
          (text) => {
            set({ micStatus: '' });
            get().sendMessage(text);
          },
          settings.silenceMs
        );
      } else {
        // Single-shot mode: record once, send, stop
        startRecording(
          (status) => set({ micStatus: status }),
          (text) => {
            set({ micActive: false, micStatus: '' });
            get().sendMessage(text);
          },
          settings.silenceMs
        ).then((success) => {
          if (!success) set({ micActive: false });
        });
      }
    }
  },
}));
