import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';
import { API_BASE, DEMO_USER_ID } from '../config';

export type UserProfile = {
  name: string;
  age: string;
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
  } catch {
    return null;
  }
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
  const [form, setForm] = useState<UserProfile>({
    name: '',
    age: '',
    language: 'hi',
    conditions: [],
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const existing = loadProfile();
    if (existing) setForm(existing);
  }, [open]);

  const toggleCondition = (c: string) => {
    setForm(prev => ({
      ...prev,
      conditions: prev.conditions.includes(c)
        ? prev.conditions.filter(x => x !== c)
        : [...prev.conditions, c],
    }));
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      await axios.post(`${API_BASE}/profile`, { ...form, userId: DEMO_USER_ID });
    } catch {
      // Save locally even if API fails
    }
    saveProfileLocally(form);
    setSaving(false);
    setSaved(true);
    onSave(form);
    setTimeout(() => {
      setSaved(false);
      onClose();
    }, 800);
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/50 z-50 flex items-end"
          onClick={e => e.target === e.currentTarget && onClose()}
        >
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            className="bg-white rounded-t-3xl w-full max-h-[90vh] overflow-y-auto"
          >
            {/* Handle */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 bg-gray-200 rounded-full" />
            </div>

            <div className="px-6 pb-8 space-y-5">
              {/* Header */}
              <div className="flex items-center justify-between pt-2">
                <div>
                  <h2 className="text-xl font-bold text-gray-900">Your Profile</h2>
                  <p className="text-xs text-gray-500 mt-0.5">Helps AI give better advice</p>
                </div>
                <div className="w-12 h-12 bg-primary/10 rounded-2xl flex items-center justify-center text-2xl">
                  👤
                </div>
              </div>

              {/* Name */}
              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1.5">Your Name</label>
                <input
                  placeholder="e.g. Ramesh Kumar"
                  value={form.name}
                  onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-primary"
                />
              </div>

              {/* Age */}
              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1.5">Age</label>
                <input
                  placeholder="e.g. 45"
                  type="number"
                  value={form.age}
                  onChange={e => setForm(p => ({ ...p, age: e.target.value }))}
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-primary"
                />
              </div>

              {/* Preferred Language */}
              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1.5">
                  Preferred Language
                </label>
                <select
                  value={form.language}
                  onChange={e => setForm(p => ({ ...p, language: e.target.value }))}
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-primary bg-white"
                >
                  {LANGUAGES.map(l => (
                    <option key={l.code} value={l.code}>{l.label}</option>
                  ))}
                </select>
              </div>

              {/* Known Conditions */}
              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1.5">
                  Known Health Conditions
                </label>
                <p className="text-xs text-gray-400 mb-2">
                  AI will warn you if a medicine conflicts with these
                </p>
                <div className="flex flex-wrap gap-2">
                  {CONDITIONS.map(c => (
                    <button
                      key={c}
                      onClick={() => toggleCondition(c)}
                      className={`px-3 py-2 rounded-xl text-sm font-medium transition-all border ${
                        form.conditions.includes(c)
                          ? 'bg-primary text-white border-primary'
                          : 'bg-white text-gray-600 border-gray-200'
                      }`}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>

              {/* Save */}
              <motion.button
                onClick={handleSave}
                disabled={!form.name.trim() || saving}
                className={`w-full py-4 rounded-2xl font-semibold text-base transition-all ${
                  saved
                    ? 'bg-success text-white'
                    : 'bg-primary text-white disabled:opacity-50'
                }`}
                whileTap={{ scale: 0.98 }}
              >
                {saved ? '✓ Saved!' : saving ? 'Saving...' : 'Save Profile'}
              </motion.button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
