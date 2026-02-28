# 🚀 BHASHA AI — PRODUCTION HACKATHON PROMPT
### Paste this into a fresh Claude Pro conversation

---

## MISSION

Build **Bhasha AI** — a voice-first AI health companion for India — that is:
- ✅ Fully hosted and publicly accessible via shareable URL
- ✅ Production-quality code (not just a demo)
- ✅ All 4 features working end-to-end
- ✅ Deployable from a Windows machine
- ✅ Apple-inspired beautiful UI

**Live URLs after deployment:**
- Frontend: `https://bhasha-ai.vercel.app` (free Vercel URL)
- Backend API: `https://[id].execute-api.ap-south-1.amazonaws.com/prod`

---

## HOSTING ARCHITECTURE

```
User Browser
     ↓
Vercel (React Frontend) — FREE, instant deploy, shareable URL
     ↓
AWS API Gateway — HTTPS endpoint, auto-scaling
     ↓
AWS Lambda (Python) — 8 functions, serverless
     ↓
AWS Services: Bedrock, Polly, Transcribe, DynamoDB, S3, Connect
```

No servers to manage. No monthly hosting bills for hackathon scale.

---

## TECH STACK

**Frontend:**
- React 18 + TypeScript
- Vite (faster than Create React App)
- TailwindCSS
- Framer Motion (animations)
- Axios (API calls)
- Deployed on: **Vercel** (free tier, instant deploys)

**Backend:**
- 8 AWS Lambda functions (Python 3.12)
- AWS API Gateway (HTTPS REST API)
- All AWS services in ap-south-1 (Mumbai)

**No Docker. No servers. No complex setup.**

---

## PART 1: REACT FRONTEND

### Project Setup (Windows commands)
```cmd
# Open Command Prompt or PowerShell as Administrator

# Install Node.js first if not installed:
# Download from nodejs.org → LTS version → install

# Create project
npm create vite@latest bhasha-ai -- --template react-ts
cd bhasha-ai
npm install

# Install all dependencies
npm install axios framer-motion @tanstack/react-query zustand
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p
```

### tailwind.config.js — Replace entire file with:
```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: '#0A84FF',
        danger: '#FF3B30',
        success: '#30D158',
        warning: '#FF9F0A',
        surface: '#F2F2F7',
        card: '#FFFFFF',
      },
      borderRadius: {
        'xl': '16px',
        '2xl': '24px',
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'SF Pro Display', 'Segoe UI', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
```

### src/index.css — Replace with:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;

