import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';
import { API_BASE, DEMO_USER_ID } from '../config';
import { loadProfile } from '../components/ProfileModal';

type Medication  = { medicationId: string; name: string; dosage: string; times: string[]; takenToday?: boolean; };
type MedicineInfo = { what_it_is: string; uses: string; side_effects: string; interactions: string; safe_for_conditions: string; disclaimer: string; name?: string; };
type ScannedMed  = { name: string; dosage: string; timing?: string; frequency?: string; instructions?: string; duration?: string; what_it_is?: string; uses?: string; side_effects?: string; interactions?: string; safe_note?: string; };

const TIME_OPTIONS = ['Morning (8 AM)', 'Afternoon (2 PM)', 'Night (9 PM)'];
const MED_HUE = ['bg-blue-50 text-blue-600', 'bg-violet-50 text-violet-600', 'bg-emerald-50 text-emerald-600', 'bg-amber-50 text-amber-600'];

const SCHEDULE_SLOTS = [
  { label: 'Morning',   icon: '🌅', time: 'Morning (8 AM)',   hour: 8 },
  { label: 'Afternoon', icon: '☀️', time: 'Afternoon (2 PM)', hour: 14 },
  { label: 'Night',     icon: '🌙', time: 'Night (9 PM)',     hour: 21 },
];

function getCurrentSlot(): string {
  const h = new Date().getHours();
  if (h < 11)  return 'Morning (8 AM)';
  if (h < 17)  return 'Afternoon (2 PM)';
  return 'Night (9 PM)';
}

async function requestNotificationPermission(): Promise<boolean> {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  const result = await Notification.requestPermission();
  return result === 'granted';
}

// ── localStorage-backed medication store ─────────────────────────────
const MEDS_KEY = 'bhasha_meds';
const loadLocalMeds = (): Medication[] => {
  try { return JSON.parse(localStorage.getItem(MEDS_KEY) || '[]'); }
  catch { return []; }
};
const saveLocalMeds = (list: Medication[]) =>
  localStorage.setItem(MEDS_KEY, JSON.stringify(list));

function InfoRow({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="space-y-0.5">
      <p className="label">{label}</p>
      <p className="text-sm text-ink leading-relaxed">{value}</p>
    </div>
  );
}

