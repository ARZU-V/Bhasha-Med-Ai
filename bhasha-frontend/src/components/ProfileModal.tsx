import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';
import { API_BASE, DEMO_USER_ID } from '../config';

export type UserProfile = {
  name: string;
  age: string;
  phone: string;
  language: string;
  conditions: string[];
};

const CONDITIONS = ['Diabetes', 'Blood Pressure', 'Asthma', 'Heart Disease', 'Thyroid', 'Kidney Disease'];
const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'hi', label: 'हिंदी (Hindi)' },
  { code: 'te', label: 'తెలుగు (Telugu)' },
  { code: 'ta', label: 'தமிழ் (Tamil)' },
  { code: 'mr', label: 'मराठी (Marathi)' },
  { code: 'bn', label: 'বাংলা (Bengali)' },
  { code: 'gu', label: 'ગુજરાતી (Gujarati)' },
  { code: 'kn', label: 'ಕನ್ನಡ (Kannada)' },
  { code: 'ml', label: 'മലയാളം (Malayalam)' },
  { code: 'pa', label: 'ਪੰਜਾਬੀ (Punjabi)' },
];

const STORAGE_KEY = 'bhasha_profile';

export function loadProfile(): UserProfile | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function saveProfileLocally(profile: UserProfile) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
}

interface ProfileModalProps {
  open: boolean;
  onClose: () => void;
  onSave: (profile: UserProfile) => void;
}

export default function ProfileModal({ open, onClose, onSave }: ProfileModalProps) {
  const [form,   setForm]   = useState<UserProfile>({ name: '', age: '', phone: '', language: 'hi', conditions: [] });
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);

  useEffect(() => {
    const existing = loadProfile();
    if (existing) setForm(existing);
  }, [open]);

  const toggleCondition = (c: string) =>
    setForm(prev => ({
      ...prev,
      conditions: prev.conditions.includes(c)
        ? prev.conditions.filter(x => x !== c)
        : [...prev.conditions, c],
    }));

  const handleSave = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try { await axios.post(`${API_BASE}/profile`, { ...form, userId: DEMO_USER_ID }); } catch { /* local fallback */ }
    saveProfileLocally(form);
    setSaving(false); setSaved(true);
    onSave(form);
    setTimeout(() => { setSaved(false); onClose(); }, 800);
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/25 z-50 flex items-end backdrop-blur-[2px]"
          onClick={e => e.target === e.currentTarget && onClose()}>
          <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 320 }}
            className="bg-surface w-full max-h-[92vh] overflow-y-auto border-t border-line rounded-t-2xl">

            {/* Handle */}
            <div className="flex justify-center pt-3 pb-0">
              <div className="w-8 h-1 bg-line rounded-full" />
            </div>

            <div className="px-5 pb-8 space-y-5 pt-4">
              {/* Header */}
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-xl font-bold text-ink tracking-tight">Your Profile</h2>
                  <p className="text-xs text-ink-3 mt-0.5">Helps AI personalise advice for you</p>
                </div>
                <button onClick={onClose} className="w-8 h-8 rounded-lg bg-surface-2 border border-line flex items-center justify-center text-ink-3 text-sm mt-0.5">✕</button>
              </div>

              {/* Name */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-ink-2 uppercase tracking-widest">Your Name</label>
                <input placeholder="e.g. Ramesh Kumar" value={form.name}
                  onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                  className="w-full bg-surface-2 border border-line rounded-lg px-3 py-2.5 text-sm text-ink placeholder:text-ink-3 outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition-all" />
              </div>

              {/* Age */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-ink-2 uppercase tracking-widest">Age</label>
                <input placeholder="e.g. 45" type="number" value={form.age}
                  onChange={e => setForm(p => ({ ...p, age: e.target.value }))}
                  className="w-full bg-surface-2 border border-line rounded-lg px-3 py-2.5 text-sm text-ink placeholder:text-ink-3 outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition-all" />
              </div>

              {/* Phone */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-ink-2 uppercase tracking-widest">Your Phone Number</label>
                <input placeholder="e.g. +919876543210" type="tel" value={form.phone}
                  onChange={e => setForm(p => ({ ...p, phone: e.target.value }))}
                  className="w-full bg-surface-2 border border-line rounded-lg px-3 py-2.5 text-sm text-ink placeholder:text-ink-3 outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition-all" />
              </div>

              {/* Language */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-ink-2 uppercase tracking-widest">Preferred Language</label>
                <select value={form.language} onChange={e => setForm(p => ({ ...p, language: e.target.value }))}
                  className="w-full bg-surface-2 border border-line rounded-lg px-3 py-2.5 text-sm text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition-all appearance-none">
                  {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
                </select>
              </div>

              {/* Conditions */}
              <div className="space-y-2">
                <div>
                  <label className="text-xs font-semibold text-ink-2 uppercase tracking-widest">Known Health Conditions</label>
                  <p className="text-xs text-ink-3 mt-0.5">AI will flag medicines that conflict with these</p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {CONDITIONS.map(c => (
                    <button key={c} onClick={() => toggleCondition(c)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all active:scale-[0.97] ${
                        form.conditions.includes(c)
                          ? 'bg-primary text-white border-primary'
                          : 'bg-surface-2 text-ink-2 border-line'
                      }`}>
                      {c}
                    </button>
                  ))}
                </div>
              </div>

              {/* Save */}
              <motion.button onClick={handleSave} disabled={!form.name.trim() || saving}
                className={`w-full py-3 rounded-lg font-semibold text-sm transition-all active:scale-[0.98] disabled:opacity-40 ${
                  saved ? 'bg-success text-white' : 'bg-primary text-white'
                }`}
                whileTap={{ scale: 0.98 }}>
                {saved ? '✓ Saved!' : saving ? 'Saving...' : 'Save Profile'}
              </motion.button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