* { -webkit-font-smoothing: antialiased; }
body { background: #F2F2F7; font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', sans-serif; }
```

### src/config.ts
```typescript
export const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';
export const DEMO_USER_ID = 'demo-user-123';
```

### src/App.tsx — Complete app with tab navigation
```typescript
import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import VoiceTab from './tabs/VoiceTab';
import MedicationsTab from './tabs/MedicationsTab';
import AppointmentsTab from './tabs/AppointmentsTab';
import EmergencyTab from './tabs/EmergencyTab';
import TimelineTab from './tabs/TimelineTab';

const queryClient = new QueryClient();

const tabs = [
  { id: 'voice', label: 'Voice', icon: '🎙️' },
  { id: 'medications', label: 'Medicines', icon: '💊' },
  { id: 'appointments', label: 'Book', icon: '📅' },
  { id: 'emergency', label: 'Emergency', icon: '🆘' },
  { id: 'timeline', label: 'History', icon: '📋' },
];

export default function App() {
  const [activeTab, setActiveTab] = useState('voice');

  return (
    <QueryClientProvider client={queryClient}>
      <div className="min-h-screen bg-surface flex flex-col max-w-md mx-auto relative">
        {/* Header */}
        <header className="bg-white border-b border-gray-100 px-6 pt-12 pb-4 sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-primary rounded-2xl flex items-center justify-center">
              <span className="text-white text-lg">🏥</span>
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900 tracking-tight">Bhasha AI</h1>
              <p className="text-xs text-gray-500">Your health companion</p>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <span className="w-2 h-2 bg-success rounded-full animate-pulse"></span>
              <span className="text-xs text-gray-500">Live</span>
            </div>
          </div>
        </header>

        {/* Tab Content */}
        <main className="flex-1 overflow-y-auto pb-24">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              className="h-full"
            >
              {activeTab === 'voice' && <VoiceTab />}
              {activeTab === 'medications' && <MedicationsTab />}
              {activeTab === 'appointments' && <AppointmentsTab />}
              {activeTab === 'emergency' && <EmergencyTab />}
              {activeTab === 'timeline' && <TimelineTab />}
            </motion.div>
          </AnimatePresence>
        </main>

        {/* Bottom Tab Bar */}
        <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md bg-white border-t border-gray-100 px-2 py-2 z-20">
          <div className="flex justify-around">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex flex-col items-center gap-1 px-3 py-2 rounded-xl transition-all duration-200 ${
                  activeTab === tab.id
                    ? 'text-primary bg-blue-50'
                    : 'text-gray-400 hover:text-gray-600'
                }`}
              >
                <span className="text-xl">{tab.icon}</span>
                <span className="text-xs font-medium">{tab.label}</span>
              </button>
            ))}
          </div>
        </nav>
      </div>
    </QueryClientProvider>
  );
}
```

### src/tabs/VoiceTab.tsx — Complete voice interface
```typescript
import { useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';
import { API_BASE, DEMO_USER_ID } from '../config';

type Message = { role: 'user' | 'assistant'; text: string; audioUrl?: string };
type Language = { code: string; label: string; native: string };

const LANGUAGES: Language[] = [
  { code: 'en', label: 'English', native: 'English' },
  { code: 'hi', label: 'Hindi', native: 'हिंदी' },
  { code: 'te', label: 'Telugu', native: 'తెలుగు' },
  { code: 'ta', label: 'Tamil', native: 'தமிழ்' },
];

export default function VoiceTab() {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', text: 'Namaste! I am Bhasha AI, your health companion. How can I help you today?' }
  ]);
  const [isListening, setIsListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [language, setLanguage] = useState<Language>(LANGUAGES[0]);
  const [inputText, setInputText] = useState('');
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const sendText = async (text: string) => {
    if (!text.trim()) return;
    const userMsg: Message = { role: 'user', text };
    setMessages(prev => [...prev, userMsg]);
    setIsProcessing(true);
    setInputText('');

    try {
      const { data } = await axios.post(`${API_BASE}/voice/process`, {
        text,
        language: language.code,
        userId: DEMO_USER_ID,
        sessionId: `session-${Date.now()}`,
      });

      const assistantMsg: Message = {
        role: 'assistant',
        text: data.responseText,
        audioUrl: data.audioUrl,
      };
      setMessages(prev => [...prev, assistantMsg]);

      if (data.audioUrl) {
        const audio = new Audio(data.audioUrl);
        audio.play().catch(console.error);
      }
    } catch (err) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        text: 'Sorry, I had trouble processing that. Please try again.'
      }]);
    } finally {
      setIsProcessing(false);
      setTimeout(scrollToBottom, 100);
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => chunksRef.current.push(e.data);
      mediaRecorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        const formData = new FormData();
        formData.append('audio', blob, 'recording.webm');
        formData.append('language', language.code);
        formData.append('userId', DEMO_USER_ID);

        setIsProcessing(true);
        try {
          const { data } = await axios.post(`${API_BASE}/voice/transcribe`, formData);
          if (data.text) await sendText(data.text);
        } catch {
          await sendText('Hello, I need health assistance');
        } finally {
          setIsProcessing(false);
        }
        stream.getTracks().forEach(t => t.stop());
      };

      mediaRecorder.start();
      setIsListening(true);
    } catch {
      alert('Microphone access denied. Please enable microphone permissions.');
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    setIsListening(false);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Language Selector */}
      <div className="px-4 pt-4 flex gap-2 overflow-x-auto">
        {LANGUAGES.map(lang => (
          <button
            key={lang.code}
            onClick={() => setLanguage(lang)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-all ${
              language.code === lang.code
                ? 'bg-primary text-white'
                : 'bg-white text-gray-600 border border-gray-200'
            }`}
          >
            {lang.native}
          </button>
        ))}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
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
            <div className={`max-w-xs px-4 py-3 rounded-2xl text-sm leading-relaxed ${
              msg.role === 'user'
                ? 'bg-primary text-white rounded-tr-sm'
                : 'bg-white text-gray-800 rounded-tl-sm shadow-sm'
            }`}>
              {msg.text}
            </div>
          </motion.div>
        ))}

        {isProcessing && (
          <div className="flex justify-start">
            <div className="w-8 h-8 bg-primary rounded-full flex items-center justify-center mr-2 flex-shrink-0">
              <span className="text-white text-xs">AI</span>
            </div>
            <div className="bg-white px-4 py-3 rounded-2xl rounded-tl-sm shadow-sm">
              <div className="flex gap-1">
                {[0,1,2].map(i => (
                  <motion.div key={i} className="w-2 h-2 bg-gray-400 rounded-full"
                    animate={{ y: [0, -4, 0] }}
                    transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.1 }}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Mic Button */}
      <div className="px-4 pb-4 flex flex-col items-center gap-4">
        <motion.button
          onMouseDown={startRecording}
          onMouseUp={stopRecording}
          onTouchStart={startRecording}
          onTouchEnd={stopRecording}
          className={`w-20 h-20 rounded-full flex items-center justify-center shadow-lg transition-colors ${
            isListening ? 'bg-danger' : 'bg-primary'
          }`}
          animate={isListening ? { scale: [1, 1.1, 1] } : {}}
          transition={{ duration: 0.8, repeat: Infinity }}
          whileTap={{ scale: 0.95 }}
        >
          <span className="text-3xl">{isListening ? '🔴' : '🎙️'}</span>
        </motion.button>
        <p className="text-xs text-gray-500">
          {isListening ? 'Listening... Release to send' : 'Hold to speak'}
        </p>

        {/* Text input fallback */}
        <div className="flex w-full gap-2">
          <input
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && sendText(inputText)}
            placeholder="Or type here..."
            className="flex-1 bg-white border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-primary"
          />
          <button
            onClick={() => sendText(inputText)}
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
```

### src/tabs/MedicationsTab.tsx — Complete medications UI
```typescript
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';
import { API_BASE, DEMO_USER_ID } from '../config';

type Medication = {
  medicationId: string;
  name: string;
  dosage: string;
  times: string[];
  nextReminder?: string;
  takenToday?: boolean;
};

const TIME_OPTIONS = ['Morning (8 AM)', 'Afternoon (2 PM)', 'Night (9 PM)'];
const MED_COLORS = ['bg-blue-100 text-blue-700', 'bg-purple-100 text-purple-700', 'bg-green-100 text-green-700', 'bg-orange-100 text-orange-700'];

export default function MedicationsTab() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', dosage: '', times: [] as string[] });

  const { data: meds = [], isLoading } = useQuery({
    queryKey: ['medications'],
    queryFn: async () => {
      const { data } = await axios.get(`${API_BASE}/medications?userId=${DEMO_USER_ID}`);
      return data.medications as Medication[];
    },
    refetchInterval: 30000,
  });

  const addMed = useMutation({
    mutationFn: (med: typeof form) =>
      axios.post(`${API_BASE}/medications`, { ...med, userId: DEMO_USER_ID }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['medications'] });
      setShowForm(false);
      setForm({ name: '', dosage: '', times: [] });
    },
  });

  const markTaken = useMutation({
    mutationFn: (id: string) =>
      axios.put(`${API_BASE}/medications/${id}/taken`, {
        userId: DEMO_USER_ID, takenAt: new Date().toISOString()
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['medications'] }),
  });

  const toggleTime = (t: string) => {
    setForm(prev => ({
      ...prev,
      times: prev.times.includes(t) ? prev.times.filter(x => x !== t) : [...prev.times, t]
    }));
  };

  return (
    <div className="px-4 py-4 space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-bold text-gray-900">My Medicines</h2>
        <button
          onClick={() => setShowForm(true)}
          className="bg-primary text-white px-4 py-2 rounded-xl text-sm font-medium"
        >
          + Add
        </button>
      </div>

      {/* Today's reminder banner */}
      {meds.some(m => !m.takenToday) && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-warning/10 border border-warning/20 rounded-2xl p-4 flex items-center gap-3"
        >
          <span className="text-2xl">⏰</span>
          <div>
            <p className="font-semibold text-gray-900 text-sm">Reminder</p>
            <p className="text-xs text-gray-600">You have medicines to take today</p>
          </div>
        </motion.div>
      )}

      {/* Medications list */}
      {isLoading ? (
        <div className="space-y-3">
          {[1,2,3].map(i => (
            <div key={i} className="bg-white rounded-2xl p-4 animate-pulse h-24" />
          ))}
        </div>
      ) : meds.length === 0 ? (
        <div className="text-center py-16">
          <span className="text-6xl">💊</span>
          <p className="mt-4 text-gray-500">No medicines added yet</p>
          <button onClick={() => setShowForm(true)} className="mt-4 text-primary text-sm font-medium">
            Add your first medicine →
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {meds.map((med, i) => (
            <motion.div
              key={med.medicationId}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.05 }}
              className="bg-white rounded-2xl p-4 shadow-sm"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center font-bold text-lg ${MED_COLORS[i % MED_COLORS.length]}`}>
                    💊
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900">{med.name}</p>
                    <p className="text-sm text-gray-500">{med.dosage}</p>
                    <div className="flex gap-1 mt-1">
                      {med.times.map(t => (
                        <span key={t} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{t}</span>
                      ))}
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => markTaken.mutate(med.medicationId)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${
                    med.takenToday
                      ? 'bg-success/10 text-success'
                      : 'bg-primary text-white'
                  }`}
                >
                  {med.takenToday ? '✓ Taken' : 'Take Now'}
                </button>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Add medication modal */}
      <AnimatePresence>
        {showForm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 z-50 flex items-end"
            onClick={(e) => e.target === e.currentTarget && setShowForm(false)}
          >
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25 }}
              className="bg-white rounded-t-3xl w-full p-6 space-y-4"
            >
              <h3 className="text-lg font-bold text-gray-900">Add Medicine</h3>
              <input
                placeholder="Medicine name (e.g. Metformin)"
                value={form.name}
                onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-primary"
              />
              <input
                placeholder="Dosage (e.g. 500mg)"
                value={form.dosage}
                onChange={e => setForm(p => ({ ...p, dosage: e.target.value }))}
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-primary"
              />
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">When to take:</p>
                <div className="flex gap-2 flex-wrap">
                  {TIME_OPTIONS.map(t => (
                    <button
                      key={t}
                      onClick={() => toggleTime(t)}
                      className={`px-3 py-2 rounded-xl text-sm font-medium transition-all ${
                        form.times.includes(t)
                          ? 'bg-primary text-white'
                          : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
              <button
                onClick={() => addMed.mutate(form)}
                disabled={!form.name || form.times.length === 0 || addMed.isPending}
                className="w-full bg-primary text-white py-4 rounded-2xl font-semibold disabled:opacity-50"
              >
                {addMed.isPending ? 'Saving...' : 'Save Medicine'}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
```

### src/tabs/AppointmentsTab.tsx — AI booking with live status
```typescript
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';
import { API_BASE, DEMO_USER_ID } from '../config';

type BookingStatus = 'idle' | 'initiating' | 'calling' | 'in_progress' | 'confirmed' | 'failed';

const STATUS_LABELS: Record<BookingStatus, string> = {
  idle: '',
  initiating: '📞 Initiating call...',
  calling: '🔔 Calling clinic...',
  in_progress: '🗣️ AI speaking with receptionist...',
  confirmed: '✅ Appointment confirmed!',
  failed: '❌ Could not book — please call directly',
};

export default function AppointmentsTab() {
  const [form, setForm] = useState({
    doctorName: '', clinicPhone: '', preferredTime: '', patientName: 'Demo User'
  });
  const [status, setStatus] = useState<BookingStatus>('idle');
  const [callId, setCallId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<string[]>([]);
  const [appointments, setAppointments] = useState<any[]>([]);

  // Poll for call status
  useEffect(() => {
    if (!callId || status === 'confirmed' || status === 'failed') return;
    const interval = setInterval(async () => {
      try {
        const { data } = await axios.get(`${API_BASE}/appointments/status/${callId}`);
        setTranscript(data.transcript || []);
        if (data.status === 'in_progress') setStatus('in_progress');
        if (data.result === 'confirmed') { setStatus('confirmed'); clearInterval(interval); }
        if (data.result === 'failed') { setStatus('failed'); clearInterval(interval); }
      } catch (e) { console.error(e); }
    }, 2000);
    return () => clearInterval(interval);
  }, [callId, status]);

  const bookAppointment = async () => {
    setStatus('initiating');
    setTranscript([]);
    try {
      const { data } = await axios.post(`${API_BASE}/appointments/book`, {
        ...form, userId: DEMO_USER_ID
      });
      setCallId(data.callId);
      setStatus('calling');
    } catch {
      setStatus('failed');
    }
  };

  const reset = () => {
    setStatus('idle');
    setCallId(null);
    setTranscript([]);
    setForm({ doctorName: '', clinicPhone: '', preferredTime: '', patientName: 'Demo User' });
  };

  return (
    <div className="px-4 py-4 space-y-4">
      <h2 className="text-xl font-bold text-gray-900">Book Appointment</h2>
      <p className="text-sm text-gray-500">AI will call the clinic on your behalf</p>

      {status === 'idle' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-3">
          <input
            placeholder="Doctor name (e.g. Dr. Sharma)"
            value={form.doctorName}
            onChange={e => setForm(p => ({ ...p, doctorName: e.target.value }))}
            className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm bg-white outline-none focus:border-primary"
          />
          <input
            placeholder="Clinic phone (+91XXXXXXXXXX)"
            value={form.clinicPhone}
            onChange={e => setForm(p => ({ ...p, clinicPhone: e.target.value }))}
            type="tel"
            className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm bg-white outline-none focus:border-primary"
          />
          <input
            placeholder="Preferred time (e.g. Tomorrow 5pm)"
            value={form.preferredTime}
            onChange={e => setForm(p => ({ ...p, preferredTime: e.target.value }))}
            className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm bg-white outline-none focus:border-primary"
          />
          <input
            placeholder="Your name"
            value={form.patientName}
            onChange={e => setForm(p => ({ ...p, patientName: e.target.value }))}
            className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm bg-white outline-none focus:border-primary"
          />
          <motion.button
            onClick={bookAppointment}
            disabled={!form.doctorName || !form.clinicPhone}
            className="w-full bg-primary text-white py-4 rounded-2xl font-semibold text-base disabled:opacity-50 flex items-center justify-center gap-2"
            whileTap={{ scale: 0.98 }}
          >
            <span>📞</span> Book via AI Agent
          </motion.button>
        </motion.div>
      )}

      {status !== 'idle' && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-2xl p-6 shadow-sm space-y-4"
        >
          <div className="text-center">
            <motion.div
              animate={status === 'in_progress' ? { rotate: [0, 10, -10, 0] } : {}}
              transition={{ duration: 0.5, repeat: Infinity }}
              className="text-5xl mb-3"
            >
              {status === 'confirmed' ? '🎉' : status === 'failed' ? '😔' : '📞'}
            </motion.div>
            <p className={`font-semibold text-base ${
              status === 'confirmed' ? 'text-success' :
              status === 'failed' ? 'text-danger' : 'text-gray-900'
            }`}>
              {STATUS_LABELS[status]}
            </p>
            {status === 'confirmed' && (
              <p className="text-sm text-gray-500 mt-1">
                {form.doctorName} — {form.preferredTime}
              </p>
            )}
          </div>

          {/* Live transcript */}
          {transcript.length > 0 && (
            <div className="bg-gray-50 rounded-xl p-3 space-y-2 max-h-48 overflow-y-auto">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Live Call</p>
              {transcript.map((line, i) => (
                <motion.p key={i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-sm text-gray-700">
                  {line}
                </motion.p>
              ))}
              {(status === 'calling' || status === 'in_progress') && (
                <div className="flex gap-1 pt-1">
                  {[0,1,2].map(i => (
                    <motion.div key={i} className="w-1.5 h-1.5 bg-primary rounded-full"
                      animate={{ y: [0, -3, 0] }}
                      transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.15 }}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {(status === 'confirmed' || status === 'failed') && (
            <button onClick={reset} className="w-full border border-gray-200 py-3 rounded-xl text-sm font-medium text-gray-600">
              {status === 'confirmed' ? 'Book Another' : 'Try Again'}
            </button>
          )}
        </motion.div>
      )}
    </div>
  );
}
```

### src/tabs/EmergencyTab.tsx — SOS with hold-to-trigger
```typescript
import { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';
import { API_BASE, DEMO_USER_ID } from '../config';

type Contact = { name: string; phone: string; relation: string };

export default function EmergencyTab() {
  const [contacts, setContacts] = useState<Contact[]>([
    { name: 'Priya (Wife)', phone: '+919876543210', relation: 'Family' },
  ]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newContact, setNewContact] = useState({ name: '', phone: '', relation: '' });
  const [emergencyState, setEmergencyState] = useState<'idle' | 'countdown' | 'active' | 'cancelled'>('idle');
  const [countdown, setCountdown] = useState(30);
  const [emergencyId, setEmergencyId] = useState<string | null>(null);
  const [holdProgress, setHoldProgress] = useState(0);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startHold = () => {
    let progress = 0;
    holdIntervalRef.current = setInterval(() => {
      progress += 5;
      setHoldProgress(progress);
      if (progress >= 100) {
        clearInterval(holdIntervalRef.current!);
        triggerEmergency();
      }
    }, 100);
  };

  const cancelHold = () => {
    clearInterval(holdIntervalRef.current!);
    setHoldProgress(0);
  };

  const triggerEmergency = async () => {
    setEmergencyState('active');
    setCountdown(30);

    try {
      const { data } = await axios.post(`${API_BASE}/emergency/trigger`, {
        userId: DEMO_USER_ID,
        symptoms: 'Emergency SOS triggered',
        location: { lat: 28.6139, lng: 77.2090, address: 'Current Location' }
      });
      setEmergencyId(data.emergencyId);
    } catch (e) {
      console.error(e);
    }

    countdownRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) { clearInterval(countdownRef.current!); return 0; }
        return prev - 1;
      });
    }, 1000);
  };

  const cancelEmergency = async () => {
    clearInterval(countdownRef.current!);
    if (emergencyId) {
      try {
        await axios.post(`${API_BASE}/emergency/cancel`, { emergencyId, userId: DEMO_USER_ID });
      } catch (e) { console.error(e); }
    }
    setEmergencyState('cancelled');
    setTimeout(() => setEmergencyState('idle'), 2000);
  };

  return (
    <div className="px-4 py-4 space-y-4">
      <h2 className="text-xl font-bold text-gray-900">Emergency</h2>

      {/* SOS Button */}
      <div className="bg-white rounded-2xl p-6 text-center shadow-sm">
        <AnimatePresence mode="wait">
          {emergencyState === 'idle' && (
            <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <p className="text-sm text-gray-500 mb-4">Hold the button for 2 seconds to trigger emergency</p>
              <div className="relative inline-flex">
                <motion.button
                  onMouseDown={startHold}
                  onMouseUp={cancelHold}
                  onMouseLeave={cancelHold}
                  onTouchStart={startHold}
                  onTouchEnd={cancelHold}
                  className="w-32 h-32 bg-danger rounded-full flex flex-col items-center justify-center text-white shadow-xl shadow-red-200 select-none"
                  whileTap={{ scale: 0.95 }}
                >
                  <span className="text-4xl">🆘</span>
                  <span className="text-sm font-bold mt-1">SOS</span>
                </motion.button>
                {holdProgress > 0 && (
                  <svg className="absolute inset-0 w-32 h-32 -rotate-90" viewBox="0 0 128 128">
                    <circle cx="64" cy="64" r="60" fill="none" stroke="white" strokeWidth="4"
                      strokeDasharray={`${holdProgress * 3.77} 377`} strokeLinecap="round" opacity="0.6" />
                  </svg>
                )}
              </div>
            </motion.div>
          )}

          {emergencyState === 'active' && (
            <motion.div key="active" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="space-y-4">
              <motion.div className="text-6xl" animate={{ scale: [1, 1.1, 1] }} transition={{ duration: 0.5, repeat: Infinity }}>
                🚨
              </motion.div>
              <p className="font-bold text-danger text-xl">Emergency Triggered!</p>
              <p className="text-sm text-gray-600">Calling {contacts.length} contact(s)...</p>

              <div className="space-y-2">
                {contacts.map((c, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.2 }}
                    className="flex items-center justify-between bg-red-50 rounded-xl px-4 py-3"
                  >
                    <div className="text-left">
                      <p className="font-medium text-sm text-gray-900">{c.name}</p>
                      <p className="text-xs text-gray-500">{c.phone}</p>
                    </div>
                    <motion.div
                      animate={{ opacity: [1, 0.3, 1] }}
                      transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.2 }}
                      className="text-success text-sm font-medium"
                    >
                      📞 Calling
                    </motion.div>
                  </motion.div>
                ))}
              </div>

              <button
                onClick={cancelEmergency}
                className="w-full bg-gray-100 text-gray-700 py-3 rounded-xl font-medium"
              >
                Cancel ({countdown}s)
              </button>
            </motion.div>
          )}

          {emergencyState === 'cancelled' && (
            <motion.div key="cancelled" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-4">
              <span className="text-4xl">✅</span>
              <p className="mt-2 font-medium text-gray-700">Emergency cancelled</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Emergency Contacts */}
      <div className="space-y-3">
        <div className="flex justify-between items-center">
          <h3 className="font-semibold text-gray-900">Emergency Contacts</h3>
          <button onClick={() => setShowAddForm(true)} className="text-primary text-sm font-medium">+ Add</button>
        </div>

        {contacts.map((c, i) => (
          <div key={i} className="bg-white rounded-2xl p-4 flex items-center justify-between shadow-sm">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center text-lg">👤</div>
              <div>
                <p className="font-medium text-sm text-gray-900">{c.name}</p>
                <p className="text-xs text-gray-500">{c.phone} · {c.relation}</p>
              </div>
            </div>
            <button onClick={() => setContacts(contacts.filter((_, j) => j !== i))} className="text-gray-300 hover:text-danger">✕</button>
          </div>
        ))}
      </div>

      {/* Add contact modal */}
      <AnimatePresence>
        {showAddForm && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 z-50 flex items-end"
            onClick={e => e.target === e.currentTarget && setShowAddForm(false)}
          >
            <motion.div
              initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25 }}
              className="bg-white rounded-t-3xl w-full p-6 space-y-4"
            >
              <h3 className="text-lg font-bold">Add Emergency Contact</h3>
              <input placeholder="Full name" value={newContact.name}
                onChange={e => setNewContact(p => ({ ...p, name: e.target.value }))}
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-primary" />
              <input placeholder="Phone (+91XXXXXXXXXX)" value={newContact.phone} type="tel"
                onChange={e => setNewContact(p => ({ ...p, phone: e.target.value }))}
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-primary" />
              <input placeholder="Relation (Family / Neighbor / Doctor)" value={newContact.relation}
                onChange={e => setNewContact(p => ({ ...p, relation: e.target.value }))}
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-primary" />
              <button
                onClick={() => {
                  setContacts(p => [...p, newContact]);
                  setShowAddForm(false);
                  setNewContact({ name: '', phone: '', relation: '' });
                }}
                className="w-full bg-danger text-white py-4 rounded-2xl font-semibold"
              >
                Add Contact
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
```

### src/tabs/TimelineTab.tsx — Health history
```typescript
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import axios from 'axios';
import { API_BASE, DEMO_USER_ID } from '../config';

export default function TimelineTab() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ description: '', severity: 5 });

  const { data: logs = [] } = useQuery({
    queryKey: ['health-logs'],
    queryFn: async () => {
      const { data } = await axios.get(`${API_BASE}/health/logs?userId=${DEMO_USER_ID}`);
      return data.logs;
    },
  });

  const addLog = useMutation({
    mutationFn: () => axios.post(`${API_BASE}/health/logs`, {
      userId: DEMO_USER_ID, type: 'symptom', ...form
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['health-logs'] });
      setShowForm(false);
      setForm({ description: '', severity: 5 });
    },
  });

  const SEVERITY_COLOR: Record<number, string> = {
    1: 'bg-green-100 text-green-700', 2: 'bg-green-100 text-green-700',
    3: 'bg-yellow-100 text-yellow-700', 4: 'bg-yellow-100 text-yellow-700',
    5: 'bg-orange-100 text-orange-700', 6: 'bg-orange-100 text-orange-700',
    7: 'bg-red-100 text-red-700', 8: 'bg-red-100 text-red-700',
    9: 'bg-red-200 text-red-800', 10: 'bg-red-200 text-red-800',
  };

  return (
    <div className="px-4 py-4 space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-bold text-gray-900">Health Timeline</h2>
        <button onClick={() => setShowForm(!showForm)} className="bg-primary text-white px-4 py-2 rounded-xl text-sm font-medium">
          + Log
        </button>
      </div>

      {showForm && (
        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
          className="bg-white rounded-2xl p-4 space-y-3 shadow-sm">
          <textarea
            placeholder="Describe your symptom..."
            value={form.description}
            onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
            rows={3}
            className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-primary resize-none"
          />
          <div>
            <p className="text-sm text-gray-600 mb-2">Severity: {form.severity}/10</p>
            <input type="range" min={1} max={10} value={form.severity}
              onChange={e => setForm(p => ({ ...p, severity: Number(e.target.value) }))}
              className="w-full accent-primary" />
          </div>
          <button onClick={() => addLog.mutate()} disabled={!form.description}
            className="w-full bg-primary text-white py-3 rounded-xl font-medium disabled:opacity-50">
            Save Entry
          </button>
        </motion.div>
      )}

      {logs.length === 0 ? (
        <div className="text-center py-16">
          <span className="text-6xl">📋</span>
          <p className="mt-4 text-gray-500">No health entries yet</p>
        </div>
      ) : (
        <div className="space-y-3">
          {logs.map((log: any, i: number) => (
            <motion.div key={log.logId || i}
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
              className="bg-white rounded-2xl p-4 shadow-sm flex gap-3"
            >
              <div className="flex flex-col items-center">
                <div className="w-2 h-2 bg-primary rounded-full mt-2" />
                {i < logs.length - 1 && <div className="w-0.5 flex-1 bg-gray-100 mt-1" />}
              </div>
              <div className="flex-1 pb-2">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs text-gray-400">
                    {new Date(log.timestamp || Date.now()).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </span>
                  {log.severity && (
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${SEVERITY_COLOR[log.severity]}`}>
                      Severity {log.severity}
                    </span>
                  )}
                </div>
                <p className="text-sm text-gray-800">{log.description}</p>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
```

### vite.config.ts
```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: process.env.VITE_API_URL || 'http://localhost:3001',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      }
    }
  }
})
```

### .env (create this file in project root)
```
VITE_API_URL=https://YOUR_API_GATEWAY_URL/prod
```

### vercel.json (create this file in project root)
```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }],
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "Cross-Origin-Opener-Policy", "value": "same-origin-allow-popups" }
      ]
    }
  ]
}
```

---

## PART 2: LAMBDA FUNCTIONS (Python 3.12)

Write COMPLETE code for all 8 Lambda functions below. Every function must:
- Handle CORS headers (return them in every response)
- Handle errors gracefully with proper HTTP status codes
- Use environment variables for all configuration
- Return JSON responses

### CORS headers to include in EVERY Lambda response:
```python
CORS_HEADERS = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
}
```

### Lambda 1: voice-process
```python
import json, boto3, os, uuid
from datetime import datetime