export default function MedicationsTab() {
  const profile     = loadProfile();
  const [activeView, setActiveView] = useState<'meds' | 'check'>('meds');
  const [showForm,   setShowForm]   = useState(false);
  const [form, setForm] = useState({ name: '', dosage: '', times: [] as string[] });

  const [checkName,   setCheckName]   = useState('');
  const [checkResult, setCheckResult] = useState<MedicineInfo | null>(null);
  const [checking,    setChecking]    = useState(false);
  const [scanning,    setScanning]    = useState(false);
  const [scannedMeds, setScannedMeds] = useState<ScannedMed[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [notifGranted,  setNotifGranted]  = useState(Notification?.permission === 'granted');
  const [notifRequested, setNotifRequested] = useState(false);
  const currentSlot = getCurrentSlot();

  // ── Medications: localStorage-first, API sync as bonus ──────────────
  const [meds,      setMeds]      = useState<Medication[]>(loadLocalMeds);
  const [isLoading, setIsLoading] = useState(false);
  const [addingMed, setAddingMed] = useState(false);

  useEffect(() => {
    setIsLoading(true);
    axios.get(`${API_BASE}/medications?userId=${DEMO_USER_ID}`)
      .then(({ data }) => {
        const list = (data.medications ?? []) as Medication[];
        if (list.length > 0) { setMeds(list); saveLocalMeds(list); }
      })
      .catch(() => { /* use localStorage fallback */ })
      .finally(() => setIsLoading(false));
  }, []);

  const addMed = {
    isPending: addingMed,
    mutate: (med: typeof form) => {
      setAddingMed(true);
      const newMed: Medication = {
        medicationId: `med-${Date.now()}`,
        name: med.name, dosage: med.dosage, times: med.times, takenToday: false,
      };
      const updated = [...meds, newMed].sort((a, b) => a.name.localeCompare(b.name));
      setMeds(updated); saveLocalMeds(updated);
      setAddingMed(false); setShowForm(false); setForm({ name: '', dosage: '', times: [] });
      axios.post(`${API_BASE}/medications`, { ...med, userId: DEMO_USER_ID }).catch(() => {});
    },
  };

  const markTaken = {
    mutate: (id: string) => {
      const updated = meds.map((m: Medication) => m.medicationId === id ? { ...m, takenToday: true } : m);
      setMeds(updated); saveLocalMeds(updated);
      // Only sync to API if it's a real UUID (not a local timestamp ID)
      if (!id.startsWith('med-')) {
        axios.put(`${API_BASE}/medications/${id}/taken`, { userId: DEMO_USER_ID, takenAt: new Date().toISOString() }).catch(() => {});
      }
    },
  };

  // Fire a test notification when permission is newly granted
  useEffect(() => {
    if (notifGranted && notifRequested) {
      new Notification('Bhasha AI Reminder 💊', {
        body: `Time to check your ${currentSlot.split(' ')[0]} medicines!`,
        icon: '/favicon.ico',
      });
      setNotifRequested(false);
    }
  }, [notifGranted, notifRequested, currentSlot]);

  const toggleTime = (t: string) => setForm(prev => ({ ...prev, times: prev.times.includes(t) ? prev.times.filter((x: string) => x !== t) : [...prev.times, t] }));

  const checkMedicine = async () => {
    if (!checkName.trim()) return;
    setChecking(true); setCheckResult(null);
    try {
      const { data } = await axios.post(`${API_BASE}/medicine/check`, { medicineName: checkName, userId: DEMO_USER_ID, userConditions: profile?.conditions || [] });
      setCheckResult(data.info);
    } catch {
      setCheckResult({ what_it_is: 'Could not fetch medicine information.', uses: 'Please try again or consult your pharmacist.', side_effects: '', interactions: '', safe_for_conditions: '', disclaimer: 'Always consult your doctor.', name: checkName });
    } finally { setChecking(false); }
  };

  const handleScanImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setScanning(true); setScannedMeds([]);
    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = (reader.result as string).split(',')[1];
      try {
        const { data } = await axios.post(`${API_BASE}/medicine/scan`, { image: base64, imageType: file.type || 'image/jpeg', userId: DEMO_USER_ID, userConditions: profile?.conditions || [] });
        setScannedMeds(data.scan?.medicines || data.medicines || []);
      } catch { setScannedMeds([{ name: 'Could not read prescription', dosage: '', timing: 'Please try a clearer image' }]); }
      finally { setScanning(false); }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  return (
    <div className="px-4 py-4 space-y-4">

      {/* ── Segmented control ──────────────────────────────────────────────── */}
      <div className="bg-surface-2 rounded-lg p-0.5 flex border border-line">
        {(['meds', 'check'] as const).map(view => (
          <button key={view} onClick={() => setActiveView(view)}
            className={`flex-1 py-2 rounded-md text-sm font-medium transition-all ${
              activeView === view ? 'bg-surface text-ink shadow-card' : 'text-ink-3'
            }`}>
            {view === 'meds' ? '💊 My Medicines' : '🔬 Check Medicine'}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {/* ── MY MEDS ──────────────────────────────────────────────────────── */}
        {activeView === 'meds' && (
          <motion.div key="meds" initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="space-y-3">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-xl font-bold text-ink tracking-tight">My Medicines</h2>
                <p className="text-xs text-ink-3 mt-0.5">{meds.length} medicine{meds.length !== 1 ? 's' : ''} tracked</p>
              </div>
              <button onClick={() => setShowForm(true)} className="btn text-sm px-3 py-2">+ Add</button>
            </div>

            {meds.some(m => !m.takenToday) && meds.length > 0 && (
              <div className="border border-warning/30 bg-warning/5 rounded-xl p-3 flex items-center gap-3">
                <span className="text-lg">⏰</span>
                <div>
                  <p className="text-sm font-semibold text-ink">Pending today</p>
                  <p className="text-xs text-ink-2">You have medicines to take</p>
                </div>
              </div>
            )}

            {isLoading ? (
              <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="bg-surface rounded-xl border border-line h-20 animate-pulse" />)}</div>
            ) : meds.length === 0 ? (
              <div className="text-center py-16 space-y-3">
                <p className="text-4xl">💊</p>
                <p className="text-ink-2 text-sm">No medicines added yet</p>
                <button onClick={() => setShowForm(true)} className="text-primary text-sm font-medium">Add your first medicine →</button>
              </div>
            ) : (
              <div className="space-y-2">
                {meds.map((med, i) => (
                  <motion.div key={med.medicationId} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04 }}
                    className="bg-surface rounded-xl border border-line p-3.5 flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-base flex-shrink-0 ${MED_HUE[i % MED_HUE.length]}`}>
                      💊
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-ink text-sm">{med.name}</p>
                      <p className="text-xs text-ink-2">{med.dosage}</p>
                      <div className="flex gap-1 mt-1 flex-wrap">
                        {med.times.map(t => <span key={t} className="text-2xs bg-surface-2 text-ink-3 border border-line px-1.5 py-0.5 rounded-full">{t}</span>)}
                      </div>
                    </div>
                    <button onClick={() => markTaken.mutate(med.medicationId)}
                      className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all active:scale-[0.97] ${
                        med.takenToday ? 'bg-success/10 text-success border border-success/20' : 'bg-primary text-white'
                      }`}>
                      {med.takenToday ? '✓ Done' : 'Take'}
                    </button>
                  </motion.div>
                ))}
              </div>
            )}

            {/* ── Daily Schedule & Reminders ─────────────────────────────── */}
            {meds.length > 0 && (
              <div className="space-y-2 pt-1">
                <div className="flex items-center justify-between">
                  <p className="label">Today's Schedule</p>
                  <button
                    onClick={async () => {
                      const granted = await requestNotificationPermission();
                      setNotifGranted(granted);
                      setNotifRequested(true);
                      if (!granted) alert('Enable notifications in browser settings to get medicine reminders.');
                    }}
                    className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border transition-all ${
                      notifGranted
                        ? 'bg-success/10 text-success border-success/20'
                        : 'bg-surface-2 text-ink-3 border-line hover:border-primary hover:text-primary'
                    }`}
                  >
                    {notifGranted ? '🔔 Reminders on' : '🔕 Enable reminders'}
                  </button>
                </div>

                {SCHEDULE_SLOTS.map(slot => {
                  const slotMeds = meds.filter(m => m.times.includes(slot.time));
                  const isCurrent = slot.time === currentSlot;
                  if (slotMeds.length === 0) return null;
                  return (
                    <div key={slot.time} className={`rounded-xl border p-3 space-y-2 ${
                      isCurrent ? 'border-primary/30 bg-primary/5' : 'border-line bg-surface'
                    }`}>
                      <div className="flex items-center gap-2">
                        <span className="text-base">{slot.icon}</span>
                        <span className={`text-xs font-semibold ${isCurrent ? 'text-primary' : 'text-ink-2'}`}>
                          {slot.label}
                        </span>
                        {isCurrent && <span className="text-2xs bg-primary text-white px-1.5 py-0.5 rounded-full">Now</span>}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {slotMeds.map(m => (
                          <span key={m.medicationId}
                            className={`text-xs px-2.5 py-1 rounded-full border ${
                              m.takenToday
                                ? 'bg-success/10 text-success border-success/20 line-through'
                                : isCurrent ? 'bg-primary text-white border-primary' : 'bg-surface-2 text-ink-2 border-line'
                            }`}>
                            {m.name} {m.dosage && `· ${m.dosage}`}
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </motion.div>
        )}

        {/* ── CHECK MEDICINE ───────────────────────────────────────────────── */}
        {activeView === 'check' && (
          <motion.div key="check" initial={{ opacity: 0, x: 6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="space-y-4">
            <div>
              <h2 className="text-xl font-bold text-ink tracking-tight">Check Medicine</h2>
              <p className="text-xs text-ink-3 mt-0.5">Type a name or scan a prescription photo</p>
            </div>

            <div className="flex gap-2">
              <input placeholder="e.g. Metformin, Paracetamol..." value={checkName}
                onChange={e => setCheckName(e.target.value)} onKeyDown={e => e.key === 'Enter' && checkMedicine()}
                className="flex-1 bg-surface-2 border border-line rounded-lg px-3 py-2.5 text-sm text-ink placeholder:text-ink-3 outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition-all" />
              <button onClick={checkMedicine} disabled={!checkName.trim() || checking}
                className="btn px-4 disabled:opacity-40">
                {checking ? '...' : 'Check'}
              </button>
            </div>

            <input ref={fileInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleScanImage} />
            <button onClick={() => fileInputRef.current?.click()} disabled={scanning}
              className="w-full border border-dashed border-line rounded-xl py-5 flex flex-col items-center gap-1.5 text-ink-3 hover:border-primary hover:text-primary transition-all disabled:opacity-50 active:scale-[0.99]">
              <span className="text-2xl">{scanning ? '⏳' : '📷'}</span>
              <span className="text-sm font-medium text-ink-2">{scanning ? 'Scanning...' : 'Scan Prescription'}</span>
              <span className="text-xs text-ink-3">Take photo or upload image</span>
            </button>

            {profile?.conditions && profile.conditions.length > 0 && (
              <div className="bg-primary/5 border border-primary/15 rounded-lg px-3 py-2.5 flex items-start gap-2">
                <span className="text-sm mt-0.5">ℹ️</span>
                <p className="text-xs text-primary">Checking against: {profile.conditions.join(', ')}</p>
              </div>
            )}

            <AnimatePresence>
              {checkResult && (
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="bg-surface border border-line rounded-xl overflow-hidden">
                  <div className="bg-primary px-4 py-3.5">
                    <p className="text-white font-bold text-base">{checkResult.name || checkName}</p>
                    <p className="text-blue-100 text-xs mt-0.5">Medicine Information</p>
                  </div>
                  <div className="p-4 space-y-3.5">
                    <InfoRow label="What it is"       value={checkResult.what_it_is} />
                    <InfoRow label="Common Uses"      value={checkResult.uses} />
                    <InfoRow label="Side Effects"     value={checkResult.side_effects} />
                    <InfoRow label="Drug Interactions" value={checkResult.interactions} />
                    <InfoRow label="Your Conditions"  value={checkResult.safe_for_conditions} />
                    <div className="bg-warning/8 border border-warning/20 rounded-lg px-3 py-2.5">
                      <p className="text-xs text-warning">⚠️ {checkResult.disclaimer || 'Always consult your doctor or pharmacist.'}</p>
                    </div>
                    <button onClick={() => { setForm({ name: checkResult.name || checkName, dosage: '', times: [] }); setActiveView('meds'); setShowForm(true); }}
                      className="w-full border border-primary/30 text-primary py-2.5 rounded-lg text-sm font-medium hover:bg-primary/5 transition-all">
                      + Add to My Medicines
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence>
              {scannedMeds.length > 0 && (
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
                  <p className="text-xs font-semibold text-ink-2">Found {scannedMeds.length} medicine(s)</p>
                  {scannedMeds.map((med, i) => (
                    <div key={i} className="bg-surface border border-line rounded-xl overflow-hidden">
                      <div className="bg-primary px-4 py-3 flex items-center justify-between">
                        <div>
                          <p className="text-white font-bold text-sm">{med.name}</p>
                          {med.dosage && <p className="text-blue-100 text-xs">{med.dosage}{med.frequency ? ` · ${med.frequency}` : ''}</p>}
                        </div>
                        <button onClick={() => { setForm({ name: med.name, dosage: med.dosage || '', times: [] }); setActiveView('meds'); setShowForm(true); }}
                          className="bg-white/20 hover:bg-white/30 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-all">
                          + Add
                        </button>
                      </div>
                      {(med.what_it_is || med.uses || med.side_effects || med.interactions) && (
                        <div className="p-3.5 space-y-2.5">
                          <InfoRow label="What it is"    value={med.what_it_is || ''} />
                          <InfoRow label="Uses"          value={med.uses || ''} />
                          <InfoRow label="Side Effects"  value={med.side_effects || ''} />
                          <InfoRow label="Interactions"  value={med.interactions || ''} />
                          {med.safe_note && (
                            <div className="bg-warning/8 border border-warning/20 rounded-lg px-3 py-2">
                              <p className="text-xs text-warning">⚠️ {med.safe_note}</p>
                            </div>
                          )}
                          {med.instructions && <p className="text-xs text-ink-3">📋 {med.instructions}</p>}
                        </div>
                      )}
                    </div>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Add medication sheet ──────────────────────────────────────────── */}
      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/30 z-50 flex items-end"
            onClick={e => e.target === e.currentTarget && setShowForm(false)}>
            <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 320 }}
              className="bg-surface rounded-t-2xl w-full p-5 space-y-4 border-t border-line">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-ink">Add Medicine</h3>
                <button onClick={() => setShowForm(false)} className="w-7 h-7 rounded-lg bg-surface-2 border border-line flex items-center justify-center text-ink-3 text-sm">✕</button>
              </div>
              <input placeholder="Medicine name" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                className="w-full bg-surface-2 border border-line rounded-lg px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition-all" />
              <input placeholder="Dosage (e.g. 500mg)" value={form.dosage} onChange={e => setForm(p => ({ ...p, dosage: e.target.value }))}
                className="w-full bg-surface-2 border border-line rounded-lg px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition-all" />
              <div>
                <p className="text-xs font-semibold text-ink-2 mb-2 uppercase tracking-widest">When to take</p>
                <div className="flex gap-2 flex-wrap">
                  {TIME_OPTIONS.map(t => (
                    <button key={t} onClick={() => toggleTime(t)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                        form.times.includes(t) ? 'bg-primary text-white border-primary' : 'bg-surface-2 text-ink-2 border-line'
                      }`}>{t}</button>
                  ))}
                </div>
              </div>
              <button onClick={() => addMed.mutate(form)} disabled={!form.name || form.times.length === 0 || addMed.isPending}
                className="btn w-full py-3">
                {addMed.isPending ? 'Saving...' : 'Save Medicine'}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
