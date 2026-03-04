import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { loadProfile } from '../components/ProfileModal';

type Navigator = {
  id: string;
  name: string;
  rating: number;
  trips: number;
  distance: string;
  languages: string[];
  available: boolean;
  avatar: string;
};

const NAVIGATORS: Navigator[] = [
  { id: '1', name: 'Suresh Kumar',  rating: 4.9, trips: 234, distance: '1.2 km', languages: ['Hindi', 'English'], available: true,  avatar: '👨‍⚕️' },
  { id: '2', name: 'Meena Devi',    rating: 4.8, trips: 189, distance: '2.1 km', languages: ['Hindi', 'Telugu'],  available: true,  avatar: '👩‍⚕️' },
  { id: '3', name: 'Rajesh Singh',  rating: 4.7, trips: 312, distance: '3.4 km', languages: ['Hindi', 'Punjabi'], available: false, avatar: '👨' },
];

const HOSPITALS = [
  'AIIMS Delhi', 'Safdarjung Hospital', 'Ram Manohar Lohia Hospital',
  'Apollo Hospital', 'Fortis Hospital', 'Max Hospital', 'Other',
];

type BookingState = 'idle' | 'selecting' | 'confirmed';

export default function NavigatorTab() {
  const profile = loadProfile();
  const [state, setState]         = useState<BookingState>('idle');
  const [hospital, setHospital]   = useState('');
  const [date, setDate]           = useState('');
  const [time, setTime]           = useState('');
  const [needs, setNeeds]         = useState('');
  const [selected, setSelected]   = useState<Navigator | null>(null);

  const canBook = hospital && date && time;

  const handleBook = (nav: Navigator) => {
    setSelected(nav);
    setState('confirmed');
  };

  const reset = () => {
    setState('idle');
    setHospital(''); setDate(''); setTime(''); setNeeds(''); setSelected(null);
  };

  return (
    <div className="px-4 py-4 space-y-4">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-gray-900">Hospital Navigator</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          On-demand helper to guide you through hospitals — like Uber, for healthcare
        </p>
      </div>

      {/* How it works */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { icon: '📍', label: 'Book', desc: 'Choose hospital & time' },
          { icon: '🤝', label: 'Meet', desc: 'Navigator meets you at gate' },
          { icon: '🏠', label: 'Home', desc: 'Dropped back safely' },
        ].map(s => (
          <div key={s.label} className="bg-blue-50 rounded-xl p-3 text-center space-y-1">
            <div className="text-2xl">{s.icon}</div>
            <p className="text-xs font-bold text-blue-800">{s.label}</p>
            <p className="text-[10px] text-blue-600">{s.desc}</p>
          </div>
        ))}
      </div>

      <AnimatePresence mode="wait">

        {/* ── IDLE: Booking Form ── */}
        {state === 'idle' && (
          <motion.div key="form" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-3">

            <select
              value={hospital}
              onChange={e => setHospital(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm bg-white outline-none focus:border-primary appearance-none"
            >
              <option value="">Select Hospital *</option>
              {HOSPITALS.map(h => <option key={h} value={h}>{h}</option>)}
            </select>

            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              min={new Date().toISOString().split('T')[0]}
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm bg-white outline-none focus:border-primary"
            />

            <select
              value={time}
              onChange={e => setTime(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm bg-white outline-none focus:border-primary appearance-none"
            >
              <option value="">Preferred Time *</option>
              <option>Morning (8 AM – 11 AM)</option>
              <option>Afternoon (11 AM – 2 PM)</option>
              <option>Evening (2 PM – 6 PM)</option>
            </select>

            <textarea
              placeholder="Special needs (e.g. wheelchair, elderly, post-surgery...)"
              value={needs}
              onChange={e => setNeeds(e.target.value)}
              rows={2}
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm bg-white outline-none focus:border-primary resize-none"
            />

            <motion.button
              onClick={() => canBook && setState('selecting')}
              disabled={!canBook}
              className="w-full bg-primary text-white py-4 rounded-2xl font-semibold text-base disabled:opacity-50 flex items-center justify-center gap-2"
              whileTap={{ scale: 0.98 }}
            >
              🔍 Find Available Navigators
            </motion.button>

            <p className="text-center text-xs text-gray-400">₹200–₹500 per visit · Trained & verified helpers</p>
          </motion.div>
        )}

        {/* ── SELECTING: Navigator List ── */}
        {state === 'selecting' && (
          <motion.div key="selecting" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-3">

            {/* Trip summary */}
            <div className="bg-gray-50 rounded-xl p-3 text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-gray-500">Hospital</span>
                <span className="font-semibold text-gray-900">{hospital}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Date & Time</span>
                <span className="font-semibold text-gray-900">{date} · {time}</span>
              </div>
              {needs && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Special needs</span>
                  <span className="font-semibold text-gray-900 text-right max-w-[60%]">{needs}</span>
                </div>
              )}
            </div>

            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
              {NAVIGATORS.filter(n => n.available).length} navigators available nearby
            </p>

            {NAVIGATORS.map((nav, i) => (
              <motion.div
                key={nav.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.08 }}
                className={`bg-white border rounded-2xl p-4 flex items-center gap-4 ${nav.available ? 'border-gray-200' : 'border-gray-100 opacity-50'}`}
              >
                <div className="w-12 h-12 bg-blue-50 rounded-xl flex items-center justify-center text-2xl flex-shrink-0">
                  {nav.avatar}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-gray-900 text-sm">{nav.name}</p>
                    {nav.available && <span className="text-[10px] bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">Available</span>}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs text-yellow-500">⭐ {nav.rating}</span>
                    <span className="text-xs text-gray-400">·</span>
                    <span className="text-xs text-gray-500">{nav.trips} trips</span>
                    <span className="text-xs text-gray-400">·</span>
                    <span className="text-xs text-gray-500">{nav.distance}</span>
                  </div>
                  <div className="flex gap-1 mt-1.5 flex-wrap">
                    {nav.languages.map(l => (
                      <span key={l} className="text-[10px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{l}</span>
                    ))}
                  </div>
                </div>
                {nav.available && (
                  <button
                    onClick={() => handleBook(nav)}
                    className="bg-primary text-white text-xs font-semibold px-4 py-2 rounded-xl flex-shrink-0 active:scale-95 transition-all"
                  >
                    Book
                  </button>
                )}
              </motion.div>
            ))}

            <button onClick={reset} className="w-full text-sm text-gray-400 py-2">← Change details</button>
          </motion.div>
        )}

        {/* ── CONFIRMED ── */}
        {state === 'confirmed' && selected && (
          <motion.div
            key="confirmed"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white border border-green-200 rounded-2xl p-6 space-y-4 text-center"
          >
            <div className="text-5xl">✅</div>
            <div>
              <p className="font-bold text-gray-900 text-lg">Navigator Booked!</p>
              <p className="text-sm text-gray-500 mt-1">{selected.name} will meet you at the {hospital} main gate</p>
            </div>

            <div className="bg-gray-50 rounded-xl p-3 text-sm space-y-2 text-left">
              <div className="flex justify-between">
                <span className="text-gray-500">Navigator</span>
                <span className="font-semibold">{selected.avatar} {selected.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Hospital</span>
                <span className="font-semibold">{hospital}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Date & Time</span>
                <span className="font-semibold">{date} · {time}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Patient</span>
                <span className="font-semibold">{profile?.name || 'You'}</span>
              </div>
            </div>

            <div className="bg-blue-50 rounded-xl p-3 text-xs text-blue-800 text-left space-y-1">
              <p className="font-semibold">What happens next:</p>
              <p>• Navigator will call you 30 min before to confirm</p>
              <p>• They'll have your health summary from Bhasha AI</p>
              <p>• Meet at the main gate — look for the Bhasha AI badge</p>
            </div>

            <button
              onClick={reset}
              className="w-full bg-gray-100 text-gray-700 py-3 rounded-xl font-semibold text-sm active:scale-[0.98] transition-all"
            >
              Book Another
            </button>
          </motion.div>
        )}

      </AnimatePresence>
    </div>
  );
}