CORS = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
}

def lambda_handler(event, context):
    if event.get('httpMethod') == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS, 'body': ''}

    try:
        body = json.loads(event.get('body', '{}'))
        text = body.get('text', '')
        language = body.get('language', 'en')
        user_id = body.get('userId', 'demo-user-123')
        session_id = body.get('sessionId', str(uuid.uuid4()))

        # Call Bedrock
        bedrock = boto3.client('bedrock-runtime', region_name=os.environ['AWS_REGION_NAME'])
        
        lang_map = {'hi': 'Hindi', 'te': 'Telugu', 'ta': 'Tamil', 'en': 'English'}
        lang_name = lang_map.get(language, 'English')
        
        system_prompt = f"""You are Bhasha AI, a warm and caring health companion for Indian users.
Always respond in {lang_name} language.
Help users with: medications, doctor appointments, symptoms, health questions.
You are NOT a doctor. Always suggest consulting a doctor for medical decisions.
Keep responses under 2 sentences — this will be spoken aloud.
Be warm, simple, and use everyday conversational language.
Never use medical jargon.
For emergencies (chest pain, difficulty breathing, stroke symptoms), say: "This sounds serious. Please call 112 immediately or go to the nearest hospital."
"""
        
        response = bedrock.invoke_model(
            modelId=os.environ['BEDROCK_MODEL_ID'],
            body=json.dumps({
                'anthropic_version': 'bedrock-2023-05-31',
                'max_tokens': 200,
                'system': system_prompt,
                'messages': [{'role': 'user', 'content': text}]
            })
        )
        
        response_body = json.loads(response['body'].read())
        response_text = response_body['content'][0]['text']
        
        # Detect intent
        intent = 'general'
        lower = text.lower()
        if any(w in lower for w in ['appointment', 'doctor', 'clinic', 'book']): intent = 'booking'
        elif any(w in lower for w in ['medicine', 'tablet', 'pill', 'dose', 'remind']): intent = 'medication'
        elif any(w in lower for w in ['emergency', 'help', 'pain', 'chest', 'breathing']): intent = 'emergency'
        elif any(w in lower for w in ['symptom', 'fever', 'headache', 'sick', 'feel']): intent = 'symptom'
        
        # Text to Speech via Polly
        polly = boto3.client('polly', region_name=os.environ['AWS_REGION_NAME'])
        voice_map = {'hi': 'Aditi', 'te': 'Raveena', 'ta': 'Raveena', 'en': 'Joanna'}
        
        polly_response = polly.synthesize_speech(
            Text=response_text,
            OutputFormat='mp3',
            VoiceId=voice_map.get(language, 'Joanna'),
            Engine='standard'
        )
        
        # Save to S3
        s3 = boto3.client('s3', region_name=os.environ['AWS_REGION_NAME'])
        audio_key = f"audio/{user_id}/{session_id}/{uuid.uuid4()}.mp3"
        s3.put_object(
            Bucket=os.environ['S3_BUCKET'],
            Key=audio_key,
            Body=polly_response['AudioStream'].read(),
            ContentType='audio/mpeg',
            ACL='public-read'
        )
        
        audio_url = f"https://{os.environ['S3_BUCKET']}.s3.{os.environ['AWS_REGION_NAME']}.amazonaws.com/{audio_key}"
        
        # Save conversation to DynamoDB
        dynamodb = boto3.resource('dynamodb', region_name=os.environ['AWS_REGION_NAME'])
        table = dynamodb.Table(os.environ['DYNAMODB_CONVERSATIONS_TABLE'])
        now = datetime.utcnow().isoformat()
        
        table.put_item(Item={
            'sessionId': session_id,
            'timestamp': now,
            'userId': user_id,
            'role': 'user',
            'text': text,
            'intent': intent,
        })
        table.put_item(Item={
            'sessionId': session_id,
            'timestamp': f"{now}_response",
            'userId': user_id,
            'role': 'assistant',
            'text': response_text,
            'audioUrl': audio_url,
        })
        
        return {
            'statusCode': 200,
            'headers': CORS,
            'body': json.dumps({
                'responseText': response_text,
                'audioUrl': audio_url,
                'intent': intent,
                'sessionId': session_id,
            })
        }
        
    except Exception as e:
        print(f"Error: {str(e)}")
        return {
            'statusCode': 500,
            'headers': CORS,
            'body': json.dumps({'error': str(e)})
        }
