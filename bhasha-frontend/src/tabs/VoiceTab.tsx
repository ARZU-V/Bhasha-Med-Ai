import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';
import { API_BASE, BEDROCK_AGENT_URL, DEMO_USER_ID } from '../config';
import { loadProfile } from '../components/ProfileModal';

type BookingData = { doctorName?: string; preferredTime?: string; patientPhone?: string; condition?: string; [key: string]: any };
type Action = { label: string; icon: string; tab: string; bookingData?: BookingData };

type DeepStructured = {
  summary: string;
  possible_conditions: Array<{ name: string; likelihood: string; brief: string }>;
  urgency: 'emergency' | 'urgent' | 'routine';
  urgency_reason: string;
  doctor_roadmap: { see_first: string; timeframe: string; if_referred?: string };
  action_steps: string[];
  tests_to_ask: string[];
  red_flags: string[];
  self_care: string[];
  questions_for_doctor: string[];
};

type Message = {
  role: 'user' | 'assistant';
  text: string;
  audioContent?: string;
  lang?: string;
  action?: Action;
  // deep mode fields
  structured?: DeepStructured;
  symptoms_detected?: string[];
  sources?: string[];
  imageAnalysis?: string;
  isDeep?: boolean;
};

type Status = 'idle' | 'listening' | 'thinking';

const INTENT_ACTIONS: Record<string, Omit<Action, 'bookingData'>> = {
  booking:     { label: 'Book an Appointment',      icon: '📅', tab: 'appointments' },
  emergency:   { label: 'Go to Emergency SOS',      icon: '🆘', tab: 'emergency' },
  medication:  { label: 'Manage My Meds',           icon: '💊', tab: 'medications' },
  symptom:     { label: 'Find Nearby Hospital',     icon: '🏥', tab: 'hospitals' },
  find_nearby: { label: 'Search Nearby Clinics',    icon: '🔍', tab: 'hospitals' },
};

