import { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';
import { API_BASE, DEMO_USER_ID } from '../config';
import { loadProfile } from '../components/ProfileModal';

type Contact = { name: string; phone: string; relation: string };

export default function EmergencyTab() {
  const [contacts, setContacts] = useState<Contact[]>([
    { name: 'Priya (Wife)', phone: '+919876543210', relation: 'Family' },
  ]);
  const [showAddForm,    setShowAddForm]    = useState(false);
  const [newContact,     setNewContact]     = useState({ name: '', phone: '', relation: '' });
  const [emergencyState, setEmergencyState] = useState<'idle' | 'active' | 'cancelled'>('idle');
  const [countdown,      setCountdown]      = useState(30);
  const [emergencyId,    setEmergencyId]    = useState<string | null>(null);
  const [holdProgress,   setHoldProgress]   = useState(0);
  const holdIntervalRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef     = useRef<ReturnType<typeof setInterval> | null>(null);

  const startHold = () => {
    let p = 0;
    holdIntervalRef.current = setInterval(() => {
      p += 5; setHoldProgress(p);
      if (p >= 100) { clearInterval(holdIntervalRef.current!); triggerEmergency(); }
    }, 100);
  };

  const cancelHold = () => { clearInterval(holdIntervalRef.current!); setHoldProgress(0); };

  const triggerEmergency = async () => {
    setEmergencyState('active'); setCountdown(30);
    const profile = loadProfile();
    try {
      const { data } = await axios.post(`${API_BASE}/emergency/trigger`, {
        userId: DEMO_USER_ID,
        symptoms: 'Emergency SOS triggered',
        location: { lat: 28.6139, lng: 77.209, address: 'Current Location' },
        contacts,
        patientName:  profile?.name  || 'User',
        patientPhone: profile?.phone || '',
      });
      setEmergencyId(data.emergencyId);
    } catch (e) { console.error(e); }
    countdownRef.current = setInterval(() => {
      setCountdown(prev => { if (prev <= 1) { clearInterval(countdownRef.current!); return 0; } return prev - 1; });
    }, 1000);
  };

  const cancelEmergency = async () => {
    clearInterval(countdownRef.current!);
    if (emergencyId) {
      try { await axios.post(`${API_BASE}/emergency/cancel`, { emergencyId, userId: DEMO_USER_ID }); }
      catch (e) { console.error(e); }
    }
    setEmergencyState('cancelled'); setHoldProgress(0);
    setTimeout(() => setEmergencyState('idle'), 2000);
  };

  return (
    <div className="px-4 py-4 space-y-4">
      <div>
        <h2 className="text-xl font-bold text-ink tracking-tight">Emergency</h2>
        <p className="text-xs text-ink-3 mt-0.5">Hold the button for 2 seconds to alert contacts</p>
      </div>

      {/* ── SOS Card ───────────────────────────────────────────────────────── */}
      <div className="bg-surface border border-line rounded-xl p-6 text-center">
        <AnimatePresence mode="wait">
          {emergencyState === 'idle' && (
            <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center gap-5">
              <div className="relative inline-flex">
                <motion.button
                  onMouseDown={startHold} onMouseUp={cancelHold}
                  onMouseLeave={cancelHold} onTouchStart={startHold} onTouchEnd={cancelHold}
                  className="w-28 h-28 bg-danger rounded-full flex flex-col items-center justify-center text-white select-none"
                  whileTap={{ scale: 0.96 }}
                >
                  <span className="text-3xl">🆘</span>
                  <span className="text-sm font-bold mt-1 tracking-wide">SOS</span>
                </motion.button>
                {holdProgress > 0 && (
                  <svg className="absolute inset-0 w-28 h-28 -rotate-90 pointer-events-none" viewBox="0 0 112 112">
                    <circle cx="56" cy="56" r="52" fill="none" stroke="white" strokeWidth="3"
                      strokeDasharray={`${holdProgress * 3.27} 327`} strokeLinecap="round" opacity="0.5" />
                  </svg>
                )}
              </div>
              <p className="text-xs text-ink-3">Hold for 2 seconds to send alert</p>
            </motion.div>
          )}

          {emergencyState === 'active' && (
            <motion.div key="active" initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }} className="space-y-4">
              <motion.div className="text-5xl" animate={{ scale: [1, 1.08, 1] }} transition={{ duration: 0.5, repeat: Infinity }}>
                🚨
              </motion.div>
              <div>
                <p className="font-bold text-danger text-lg">Emergency Alert Sent</p>
                <p className="text-xs text-ink-2 mt-0.5">Calling {contacts.length} contact(s)...</p>
              </div>
              <div className="space-y-2">
                {contacts.map((c, i) => (
                  <motion.div key={i} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.15 }} className="flex items-center justify-between bg-danger/5 border border-danger/15 rounded-lg px-3 py-2.5">
                    <div className="text-left">
                      <p className="font-medium text-sm text-ink">{c.name}</p>
                      <p className="text-xs text-ink-3">{c.phone}</p>
                    </div>
                    <motion.p animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 0.7, repeat: Infinity, delay: i * 0.2 }}
                      className="text-success text-xs font-semibold">
                      📞 Calling
                    </motion.p>
                  </motion.div>
                ))}
              </div>
              <button onClick={cancelEmergency}
                className="w-full bg-surface-2 border border-line text-ink-2 py-3 rounded-lg text-sm font-medium active:scale-[0.98] transition-all">
                Cancel ({countdown}s)
              </button>
            </motion.div>
          )}

          {emergencyState === 'cancelled' && (
            <motion.div key="cancelled" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="py-4 space-y-2">
              <p className="text-3xl">✅</p>
              <p className="font-medium text-ink-2 text-sm">Emergency cancelled</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Contacts ───────────────────────────────────────────────────────── */}
      <div className="space-y-2.5">
        <div className="flex justify-between items-center">
          <p className="label">Emergency Contacts</p>
          <button onClick={() => setShowAddForm(true)} className="text-primary text-xs font-semibold">+ Add</button>
        </div>

        {contacts.length === 0 ? (
          <p className="text-xs text-ink-3 text-center py-4">No contacts added yet</p>
        ) : (
          contacts.map((c, i) => (
            <div key={i} className="bg-surface border border-line rounded-xl p-3.5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-danger/8 border border-danger/15 rounded-lg flex items-center justify-center text-sm">👤</div>
                <div>
                  <p className="font-semibold text-sm text-ink">{c.name}</p>
                  <p className="text-xs text-ink-3">{c.phone} · {c.relation}</p>
                </div>
              </div>
              <button onClick={() => setContacts(contacts.filter((_, j) => j !== i))}
                className="w-7 h-7 rounded-lg bg-surface-2 border border-line flex items-center justify-center text-ink-3 text-xs hover:text-danger transition-colors">
                ✕
              </button>
            </div>
          ))
        )}
      </div>

      {/* ── Add contact sheet ───────────────────────────────────────────────── */}
      <AnimatePresence>
        {showAddForm && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/30 z-50 flex items-end"
            onClick={e => e.target === e.currentTarget && setShowAddForm(false)}>
            <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 320 }}
              className="bg-surface rounded-t-2xl w-full p-5 space-y-4 border-t border-line">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-ink">Add Emergency Contact</h3>
                <button onClick={() => setShowAddForm(false)} className="w-7 h-7 rounded-lg bg-surface-2 border border-line flex items-center justify-center text-ink-3 text-sm">✕</button>
              </div>
              {(['name', 'phone', 'relation'] as const).map(field => (
                <input key={field}
                  placeholder={field === 'name' ? 'Full name' : field === 'phone' ? 'Phone (+91XXXXXXXXXX)' : 'Relation (Family / Doctor)'}
                  type={field === 'phone' ? 'tel' : 'text'}
                  value={newContact[field]}
                  onChange={e => setNewContact(p => ({ ...p, [field]: e.target.value }))}
                  className="w-full bg-surface-2 border border-line rounded-lg px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition-all" />
              ))}
              <button
                onClick={() => { if (newContact.name && newContact.phone) { setContacts(p => [...p, newContact]); setShowAddForm(false); setNewContact({ name: '', phone: '', relation: '' }); } }}
                disabled={!newContact.name || !newContact.phone}
                className="w-full bg-danger text-white py-3 rounded-lg font-semibold text-sm disabled:opacity-40 active:scale-[0.98] transition-all">
                Add Contact
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