```

### Lambda 2: medication-crud
[Write complete CRUD code with DynamoDB operations for GET/POST/PUT]

### Lambda 3: book-appointment
[Write complete code using Amazon Connect StartOutboundVoiceContact]

### Lambda 4: call-status
[Write complete polling code from DynamoDB BhashaAI_CallStatus table]

### Lambda 5: connect-callback
[Write complete callback handler for Connect contact flow events]

### Lambda 6: emergency-trigger
[Write complete emergency conference call code using Connect]

### Lambda 7: emergency-cancel
[Write complete 30-second window cancellation code]

### Lambda 8: health-log
[Write complete GET/POST health log code with DynamoDB]

**IMPORTANT: Write Lambda 1 fully as shown above. Then write Lambdas 2-8 with the same level of completeness — full working Python code, not placeholders.**

---

## PART 3: AWS SETUP (Windows Step-by-Step)

### Prerequisites — Install on Windows
```powershell
# 1. Install Node.js — download from nodejs.org, run installer

# 2. Install AWS CLI
# Download from: https://awscli.amazonaws.com/AWSCLIV2.msi
# Run the installer, then open new Command Prompt

# 3. Verify installations
node --version
npm --version
aws --version

# 4. Install Git (if not installed)
# Download from: git-scm.com/download/win
```

### Step 1: AWS Account Setup
1. Go to **aws.amazon.com** → Create Account
2. Use your email, create password, account name: "Bhasha AI"
3. Select **Personal** account type
4. Add credit/debit card (Indian cards work — AWS Free Tier covers most hackathon usage)
5. Verify phone number via SMS
6. Choose **Basic Support** (free)
7. Login to AWS Console

### Step 2: Create IAM User
1. Search **"IAM"** in AWS console search bar
2. Click **Users** → **Create user**
3. Username: `bhasha-ai-dev`
4. Check **"Provide user access to AWS Management Console"** → No (we just need API access)
5. Click Next → **Attach policies directly**
6. Search and add: **AdministratorAccess**
7. Click Create user
8. Click the user → **Security credentials** tab
9. **Create access key** → **Local code** → Next → Create
10. **DOWNLOAD THE CSV FILE** — you cannot see the secret key again!

### Step 3: Configure AWS CLI
```cmd
# Open Command Prompt
aws configure