const RECOG_LANGS = [
  { code: 'hi', bcp: 'hi-IN', label: 'हिंदी' },
  { code: 'en', bcp: 'en-IN', label: 'English' },
  { code: 'bn', bcp: 'bn-IN', label: 'বাংলা' },
  { code: 'te', bcp: 'te-IN', label: 'తెలుగు' },
  { code: 'ta', bcp: 'ta-IN', label: 'தமிழ்' },
  { code: 'mr', bcp: 'mr-IN', label: 'मराठी' },
  { code: 'gu', bcp: 'gu-IN', label: 'ગુજરાતી' },
  { code: 'kn', bcp: 'kn-IN', label: 'ಕನ್ನಡ' },
  { code: 'ml', bcp: 'ml-IN', label: 'മലയാളം' },
  { code: 'pa', bcp: 'pa-IN', label: 'ਪੰਜਾਬੀ' },
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

// ── Deep Response Card ────────────────────────────────────────────────────────
function DeepResponseCard({ msg, onSendSMS, onSaveHistory, onFindSpecialist }: {
  msg: Message;
  onSendSMS: (structured: DeepStructured, symptoms: string[]) => void;
  onSaveHistory: (structured: DeepStructured, symptoms: string[]) => void;
  onFindSpecialist: (condition: string) => void;
}) {
  const s = msg.structured!;
  const urgencyColor =
    s.urgency === 'emergency' ? 'text-red-600 bg-red-50 border-red-200' :
    s.urgency === 'urgent'    ? 'text-orange-600 bg-orange-50 border-orange-200' :
                                'text-green-600 bg-green-50 border-green-200';
  const urgencyIcon =
    s.urgency === 'emergency' ? '🚨' :
    s.urgency === 'urgent'    ? '⚠️' : '✅';

  const likelihoodColor = (l: string) =>
    l === 'high' ? 'bg-red-100 text-red-700' :
    l === 'moderate' ? 'bg-orange-100 text-orange-700' :
    'bg-surface-2 text-ink-3';

  return (
    <div className="space-y-2.5 max-w-xs">

      {/* Urgency banner */}
      <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-semibold ${urgencyColor}`}>
        <span>{urgencyIcon}</span>
        <span>{s.urgency.toUpperCase()} — {s.urgency_reason || s.summary}</span>
      </div>

      {/* Detected symptoms */}
      {(msg.symptoms_detected?.length ?? 0) > 0 && (
        <div>
          <p className="text-2xs text-ink-3 font-medium mb-1">DETECTED BY AI</p>
          <div className="flex flex-wrap gap-1">
            {msg.symptoms_detected!.map((sym, i) => (
              <span key={i} className="px-2 py-0.5 bg-primary/10 text-primary rounded-full text-xs">
                {sym}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Possible conditions */}
      {s.possible_conditions.length > 0 && (
        <div>
          <p className="text-2xs text-ink-3 font-medium mb-1">POSSIBLE CONDITIONS</p>
          <div className="space-y-1">
            {s.possible_conditions.map((c, i) => (
              <div key={i} className="flex items-start gap-2 bg-surface-2 rounded-lg px-2.5 py-2">
                <span className={`text-2xs px-1.5 py-0.5 rounded font-medium flex-shrink-0 ${likelihoodColor(c.likelihood)}`}>
                  {c.likelihood}
                </span>
                <div>
                  <p className="text-xs font-medium text-ink">{c.name}</p>
                  <p className="text-2xs text-ink-3 leading-relaxed">{c.brief}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Doctor roadmap */}
      <div className="bg-primary/5 border border-primary/20 rounded-xl p-3">
        <p className="text-2xs text-primary font-semibold mb-1">RECOMMENDED ACTION</p>
        <p className="text-xs font-bold text-ink">See: {s.doctor_roadmap.see_first}</p>
        <p className="text-xs text-ink-2">{s.doctor_roadmap.timeframe}</p>
        {s.doctor_roadmap.if_referred && (
          <p className="text-2xs text-ink-3 mt-0.5">
            May refer to: {s.doctor_roadmap.if_referred}
          </p>
        )}
      </div>

      {/* Action steps */}
      {s.action_steps.length > 0 && (
        <div>
          <p className="text-2xs text-ink-3 font-medium mb-1.5">WHAT TO DO</p>
          <div className="space-y-1.5">
            {s.action_steps.map((step, i) => (
              <div key={i} className="flex gap-2 items-start">
                <span className="w-5 h-5 bg-primary text-white rounded-full flex items-center justify-center text-2xs font-bold flex-shrink-0 mt-0.5">
                  {i + 1}
                </span>
                <p className="text-xs text-ink leading-relaxed">{step.replace(/^Step \d+:\s*/i, '')}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tests to ask */}
      {s.tests_to_ask.length > 0 && (
        <div className="bg-surface-2 rounded-xl p-2.5">
          <p className="text-2xs text-ink-3 font-medium mb-1">ASK DOCTOR FOR THESE TESTS</p>
          <div className="flex flex-wrap gap-1">
            {s.tests_to_ask.map((t, i) => (
              <span key={i} className="text-xs bg-surface border border-line rounded-lg px-2 py-0.5">{t}</span>
            ))}
          </div>
        </div>
      )}

      {/* Red flags */}
      {s.red_flags.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-2.5">
          <p className="text-2xs text-red-600 font-semibold mb-1">⚠️ CALL 112 IF YOU NOTICE</p>
          {s.red_flags.map((f, i) => (
            <p key={i} className="text-xs text-red-700 leading-relaxed">• {f}</p>
          ))}
        </div>
      )}

      {/* Sources */}
      {(msg.sources?.length ?? 0) > 0 && (
        <p className="text-2xs text-ink-3">
          Sources: {msg.sources!.slice(0, 3).join(' • ')}
        </p>
      )}

      {/* Image analysis */}
      {msg.imageAnalysis && (
        <div className="bg-surface border border-line rounded-xl p-3">
          <p className="text-2xs text-ink-3 font-medium mb-1">IMAGE ANALYSIS</p>
          <p className="text-xs text-ink leading-relaxed">{msg.imageAnalysis}</p>
        </div>
      )}

      {/* Action row */}
      <div className="flex gap-2">
        <button
          onClick={() => onSendSMS(s, msg.symptoms_detected || [])}
          className="flex-1 flex items-center justify-center gap-1 text-xs text-ink-2 border border-line bg-surface rounded-xl py-2"
        >
          <span>📱</span> SMS
        </button>
        <button
          onClick={() => onSaveHistory(s, msg.symptoms_detected || [])}
          className="flex-1 flex items-center justify-center gap-1 text-xs text-primary border border-primary/20 bg-primary/5 rounded-xl py-2"
        >
          <span>🗂️</span> Save History
        </button>
        {s.possible_conditions.length > 0 && (
          <button
            onClick={() => onFindSpecialist(s.doctor_roadmap.see_first || s.possible_conditions[0].name)}
            className="flex-1 flex items-center justify-center gap-1 text-xs text-ink-2 border border-line bg-surface rounded-xl py-2"
          >
            <span>🏥</span> Specialist
          </button>
        )}
      </div>
    </div>
  );
}

export default function VoiceTab({ onNavigate }: { onNavigate: (tab: string, data?: BookingData) => void }) {
  const profile = loadProfile();
  // Persist session per day so DynamoDB history carries through the day
  const sessionIdRef = useRef<string>((() => {
    const today = new Date().toISOString().split('T')[0];
    try {
      const stored = localStorage.getItem('bhasha_session');
      if (stored) { const { id, date } = JSON.parse(stored); if (date === today) return id; }
    } catch { /* ignore */ }
    const id = `session-${Date.now()}`;
    localStorage.setItem('bhasha_session', JSON.stringify({ id, date: today }));
    return id;
  })());
  const recognitionRef = useRef<any>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Restore selected language from sessionStorage, fallback to profile language
  const defaultLang = (() => {
    try {
      const stored = sessionStorage.getItem('bhasha_recog_lang');
      if (stored) return RECOG_LANGS.find(l => l.code === stored) ?? null;
    } catch { /* ignore */ }
    return null;
  })() ?? RECOG_LANGS.find(l => l.code === profile?.language) ?? RECOG_LANGS[0];

  const [recogLang, setRecogLang] = useState(defaultLang);

  // Restore messages from sessionStorage (chat persists across tab switches)
  const [messages, setMessages] = useState<Message[]>(() => {
    try {
      const stored = sessionStorage.getItem('bhasha_chat_messages');
      if (stored) {
        const parsed: Message[] = JSON.parse(stored);
        // Strip audio — can't replay old audio, keeps storage small
        return parsed.map(m => ({ ...m, audioContent: undefined }));
      }
    } catch { /* ignore */ }
    return [{
      role: 'assistant' as const,
      text: profile?.name
        ? `Namaste ${profile.name}! I am Bhasha AI. Tap the mic and speak — I will understand you.`
        : 'Namaste! I am Bhasha AI. Tap the mic and speak in any Indian language.',
    }];
  });

  // Persist messages whenever they change
  useEffect(() => {
    const toStore = messages.map(m => ({ ...m, audioContent: undefined }));
    try { sessionStorage.setItem('bhasha_chat_messages', JSON.stringify(toStore)); } catch { /* ignore */ }
  }, [messages]);

  // Persist selected language
  useEffect(() => {
    try { sessionStorage.setItem('bhasha_recog_lang', recogLang.code); } catch { /* ignore */ }
  }, [recogLang]);

  const [mode,            setMode]            = useState<'quick' | 'deep'>('quick');
  const [status,          setStatus]         = useState<Status>('idle');
  const [inputText,       setInputText]       = useState('');
  const [processingLabel, setProcessingLabel] = useState('');

  const isListening  = status === 'listening';
  const isProcessing = status === 'thinking';

  const sendText = async (text: string, langCode = 'en') => {
    if (!text.trim()) return;

    setMessages(prev => [...prev, { role: 'user', text, lang: langCode }]);
    setStatus('thinking');

    try {
      const { data } = await axios.post(`${API_BASE}/voice/process`, {
        text,
        language: langCode,
        sessionId: sessionIdRef.current,
        userId: profile?.name ? `user-${profile.name}` : DEMO_USER_ID,
        // Send full profile so AI personalises responses
        userProfile: {
          name: profile?.name || '',
          age: profile?.age || '',
          phone: profile?.phone || '',
          conditions: profile?.conditions || [],
          history: profile?.history || '',
        },
      });

      const action = data.intent && data.intent !== 'general' ? INTENT_ACTIONS[data.intent] : undefined;
      setMessages(prev => [
        ...prev,
        { role: 'assistant', text: data.responseText, audioContent: data.audioContent, action },
      ]);

      // Save last chat preview for Dashboard
      try {
        localStorage.setItem('bhasha_last_chat', JSON.stringify({
          userQuestion: text.substring(0, 80),
          preview:      data.responseText?.substring(0, 150) || '',
          timestamp:    new Date().toISOString(),
        }));
      } catch {}

      if (data.audioContent) {
        new Audio(`data:audio/mp3;base64,${data.audioContent}`).play();
      }

      // Auto-navigate + auto-fill based on AI intent
      if (data.intent === 'emergency') {
        setTimeout(() => onNavigate('emergency'), 1500);

      } else if (data.intent === 'find_nearby') {
        setTimeout(() => onNavigate('hospitals'), 2000);

      } else if (data.intent === 'booking') {
        const prefill = {
          doctorName:    data.bookingData?.doctorName || data.specialty || '',
          clinicPhone:   data.bookingData?.clinicPhone || '',
          preferredTime: data.bookingData?.preferredTime || '',
          patientPhone:  data.bookingData?.patientPhone || profile?.phone || '',
        };
        setTimeout(() => onNavigate('appointments', prefill), 2000);

      } else if (data.intent === 'medication' && data.medData?.name) {
        // Auto-save medication reminder to localStorage
        const existing = JSON.parse(localStorage.getItem('bhasha_meds') || '[]');
        const alreadyExists = existing.some((m: any) =>
          m.name.toLowerCase() === data.medData.name.toLowerCase()
        );
        if (!alreadyExists) {
          const newMed = {
            medicationId: `voice-${Date.now()}`,
            name: data.medData.name,
            dosage: '1 tablet',
            times: [data.medData.time],
          };
          localStorage.setItem('bhasha_meds', JSON.stringify([...existing, newMed]));
        }
        setTimeout(() => onNavigate('medications'), 2000);
      }

    } catch (err: any) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        text: 'Sorry, something went wrong. Please check your connection and try again.',
      }]);
    } finally {
      setStatus('idle');
    }
  };

  const startListening = () => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { alert('Voice input requires Chrome or Edge. Please type your message below.'); return; }

    const r = new SR();
    r.lang = recogLang.bcp;
    r.continuous = false;
    r.interimResults = false;
    r.maxAlternatives = 1;

    const safetyTimer = setTimeout(() => { setStatus('idle'); setProcessingLabel(''); }, 15000);
    const cleanup = () => clearTimeout(safetyTimer);

    r.onresult = (e: any) => {
      cleanup();
      const text: string = e.results[0][0].transcript;
      if (!text.trim()) { setStatus('idle'); return; }
      setProcessingLabel(`Heard: "${text.slice(0, 60)}"`);
      if (mode === 'deep') sendDeepText(text, recogLang.code);
      else sendText(text, recogLang.code);
    };

    r.onerror = (e: any) => {
      cleanup();
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
      setStatus(prev => prev === 'listening' ? 'idle' : prev);
    };

    try { r.start(); } catch (err) { cleanup(); return; }
    recognitionRef.current = r;
    setStatus('listening');
  };

  const stopListening = () => {
    setStatus('idle');
    recognitionRef.current?.stop();
  };

  const toggleRecording = () => {
    if (status === 'listening') stopListening();
    else if (status === 'idle') startListening();
    // 'thinking': button is disabled — no-op
  };

  const sendDeepText = async (text: string, langCode = 'en') => {
    if (!text.trim()) return;
    setMessages(prev => [...prev, { role: 'user', text, lang: langCode }]);
    setStatus('thinking');
    setProcessingLabel('Analysing with AI + Medical KB…');
    try {
      const { data } = await axios.post(BEDROCK_AGENT_URL, {
        symptoms: text,
        language: langCode,
        userConditions: profile?.conditions || [],
        userId: profile?.name ? `user-${profile.name}` : DEMO_USER_ID,
        phone: profile?.phone || '',
        lat: 28.6139,
        lng: 77.2090,
      });

      // Map Lambda agent response → DeepStructured
      const dx = data.agents?.diagnosis || {};
      const ranking = data.agents?.ranker || {};
      const visitPrep = ranking.visit_prep || {};
      const urgency: 'emergency' | 'urgent' | 'routine' =
        dx.urgency === 'emergency' ? 'emergency' :
        dx.urgency === 'urgent' ? 'urgent' : 'routine';
      const timeframe =
        urgency === 'emergency' ? 'Go to emergency NOW' :
        urgency === 'urgent'    ? 'Within 24 hours' : 'Within the next few days';

      const structured: DeepStructured = {
        summary: data.orchestrator_summary || dx.condition || 'Analysis complete',
        possible_conditions: dx.condition ? [{
          name: dx.condition,
          likelihood: dx.severity === 'severe' ? 'high' : dx.severity === 'moderate' ? 'moderate' : 'low',
          brief: dx.deep_analysis || '',
        }] : [],
        urgency,
        urgency_reason: dx.urgency_reason || '',
        doctor_roadmap: {
          see_first: dx.specialty_needed || 'General Physician',
          timeframe,
          if_referred: ranking.recommended_hospital?.name,
        },
        action_steps: dx.action_steps || [],
        tests_to_ask: visitPrep.what_to_bring || [],
        red_flags: dx.red_flags || [],
        self_care: [],
        questions_for_doctor: visitPrep.questions_to_ask || [],
      };

      setMessages(prev => [...prev, {
        role: 'assistant',
        text: structured.summary,
        isDeep: true,
        structured,
        symptoms_detected: [],
        sources: [],
      }]);

      if (urgency === 'emergency') {
        setTimeout(() => onNavigate('emergency'), 1500);
      }
    } catch {
      setMessages(prev => [...prev, {
        role: 'assistant',
        text: 'Deep analysis unavailable. Please check your connection.',
      }]);
    } finally {
      setStatus('idle');
      setProcessingLabel('');
    }
  };

  const handleSendSMS = async (structured: DeepStructured, symptoms: string[]) => {
    if (!profile?.phone) {
      alert('Add your phone number in the profile (👤) to receive SMS summaries.');
      return;
    }
    try {
      await axios.post(`${API_BASE}/deep-analysis`, {
        question: structured.summary,
        language: recogLang.code,
        userConditions: profile?.conditions || [],
        userId: profile?.name ? `user-${profile.name}` : DEMO_USER_ID,
        phone: profile.phone,
      });
      alert('SMS sent to ' + profile.phone);
    } catch {
      alert('SMS sending failed. Check SNS sandbox permissions.');
    }
  };

  const handleSaveHistory = (structured: DeepStructured, symptoms: string[]) => {
    const condition = symptoms.length > 0
      ? symptoms.join(', ')
      : structured.possible_conditions[0]?.name || structured.summary.slice(0, 60);
    onNavigate('history', {
      condition,
      year: new Date().getFullYear().toString(),
      notes: structured.action_steps.slice(0, 2).join('. '),
    });
  };

  const handleFindSpecialist = (condition: string) => {
    onNavigate('hospitals', { condition });
  };

  const handleTextSend = () => {
    const trimmed = inputText.trim();
    if (!trimmed || isProcessing) return;
    const lang = detectTypedLang(trimmed, recogLang.code);
    setInputText('');
    if (mode === 'deep') sendDeepText(trimmed, lang);
    else sendText(trimmed, lang);
  };

  const clearChat = () => {
    const welcome: Message = {
      role: 'assistant',
      text: profile?.name
        ? `Namaste ${profile.name}! I am Bhasha AI. Tap the mic and speak — I will understand you.`
        : 'Namaste! I am Bhasha AI. Tap the mic and speak in any Indian language.',
    };
    setMessages([welcome]);
    // New session so DynamoDB history doesn't bleed in
    const id = `session-${Date.now()}`;
    const today = new Date().toISOString().split('T')[0];
    localStorage.setItem('bhasha_session', JSON.stringify({ id, date: today }));
    sessionIdRef.current = id;
    try { sessionStorage.removeItem('bhasha_chat_messages'); } catch { /* ignore */ }
  };

  const micIcon = () => {
    if (status === 'listening') return '⏹️';
    if (status === 'thinking')  return '⏳';
    return '🎙️';
  };

  const micLabel = () => {
    if (status === 'listening') return 'Listening… tap again to stop';
    if (status === 'thinking')  return processingLabel || 'Thinking...';
    return processingLabel || 'Tap to speak';
  };

  return (
    <div className="flex flex-col h-full">

      {/* ── Top bar ── */}
      <div className="flex items-center justify-between px-4 pt-2 pb-0 gap-2">
        {/* Mode toggle */}
        <div className="flex gap-0.5 p-0.5 bg-surface-2 rounded-lg border border-line">
          {(['quick', 'deep'] as const).map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                mode === m ? 'bg-surface shadow text-ink' : 'text-ink-3'
              }`}
            >
              {m === 'quick' ? '⚡ Quick' : '🔬 Deep'}
            </button>
          ))}
        </div>
        <button
          onClick={clearChat}
          className="text-xs text-ink-3 border border-line rounded-lg px-2.5 py-1 hover:text-ink hover:border-ink-3 transition-colors"
        >
          + New Chat
        </button>
      </div>

      {/* ── Messages ── */}
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
                <span className="text-white text-xs font-bold">AI</span>
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              {msg.isDeep && msg.structured ? (
                <DeepResponseCard msg={msg} onSendSMS={handleSendSMS} onSaveHistory={handleSaveHistory} onFindSpecialist={handleFindSpecialist} />
              ) : (
                <div className={`max-w-xs px-4 py-3 rounded-2xl text-sm leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-primary text-white rounded-tr-sm'
                    : 'bg-surface text-ink rounded-tl-sm border border-line'
                }`}>
                  {msg.text}
                </div>
              )}
              {msg.action && (
                <button
                  onClick={() => onNavigate(msg.action!.tab, msg.action!.bookingData)}
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
                <span className="text-white text-xs font-bold">AI</span>
              </div>
              <div className="bg-surface border border-line px-4 py-3 rounded-2xl rounded-tl-sm">
                {processingLabel ? (
                  <p className="text-xs text-ink-3 animate-pulse">{processingLabel}</p>
                ) : (
                  <div className="flex gap-1">
                    {[0, 1, 2].map(i => (
                      <motion.div
                        key={i}
                        className="w-2 h-2 bg-ink-3 rounded-full"
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

      {/* ── Language chips ── */}
      <div className="px-4 pt-2 pb-2 border-t border-line">
        <div className="flex gap-1.5 flex-wrap justify-center">
          {RECOG_LANGS.map(l => (
            <button
              key={l.code}
              onClick={() => setRecogLang(l)}
              disabled={isListening}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors border ${
                recogLang.code === l.code
                  ? 'bg-primary text-white border-primary'
                  : 'bg-surface-2 text-ink-3 border-line hover:border-ink-3'
              }`}
            >
              {l.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Mic + Input ── */}
      <div className="px-4 pb-4 flex flex-col items-center gap-3">
        <div className="relative">
          <motion.button
            key={status}
            onClick={toggleRecording}
            disabled={isProcessing}
            className={`w-20 h-20 rounded-full flex items-center justify-center shadow-lg transition-colors disabled:opacity-50 ${
              isListening ? 'bg-danger' : 'bg-primary'
            }`}
            animate={isListening ? { scale: [1, 1.08, 1] } : { scale: 1 }}
            transition={isListening ? { duration: 0.7, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.15 }}
            whileTap={{ scale: 0.95 }}
          >
            <span className="text-3xl">{micIcon()}</span>
          </motion.button>

          <AnimatePresence>
            {isListening && (
              <motion.div
                key="pulse-ring"
                initial={{ scale: 1, opacity: 0 }}
                animate={{ scale: [1, 1.4, 1], opacity: [0.8, 0, 0.8] }}
                exit={{ scale: 1, opacity: 0, transition: { duration: 0.2 } }}
                transition={{ duration: 1.2, repeat: Infinity }}
                className="absolute inset-0 rounded-full border-4 border-danger/40 pointer-events-none"
              />
            )}
          </AnimatePresence>
        </div>

        <p className="text-xs text-ink-3 text-center min-h-[16px]">{micLabel()}</p>

        <div className="flex w-full gap-2">
          <input
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleTextSend()}
            placeholder="Or type in any language..."
            className="flex-1 bg-surface-2 border border-line rounded-xl px-4 py-3 text-sm text-ink placeholder:text-ink-3 outline-none focus:border-primary transition-all"
          />
          <button
            onClick={handleTextSend}
            disabled={!inputText.trim() || isProcessing}
            className="bg-primary text-white px-4 py-3 rounded-xl text-sm font-medium disabled:opacity-50 active:scale-[0.98] transition-all"
          >
            Send
          </button>
        </div>
      </div>

    </div>
  );
}