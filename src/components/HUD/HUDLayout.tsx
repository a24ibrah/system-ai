import { useEffect } from 'react';
import { motion } from 'framer-motion';
import ArcReactor from './ArcReactor';
import LeftPanel from './LeftPanel';
import RightPanel from './RightPanel';
import ChatPanel from '../Chat/ChatPanel';
import SettingsPanel from '../Settings/SettingsPanel';
import { useChatStore } from '../../stores/chatStore';
import './HUDLayout.css';

const stagger = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.15, delayChildren: 0.2 },
  },
};

const slideUp = {
  hidden: { opacity: 0, y: 30 },
  show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] } },
};

const slideLeft = {
  hidden: { opacity: 0, x: -40 },
  show: { opacity: 1, x: 0, transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] } },
};

const slideRight = {
  hidden: { opacity: 0, x: 40 },
  show: { opacity: 1, x: 0, transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] } },
};

export default function HUDLayout() {
  const {
    checkOllamaStatus,
    voiceEnabled,
    toggleVoice,
    isSpeaking,
    micActive,
    micStatus,
    toggleMic,
    toggleSettings,
    settings,
  } = useChatStore();

  useEffect(() => {
    checkOllamaStatus();
    // Restore saved RAG folder to main process
    const api = (window as any).electronAPI;
    if (settings.ragFolder && api?.ragSetFolder) {
      api.ragSetFolder(settings.ragFolder);
    }
  }, [checkOllamaStatus]);

  return (
    <motion.div
      className="hud-layout"
      variants={stagger}
      initial="hidden"
      animate="show"
    >
      {/* Left Panel */}
      <motion.div className="hud-left" variants={slideLeft}>
        <LeftPanel />
      </motion.div>

      {/* Center: Arc Reactor + Chat */}
      <motion.div className="hud-center" variants={slideUp}>
        <div className="hud-reactor-area">
          <ArcReactor />
        </div>
        <div className="hud-chat-area">
          <ChatPanel />
        </div>
      </motion.div>

      {/* Right Panel */}
      <motion.div className="hud-right" variants={slideRight}>
        <RightPanel />
      </motion.div>

      {/* Bottom bar */}
      <motion.div className="hud-bottom" variants={slideUp}>
        <div className="hud-bottom-divider" />
        <div className="hud-bottom-controls">
          {/* Mic */}
          <button
            className={`hud-icon-btn ${micActive ? 'active' : ''}`}
            id="btn-mic"
            title={
              micActive
                ? (settings.micAlwaysOn ? 'Always listening' : 'Listening...')
                : (settings.micAlwaysOn ? 'Click to activate always-on' : 'Click to speak')
            }
            onClick={toggleMic}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
              <line x1="12" y1="19" x2="12" y2="23"/>
              <line x1="8" y1="23" x2="16" y2="23"/>
            </svg>
          </button>

          {/* Speaker */}
          <button
            className={`hud-icon-btn ${voiceEnabled ? 'active' : ''} ${isSpeaking ? 'speaking' : ''}`}
            id="btn-speaker"
            title={voiceEnabled ? 'Voice ON' : 'Voice OFF'}
            onClick={toggleVoice}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
            </svg>
          </button>

          {/* Type mode — focus chat input */}
          <button
            className="hud-icon-btn"
            id="btn-type-mode"
            title="Type Mode"
            onClick={() => document.getElementById('chat-input')?.focus()}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="4 7 4 4 20 4 20 7"/>
              <line x1="9" y1="20" x2="15" y2="20"/>
              <line x1="12" y1="4" x2="12" y2="20"/>
            </svg>
          </button>

          {/* Settings */}
          <button
            className="hud-icon-btn"
            id="btn-settings"
            title="Settings"
            onClick={toggleSettings}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
          </button>
        </div>

        {/* Mic status */}
        {micActive && !micStatus && (
          <div className="hud-listening-transcript">
            <span className="hud-listening-dot" />
            {settings.micAlwaysOn ? 'Always listening...' : 'Listening...'}
          </div>
        )}
        {micStatus && (
          <div className="hud-listening-transcript">
            <span className="hud-listening-dot" />
            {micStatus}
          </div>
        )}
      </motion.div>

      {/* Settings overlay */}
      <SettingsPanel />
    </motion.div>
  );
}