# Enter when prompted:
AWS Access Key ID: [paste from CSV]
AWS Secret Access Key: [paste from CSV]
Default region name: ap-south-1
Default output format: json

# Test it works:
aws sts get-caller-identity
# Should show your account ID
```

### Step 4: Enable Bedrock Claude
1. Go to AWS Console → Search **"Bedrock"**
2. Make sure region is **"Asia Pacific (Mumbai)"** — check top right
3. Left sidebar → **Model access**
4. Click **"Manage model access"**
5. Find **Claude 3.5 Haiku** → check it
6. Find **Claude 3 Sonnet** → check it
7. Click **"Save changes"**
8. Wait 2-5 minutes — status will change to "Access granted" ✅

### Step 5: Create DynamoDB Tables
```cmd
# Run these AWS CLI commands one by one:

aws dynamodb create-table ^
  --table-name BhashaAI_Main ^
  --attribute-definitions AttributeName=userId,AttributeType=S AttributeName=recordId,AttributeType=S ^
  --key-schema AttributeName=userId,KeyType=HASH AttributeName=recordId,KeyType=RANGE ^
  --billing-mode PAY_PER_REQUEST ^
  --region ap-south-1

aws dynamodb create-table ^
  --table-name BhashaAI_Conversations ^
  --attribute-definitions AttributeName=sessionId,AttributeType=S AttributeName=timestamp,AttributeType=S ^
  --key-schema AttributeName=sessionId,KeyType=HASH AttributeName=timestamp,KeyType=RANGE ^
  --billing-mode PAY_PER_REQUEST ^
  --region ap-south-1

