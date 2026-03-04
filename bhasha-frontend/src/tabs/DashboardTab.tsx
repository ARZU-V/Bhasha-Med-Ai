import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { loadProfile } from '../components/ProfileModal';

type LastChat = { userQuestion: string; preview: string; timestamp: string };

const FEATURES = [
  { id: 'voice',        icon: '🎙️', title: 'AI Chat',         desc: 'Any Indian language',       bg: 'bg-primary/8',        border: 'border-primary/20',        text: 'text-primary'    },
  { id: 'hospitals',    icon: '🏥', title: 'Find Hospitals',   desc: 'Nearby & specialists',      bg: 'bg-success/8',        border: 'border-success/20',        text: 'text-success'    },
  { id: 'history',      icon: '🗂️', title: 'Health History',  desc: 'Your medical timeline',     bg: 'bg-amber-500/8',      border: 'border-amber-500/20',      text: 'text-amber-600'  },
  { id: 'appointments', icon: '📅', title: 'Book Appt',        desc: 'Schedule doctors',          bg: 'bg-violet-500/8',     border: 'border-violet-500/20',     text: 'text-violet-600' },
  { id: 'diet',         icon: '🥗', title: 'Diet Chart',       desc: 'Eat right for health',      bg: 'bg-lime-500/8',       border: 'border-lime-500/20',       text: 'text-lime-600'   },
  { id: 'navigator',    icon: '🤝', title: 'Hospital Guide',   desc: 'Human escort service',      bg: 'bg-sky-500/8',        border: 'border-sky-500/20',        text: 'text-sky-600'    },
];

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m    = Math.floor(diff / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function DashboardTab({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const profile  = loadProfile();
  const [lastChat, setLastChat] = useState<LastChat | null>(null);

  useEffect(() => {
    try {
      const s = localStorage.getItem('bhasha_last_chat');
      if (s) setLastChat(JSON.parse(s));
    } catch {}
  }, []);

  const firstName = profile?.name?.split(' ')[0] || '';

  return (
    <div className="flex flex-col overflow-y-auto pb-28">

      {/* ── Greeting ──────────────────────────────────────────────────────── */}
      <div className="px-5 pt-5 pb-3">
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
          <p className="text-sm text-ink-3">{greeting()}{firstName ? `, ${firstName}` : ''} 👋</p>
          <h1 className="text-xl font-bold text-ink mt-0.5 leading-tight">How can I help you today?</h1>
        </motion.div>
      </div>

      {/* ── Last chat card OR big voice CTA ─────────────────────────────── */}
      <div className="px-4 mb-4">
        {lastChat ? (
          <motion.button
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}
            onClick={() => onNavigate('voice')}
            className="w-full bg-primary/8 border border-primary/20 rounded-2xl p-4 text-left active:scale-[0.98] transition-all"
          >
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 bg-primary/15 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-base">🎙️</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-xs font-semibold text-primary">Last conversation</span>
                  <span className="text-2xs text-ink-3">{timeAgo(lastChat.timestamp)}</span>
                </div>
                <p className="text-xs text-ink-3 truncate mb-0.5">You: "{lastChat.userQuestion}"</p>
                <p className="text-xs text-ink-2 line-clamp-2 leading-relaxed">{lastChat.preview}</p>
              </div>
              <span className="text-primary text-sm flex-shrink-0 mt-1">→</span>
            </div>
          </motion.button>
        ) : (
          <motion.button
            initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.08 }}
            onClick={() => onNavigate('voice')}
            className="w-full bg-primary rounded-2xl p-5 text-left active:scale-[0.98] transition-all"
          >
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center text-2xl flex-shrink-0">
                🎙️
              </div>
              <div>
                <p className="text-white font-bold text-base">Start AI Health Chat</p>
                <p className="text-white/70 text-xs mt-0.5">Speak in Hindi, English, or any Indian language</p>
              </div>
            </div>
          </motion.button>
        )}
      </div>

      {/* ── Feature grid ─────────────────────────────────────────────────── */}
      <div className="px-4 mb-5">
        <p className="text-2xs font-semibold text-ink-3 uppercase tracking-wider mb-3">All Features</p>
        <div className="grid grid-cols-3 gap-2.5">
          {FEATURES.map((f, i) => (
            <motion.button
              key={f.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 + i * 0.05 }}
              onClick={() => onNavigate(f.id)}
              className={`${f.bg} border ${f.border} rounded-2xl p-3.5 text-center active:scale-95 transition-all`}
            >
              <div className="text-2xl mb-1.5">{f.icon}</div>
              <p className={`text-[11px] font-semibold leading-tight ${f.text}`}>{f.title}</p>
              <p className="text-[9px] text-ink-3 mt-0.5 leading-tight">{f.desc}</p>
            </motion.button>
          ))}
        </div>
      </div>

      {/* ── SOS strip ────────────────────────────────────────────────────── */}
      <div className="px-4 mb-5">
        <motion.button
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.45 }}
          onClick={() => onNavigate('emergency')}
          className="w-full bg-danger/8 border border-danger/25 rounded-2xl px-4 py-3.5 flex items-center gap-3 active:scale-[0.98] transition-all"
        >
          <div className="w-9 h-9 bg-danger/15 rounded-xl flex items-center justify-center flex-shrink-0">
            <span className="text-lg">🆘</span>
          </div>
          <div className="text-left flex-1">
            <p className="text-sm font-bold text-danger">Emergency SOS</p>
            <p className="text-xs text-danger/60">Alert contacts · Call ambulance</p>
          </div>
          <span className="text-danger">→</span>
        </motion.button>
      </div>

      {/* ── About ────────────────────────────────────────────────────────── */}
      <div className="px-4">
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}
          className="bg-surface border border-line rounded-2xl p-4"
        >
          <div className="flex items-center gap-2 mb-3">
            <div className="w-6 h-6 bg-primary rounded-md flex items-center justify-center flex-shrink-0">
              <span className="text-white text-xs font-bold leading-none">B</span>
            </div>
            <p className="font-bold text-ink text-sm">About Bhasha AI</p>
          </div>
          <p className="text-xs text-ink-2 leading-relaxed mb-3">
            Your voice-first health companion built for every Indian. Speak in your language — Hindi, Telugu, Tamil, Marathi, Bengali, or any dialect — and get instant medical guidance, find the right hospitals, track your full health history, and book doctor appointments.
          </p>
          <div className="grid grid-cols-2 gap-y-2 gap-x-3">
            {[
              { icon: '🗣️', text: '10+ Indian languages' },
              { icon: '🏥', text: 'Find nearby hospitals' },
              { icon: '🤖', text: 'AI deep analysis' },
              { icon: '🗂️', text: 'Medical history timeline' },
              { icon: '📅', text: 'Book appointments' },
              { icon: '🔒', text: 'Private & secure' },
            ].map(f => (
              <div key={f.text} className="flex items-center gap-2">
                <span className="text-sm">{f.icon}</span>
                <span className="text-xs text-ink-2">{f.text}</span>
              </div>
            ))}
          </div>
        </motion.div>
      </div>

    </div>
  );
}
