import { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';
import { API_BASE, DEMO_USER_ID } from '../config';
import { loadProfile } from '../components/ProfileModal';

type Action = { label: string; icon: string; tab: string };
type Message = { role: 'user' | 'assistant'; text: string; audioContent?: string; lang?: string; action?: Action };
type Status = 'idle' | 'listening' | 'thinking';

const INTENT_ACTIONS: Record<string, Action> = {
  booking:    { label: 'Book an Appointment', icon: '📅', tab: 'appointments' },
  emergency:  { label: 'Find Nearby Hospital', icon: '🏥', tab: 'hospitals' },
  medication: { label: 'Manage My Meds',      icon: '💊', tab: 'medications' },
};

// Languages available for speech recognition
const RECOG_LANGS = [
  { code: 'hi', bcp: 'hi-IN', label: 'हिंदी' },
  { code: 'en', bcp: 'en-IN', label: 'English' },
  { code: 'bn', bcp: 'bn-IN', label: 'বাংলা' },
  { code: 'te', bcp: 'te-IN', label: 'తెలుగు' },
  { code: 'ta', bcp: 'ta-IN', label: 'தமிழ்' },
  { code: 'mr', bcp: 'mr-IN', label: 'मराठी' },
];

function detectTypedLang(text: string, fallback: string): string {
  if (/[\u0900-\u097F]/.test(text)) return 'hi';
  if (/[\u0980-\u09FF]/.test(text)) return 'bn';
  if (/[\u0C00-\u0C7F]/.test(text)) return 'te';
  if (/[\u0B80-\u0BFF]/.test(text)) return 'ta';
  if (/[\u0A80-\u0AFF]/.test(text)) return 'gu';
  if (/[\u0C80-\u0CFF]/.test(text)) return 'kn';
  if (/[\u0D00-\u0D7F]/.test(text)) return 'ml';
  if (/[\u0A00-\u0A7F]/.test(text)) return 'pa';
  return fallback;
}

export default function VoiceTab({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const profile = loadProfile();
  const sessionIdRef = useRef(`session-${Date.now()}`);
  const recognitionRef = useRef<any>(null);

  const defaultLang = RECOG_LANGS.find(l => l.code === profile?.language) ?? RECOG_LANGS[0];
  const [recogLang, setRecogLang] = useState(defaultLang);

  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      text: profile?.name
        ? `Namaste ${profile.name}! I am Bhasha AI. Tap the mic and speak — I will understand you.`
        : 'Namaste! I am Bhasha AI. Tap the mic and speak in any Indian language.',
    },
  ]);

  const [status, setStatus] = useState<Status>('idle');
  const [inputText, setInputText] = useState('');
  const [processingLabel, setProcessingLabel] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const isListening  = status === 'listening';
  const isProcessing = status === 'thinking';

  const scrollToBottom = () =>
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });

  const sendText = async (text: string, langCode = 'en') => {
    if (!text.trim()) return;
    setMessages(prev => [...prev, { role: 'user', text, lang: langCode }]);
    setStatus('thinking');
    setProcessingLabel('Thinking...');
    setInputText('');

    try {
      const { data } = await axios.post(`${API_BASE}/voice/process`, {
        text,
        language: langCode,
        userId: DEMO_USER_ID,
        sessionId: sessionIdRef.current,
        userConditions: profile?.conditions || [],
        userName: profile?.name || '',
      });

      const action = INTENT_ACTIONS[data.intent as string] ?? undefined;
      setMessages(prev => [
        ...prev,
        { role: 'assistant', text: data.responseText, audioContent: data.audioContent, lang: langCode, action },
      ]);

      if (data.audioContent) {
        const audio = new Audio(`data:audio/mp3;base64,${data.audioContent}`);
        audio.play().catch(console.error);
      }
    } catch {
      setMessages(prev => [
        ...prev,
        { role: 'assistant', text: 'Sorry, something went wrong. Please try again.' },
      ]);
    } finally {
      setStatus('idle');
      setProcessingLabel('');
      setTimeout(scrollToBottom, 100);
    }
  };

  const startListening = () => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      alert('Voice input requires Chrome or Edge. Please type your message below.');
      return;
    }

    const r = new SR();
    r.lang = recogLang.bcp;
    r.continuous = false;
    r.interimResults = false;
    r.maxAlternatives = 1;

    // Safety: force-reset if browser hangs and fires no events within 15s
    const safetyTimer = setTimeout(() => {
      console.warn('[Mic] Safety timeout — forcing idle');
      setStatus('idle');
      setProcessingLabel('');
    }, 15000);

    const cleanup = () => clearTimeout(safetyTimer);

    r.onstart = () => console.log('[Mic] recognition started, lang=', recogLang.bcp);

    r.onresult = (e: any) => {
      cleanup();
      const text: string = e.results[0][0].transcript;
      console.log('[Mic] result:', text);
      if (!text.trim()) { setStatus('idle'); return; }
      setProcessingLabel(`Heard: "${text.slice(0, 60)}"`);
      sendText(text, recogLang.code);
    };

    r.onerror = (e: any) => {
      cleanup();
      console.warn('[Mic] error:', e.error);
      setStatus('idle');
      if (e.error === 'no-speech') {
        setProcessingLabel("Didn't catch that — speak right after tapping 🎙️");
        setTimeout(() => setProcessingLabel(''), 3000);
      } else if (e.error === 'not-allowed') {
        alert('Microphone access denied. Enable permissions in browser settings.');
        setProcessingLabel('');
      } else {
        setProcessingLabel('');
      }
    };

    r.onend = () => {
      cleanup();
      console.log('[Mic] ended, current status will be reset if not already thinking');
      // Only reset to idle if sendText hasn't taken over (status = 'thinking')
      setStatus(prev => prev === 'listening' ? 'idle' : prev);
    };

    try {
      r.start();
    } catch (err) {
      console.error('[Mic] r.start() threw:', err);
      cleanup();
      return;
    }

    recognitionRef.current = r;
    setStatus('listening');
  };

  const stopListening = () => {
    // Immediately give visual feedback — if onresult fires, sendText will override to 'thinking'
    setStatus('idle');
    recognitionRef.current?.stop();
  };

  const toggleRecording = () => {
    if (status === 'listening') {
      stopListening();
    } else if (status === 'idle') {
      startListening();
    }
    // 'thinking': button disabled — no-op
  };

  const handleTextSend = () => {
    const trimmed = inputText.trim();
    if (!trimmed || isProcessing) return;
    const isEnglish = /^[a-zA-Z0-9\s.,!?'"()\-]+$/.test(trimmed);
    const lang = isEnglish ? 'en' : detectTypedLang(trimmed, recogLang.code);
    sendText(trimmed, lang);
  };

  const micIcon = () => {
    if (status === 'listening')  return '⏹️';
    if (status === 'thinking') return '⏳';
    return '🎙️';
  };

  const micLabel = () => {
    if (status === 'listening') return 'Listening… tap again to stop';
    if (status === 'thinking')  return processingLabel || 'Thinking...';
    return processingLabel || 'Tap to speak';  // shows "Didn't catch that" briefly
  };

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-64">
        {messages.map((msg, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            {msg.role === 'assistant' && (
              <div className="w-8 h-8 bg-primary rounded-full flex items-center justify-center mr-2 flex-shrink-0 mt-1">
                <span className="text-white text-xs">AI</span>
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <div className={`max-w-xs px-4 py-3 rounded-2xl text-sm leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-primary text-white rounded-tr-sm'
                  : 'bg-white text-gray-800 rounded-tl-sm shadow-sm'
              }`}>
                {msg.text}
              </div>
              {msg.action && (
                <button
                  onClick={() => onNavigate(msg.action!.tab)}
                  className="flex items-center gap-2 self-start bg-primary/10 hover:bg-primary/20 text-primary text-xs font-medium px-3 py-2 rounded-xl transition-colors"
                >
                  <span>{msg.action.icon}</span>
                  <span>{msg.action.label}</span>
                  <span className="ml-1">→</span>
                </button>
              )}
            </div>
          </motion.div>
        ))}

        <AnimatePresence>
          {isProcessing && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex justify-start items-center gap-2"
            >
              <div className="w-8 h-8 bg-primary rounded-full flex items-center justify-center flex-shrink-0">
                <span className="text-white text-xs">AI</span>
              </div>
              <div className="bg-white px-4 py-3 rounded-2xl rounded-tl-sm shadow-sm">
                {processingLabel ? (
                  <p className="text-xs text-gray-500 animate-pulse">{processingLabel}</p>
                ) : (
                  <div className="flex gap-1">
                    {[0, 1, 2].map(i => (
                      <motion.div
                        key={i}
                        className="w-2 h-2 bg-gray-400 rounded-full"
                        animate={{ y: [0, -4, 0] }}
                        transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.1 }}
                      />
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <div ref={messagesEndRef} />
      </div>

      {/* Language selector chips */}
      <div className="px-4 pb-2">
        <div className="flex gap-1.5 flex-wrap justify-center">
          {RECOG_LANGS.map(l => (
            <button
              key={l.code}
              onClick={() => setRecogLang(l)}
              disabled={isListening}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                recogLang.code === l.code
                  ? 'bg-primary text-white'
                  : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }`}
            >
              {l.label}
            </button>
          ))}
        </div>
      </div>

      {/* Mic + Input */}
      <div className="px-4 pb-4 flex flex-col items-center gap-3">
        <div className="relative">
          <motion.button
            key={status}
            onClick={toggleRecording}
            disabled={isProcessing}
            className={`w-20 h-20 rounded-full flex items-center justify-center shadow-lg transition-colors disabled:opacity-50 ${
              isListening ? 'bg-red-500' : 'bg-primary'
            }`}
            animate={isListening ? { scale: [1, 1.08, 1] } : { scale: 1 }}
            transition={
              isListening
                ? { duration: 0.7, repeat: Infinity, ease: 'easeInOut' }
                : { duration: 0.15 }
            }
            whileTap={{ scale: 0.95 }}
          >
            <span className="text-3xl">{micIcon()}</span>
          </motion.button>

          <AnimatePresence>
            {isListening && (
              <motion.div
                key="pulse-ring"
                initial={{ scale: 1, opacity: 0 }}
                exit={{ scale: 1, opacity: 0, transition: { duration: 0.2 } }}
                className="absolute inset-0 rounded-full border-4 border-red-400/40"
                animate={{ scale: [1, 1.4, 1], opacity: [0.8, 0, 0.8] }}
                transition={{ duration: 1.2, repeat: Infinity }}
              />
            )}
          </AnimatePresence>
        </div>

        <p className="text-xs text-gray-500 text-center">{micLabel()}</p>

        <div className="flex w-full gap-2">
          <input
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleTextSend()}
            placeholder="Or type in any language..."
            className="flex-1 bg-white border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-primary"
          />
          <button
            onClick={handleTextSend}
            disabled={!inputText.trim() || isProcessing}
            className="bg-primary text-white px-4 py-3 rounded-xl text-sm font-medium disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