aws dynamodb create-table ^
  --table-name BhashaAI_CallStatus ^
  --attribute-definitions AttributeName=callId,AttributeType=S ^
  --key-schema AttributeName=callId,KeyType=HASH ^
  --billing-mode PAY_PER_REQUEST ^
  --region ap-south-1

# Verify tables created:
aws dynamodb list-tables --region ap-south-1
```

### Step 6: Create S3 Bucket
```cmd
# Replace YOURNAME with your actual name (bucket names must be globally unique)
aws s3 mb s3://bhasha-ai-audio-YOURNAME --region ap-south-1

# Allow public read for audio files
aws s3api put-bucket-policy --bucket bhasha-ai-audio-YOURNAME --policy "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Principal\":\"*\",\"Action\":\"s3:GetObject\",\"Resource\":\"arn:aws:s3:::bhasha-ai-audio-YOURNAME/*\"}]}"

# Disable block public access
aws s3api put-public-access-block --bucket bhasha-ai-audio-YOURNAME --public-access-block-configuration "BlockPublicAcls=false,IgnorePublicAcls=false,BlockPublicPolicy=false,RestrictPublicBuckets=false"
```

### Step 7: Create Lambda Functions
For EACH Lambda function:
1. Go to AWS Console → Search **"Lambda"**
2. Click **Create function** → **Author from scratch**
3. Function name: exactly as specified (e.g. `voice-process`)
4. Runtime: **Python 3.12**
5. Architecture: x86_64
6. Click **Create function**
7. In the code editor, **delete all existing code** and paste your Lambda code
8. Click **Deploy**
9. Go to **Configuration** → **General configuration** → Edit → Set timeout to **30 seconds** → Save
10. Go to **Configuration** → **Environment variables** → Edit → Add variables:

**For voice-process:**
```
BEDROCK_MODEL_ID = anthropic.claude-3-haiku-20240307-v1:0
DYNAMODB_CONVERSATIONS_TABLE = BhashaAI_Conversations
S3_BUCKET = bhasha-ai-audio-YOURNAME
AWS_REGION_NAME = ap-south-1
```

**For medication-crud:**
```
DYNAMODB_MAIN_TABLE = BhashaAI_Main
AWS_REGION_NAME = ap-south-1
```

**For book-appointment:**
```
CONNECT_INSTANCE_ID = [get this in Step 9]
CONNECT_CONTACT_FLOW_ID = [get this in Step 9]
CONNECT_SOURCE_PHONE = [get this in Step 9]
DYNAMODB_CALL_STATUS_TABLE = BhashaAI_CallStatus
DYNAMODB_MAIN_TABLE = BhashaAI_Main
AWS_REGION_NAME = ap-south-1
```

**For emergency-trigger:**
```
CONNECT_INSTANCE_ID = [get this in Step 9]
CONNECT_EMERGENCY_FLOW_ID = [get this in Step 9]
CONNECT_SOURCE_PHONE = [get this in Step 9]
DYNAMODB_MAIN_TABLE = BhashaAI_Main
AWS_REGION_NAME = ap-south-1
```

**For all other Lambdas:**
```
DYNAMODB_MAIN_TABLE = BhashaAI_Main
AWS_REGION_NAME = ap-south-1
```

11. Go to **Configuration** → **Permissions** → click the role name (opens IAM)
12. Click **Add permissions** → **Attach policies**
13. Add ALL of these:
    - AmazonDynamoDBFullAccess
    - AmazonS3FullAccess
    - AmazonBedrockFullAccess
    - AmazonPollyFullAccess
    - AmazonTranscribeFullAccess
    - AmazonConnectFullAccess
    - AmazonSNSFullAccess
14. Click Add permissions

### Step 8: Create API Gateway
1. AWS Console → Search **"API Gateway"**
2. Click **Create API**
3. Choose **REST API** → **Build**
4. Protocol: REST, New API
5. Name: `bhasha-ai-api`
6. Endpoint Type: Regional
7. Click **Create API**

For EACH route, do this:
- Click **Actions** → **Create Resource** → Resource Name (e.g. `voice`) → Create Resource
- Click the resource → **Actions** → **Create Method** → select method (POST/GET) → checkmark
- Integration type: **Lambda Function**
- Check **Use Lambda Proxy integration**
- Lambda Function: select your function
- Click Save → OK (grant permissions)

Create ALL these routes:
```
POST  /voice/process        → voice-process Lambda
POST  /voice/transcribe     → voice-process Lambda
GET   /medications          → medication-crud Lambda
POST  /medications          → medication-crud Lambda
PUT   /medications/{id}/taken → medication-crud Lambda
POST  /appointments/book    → book-appointment Lambda
GET   /appointments/status/{callId} → call-status Lambda
POST  /emergency/trigger    → emergency-trigger Lambda
POST  /emergency/cancel     → emergency-cancel Lambda
GET   /health/logs          → health-log Lambda
POST  /health/logs          → health-log Lambda
```

Enable CORS for ALL resources:
- Click each resource → **Actions** → **Enable CORS**
- Click **"Yes, replace existing CORS headers"**
- Repeat for all resources

Deploy the API:
- Click **Actions** → **Deploy API**
- Stage: **New Stage** → Stage name: `prod`
- Click **Deploy**
- **COPY THE INVOKE URL** — it looks like: `https://abc123.execute-api.ap-south-1.amazonaws.com/prod`
- This is your `VITE_API_URL`

### Step 9: Set Up Amazon Connect
1. AWS Console → Search **"Amazon Connect"**
2. Click **Create instance**
3. Identity management: **Store users within Amazon Connect**
4. Instance alias: `bhasha-ai-[yourname]`
5. Admin: create username `admin` + password (save this!)
6. Click through Next → Next → Next → Create instance
7. **Wait 5-10 minutes** for instance to be ready
8. Click **"Log in for emergency access"** → opens Connect admin console

In Connect Admin Console:
9. Left menu → **Phone numbers** → **Claim a number**
10. Country: India, Type: DID → select any available number
11. Click **Save** → **note down this phone number**

12. Left menu → **Contact flows** → **Create contact flow**
13. Name: `AI-Booking-Flow`
14. Click the dropdown on top right → **Import flow**
15. Upload the Flow 1 JSON (from Part 4 below)
16. Click **Save** → **Publish**
17. Repeat for `Emergency-Alert-Flow` using Flow 2 JSON

Get IDs for environment variables:
- Instance ID: AWS Console → Amazon Connect → click your instance → copy the ID from the ARN
  - ARN looks like: `arn:aws:connect:ap-south-1:123456789:instance/XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX`
  - Instance ID is the last part: `XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX`
- Flow IDs: In Connect admin → Contact flows → click flow → Show additional information → copy ID

Now go back and update Lambda environment variables for book-appointment and emergency-trigger with these values.

### Step 10: Deploy Frontend to Vercel

```cmd
# In your project folder
cd bhasha-ai

# Update .env with your API Gateway URL
# Edit .env file: VITE_API_URL=https://YOUR_URL.execute-api.ap-south-1.amazonaws.com/prod

# Install Vercel CLI
npm install -g vercel

# Deploy
vercel

# Follow prompts:
# - Login/signup with GitHub (free)
# - Set up project: yes
# - Which directory: ./ (current)
# - Override settings: no

# After deploy you'll get URL like:
# https://bhasha-ai-xyz.vercel.app  ← SHARE THIS LINK!

# For future updates, just run:
vercel --prod
```

### Step 11: Test Everything

Open your Vercel URL and test:
- [ ] Voice tab → type "I have a headache" → AI responds in text and audio
- [ ] Medications → Add "Aspirin 100mg" Morning → appears in list → Mark as Taken
- [ ] Book Appointment → fill doctor name + phone → click Book → see calling status
- [ ] Emergency → Add your own phone as contact → Hold SOS → verify you receive call
- [ ] Timeline → Log "headache since morning severity 7" → appears in history

---

## PART 4: AMAZON CONNECT FLOW JSONs

### Flow 1: AI-Booking-Flow
Write the complete Amazon Connect Contact Flow JSON that:
- Plays greeting using contact attribute $.Attributes.doctorName and $.Attributes.preferredTime
- Uses Get Customer Input block to collect receptionist speech
- Calls Lambda (connect-callback) with the transcript
- Plays confirmation or failure message
- Hangs up

### Flow 2: Emergency-Alert-Flow
Write the complete Amazon Connect Contact Flow JSON that:
- Plays urgent emergency message using $.Attributes.patientName and $.Attributes.address
- Plays symptoms from $.Attributes.symptoms
- Asks for response (Press 1 if on the way)
- Calls Lambda (connect-callback) with response
- Thanks and disconnects

---

## FINAL REMINDERS

1. **Build the full React app first** — get it running locally on http://localhost:3000
2. **Then set up AWS** — follow Step-by-Step guide
3. **Update VITE_API_URL** in .env after creating API Gateway
4. **Deploy to Vercel** — share the link!
5. **Budget ~$5-10** for Amazon Connect calls during demo
6. **If Connect setup fails** — the voice + medication + timeline features still work perfectly without it. Mock the calling UI.

**Your shareable demo URL will be:** `https://bhasha-ai.vercel.app`

---

*Now build it completely. Start with the React app, then Lambdas, then guide me through AWS setup.*