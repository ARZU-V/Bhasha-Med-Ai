import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';
import { API_BASE, DEMO_USER_ID } from '../config';
import { loadProfile } from '../components/ProfileModal';

type Medication = {
  medicationId: string;
  name: string;
  dosage: string;
  times: string[];
  takenToday?: boolean;
};

type MedicineInfo = {
  what_it_is: string;
  uses: string;
  side_effects: string;
  interactions: string;
  safe_for_conditions: string;
  disclaimer: string;
  name?: string;
};

type ScannedMed = { name: string; dosage: string; timing: string };

const TIME_OPTIONS = ['Morning (8 AM)', 'Afternoon (2 PM)', 'Night (9 PM)'];
const MED_COLORS = [
  'bg-blue-100 text-blue-700',
  'bg-purple-100 text-purple-700',
  'bg-green-100 text-green-700',
  'bg-orange-100 text-orange-700',
];

function InfoRow({ icon, label, value }: { icon: string; label: string; value: string }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
        {icon} {label}
      </p>
      <p className="text-sm text-gray-800 leading-relaxed">{value}</p>
    </div>
  );
}

export default function MedicationsTab() {
  const queryClient = useQueryClient();
  const profile = loadProfile();
  const [activeView, setActiveView] = useState<'meds' | 'check'>('meds');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', dosage: '', times: [] as string[] });

  // Medicine checker state
  const [checkName, setCheckName] = useState('');
  const [checkResult, setCheckResult] = useState<MedicineInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scannedMeds, setScannedMeds] = useState<ScannedMed[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: meds = [], isLoading } = useQuery({
    queryKey: ['medications'],
    queryFn: async () => {
      const { data } = await axios.get(`${API_BASE}/medications?userId=${DEMO_USER_ID}`);
      return (data.medications ?? []) as Medication[];
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
        userId: DEMO_USER_ID,
        takenAt: new Date().toISOString(),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['medications'] }),
  });

  const toggleTime = (t: string) => {
    setForm(prev => ({
      ...prev,
      times: prev.times.includes(t) ? prev.times.filter(x => x !== t) : [...prev.times, t],
    }));
  };

  const checkMedicine = async () => {
    if (!checkName.trim()) return;
    setChecking(true);
    setCheckResult(null);
    try {
      const { data } = await axios.post(`${API_BASE}/medicine/check`, {
        medicineName: checkName,
        userId: DEMO_USER_ID,
        userConditions: profile?.conditions || [],
      });
      setCheckResult(data.info);
    } catch {
      setCheckResult({
        what_it_is: 'Could not fetch medicine information.',
        uses: 'Please try again or consult your pharmacist.',
        side_effects: '',
        interactions: '',
        safe_for_conditions: '',
        disclaimer: 'Always consult your doctor or pharmacist.',
        name: checkName,
      });
    } finally {
      setChecking(false);
    }
  };

  const handleScanImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setScanning(true);
    setScannedMeds([]);

    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = (reader.result as string).split(',')[1];
      try {
        const { data } = await axios.post(`${API_BASE}/medicine/scan`, {
          imageBase64: base64,
          userId: DEMO_USER_ID,
          userConditions: profile?.conditions || [],
        });
        setScannedMeds(data.medicines || []);
      } catch {
        setScannedMeds([{ name: 'Could not read prescription', dosage: '', timing: 'Please try a clearer image' }]);
      } finally {
        setScanning(false);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  return (
    <div className="px-4 py-4 space-y-4">
      {/* Segmented Control */}
      <div className="bg-gray-100 rounded-2xl p-1 flex">
        <button
          onClick={() => setActiveView('meds')}
          className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-all ${
            activeView === 'meds' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
          }`}
        >
          💊 My Medicines
        </button>
        <button
          onClick={() => setActiveView('check')}
          className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-all ${
            activeView === 'check' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
          }`}
        >
          🔬 Check Medicine
        </button>
      </div>

      {/* ── MY MEDS VIEW ─────────────────────────────────────────────────── */}
      <AnimatePresence mode="wait">
        {activeView === 'meds' && (
          <motion.div key="meds" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} className="space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-xl font-bold text-gray-900">My Medicines</h2>
              <button onClick={() => setShowForm(true)} className="bg-primary text-white px-4 py-2 rounded-xl text-sm font-medium">+ Add</button>
            </div>

            {meds.some(m => !m.takenToday) && meds.length > 0 && (
              <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="bg-warning/10 border border-warning/20 rounded-2xl p-4 flex items-center gap-3">
                <span className="text-2xl">⏰</span>
                <div>
                  <p className="font-semibold text-gray-900 text-sm">Reminder</p>
                  <p className="text-xs text-gray-600">You have medicines to take today</p>
                </div>
              </motion.div>
            )}

            {isLoading ? (
              <div className="space-y-3">{[1, 2, 3].map(i => <div key={i} className="bg-white rounded-2xl p-4 animate-pulse h-24" />)}</div>
            ) : meds.length === 0 ? (
              <div className="text-center py-16">
                <span className="text-6xl">💊</span>
                <p className="mt-4 text-gray-500">No medicines added yet</p>
                <button onClick={() => setShowForm(true)} className="mt-4 text-primary text-sm font-medium">Add your first medicine →</button>
              </div>
            ) : (
              <div className="space-y-3">
                {meds.map((med, i) => (
                  <motion.div key={med.medicationId} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }} className="bg-white rounded-2xl p-4 shadow-sm">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-lg ${MED_COLORS[i % MED_COLORS.length]}`}>💊</div>
                        <div>
                          <p className="font-semibold text-gray-900">{med.name}</p>
                          <p className="text-sm text-gray-500">{med.dosage}</p>
                          <div className="flex gap-1 mt-1 flex-wrap">
                            {med.times.map(t => <span key={t} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{t}</span>)}
                          </div>
                        </div>
                      </div>
                      <button onClick={() => markTaken.mutate(med.medicationId)} className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${med.takenToday ? 'bg-success/10 text-success' : 'bg-primary text-white'}`}>
                        {med.takenToday ? '✓ Taken' : 'Take Now'}
                      </button>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </motion.div>
        )}

        {/* ── CHECK MEDICINE VIEW ───────────────────────────────────────────── */}
        {activeView === 'check' && (
          <motion.div key="check" initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 8 }} className="space-y-4">
            <div>
              <h2 className="text-xl font-bold text-gray-900">Check Medicine</h2>
              <p className="text-xs text-gray-500 mt-0.5">Type a name or scan a prescription photo</p>
            </div>

            {/* Text search */}
            <div className="flex gap-2">
              <input
                placeholder="Type medicine name (e.g. Metformin)"
                value={checkName}
                onChange={e => setCheckName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && checkMedicine()}
                className="flex-1 border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-primary bg-white"
              />
              <button onClick={checkMedicine} disabled={!checkName.trim() || checking} className="bg-primary text-white px-4 py-3 rounded-xl text-sm font-medium disabled:opacity-50">
                {checking ? '...' : 'Check'}
              </button>
            </div>

            {/* Scan image */}
            <div>
              <input ref={fileInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleScanImage} />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={scanning}
                className="w-full border-2 border-dashed border-gray-200 rounded-2xl py-5 flex flex-col items-center gap-2 text-gray-500 hover:border-primary hover:text-primary transition-all disabled:opacity-50"
              >
                <span className="text-3xl">{scanning ? '⏳' : '📷'}</span>
                <span className="text-sm font-medium">{scanning ? 'Scanning prescription...' : 'Scan Prescription / Medicine Strip'}</span>
                <span className="text-xs text-gray-400">Take photo or upload image</span>
              </button>
            </div>

            {profile?.conditions && profile.conditions.length > 0 && (
              <div className="bg-blue-50 rounded-xl px-4 py-3 flex items-start gap-2">
                <span className="text-sm">ℹ️</span>
                <p className="text-xs text-blue-700">Checking against your conditions: {profile.conditions.join(', ')}</p>
              </div>
            )}

            {/* Check result */}
            <AnimatePresence>
              {checkResult && (
                <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="bg-white rounded-2xl shadow-sm overflow-hidden">
                  <div className="bg-primary px-5 py-4">
                    <p className="text-white font-bold text-base">{checkResult.name || checkName}</p>
                    <p className="text-blue-100 text-xs mt-0.5">Medicine Information</p>
                  </div>
                  <div className="p-5 space-y-4">
                    <InfoRow icon="💊" label="What it is" value={checkResult.what_it_is} />
                    <InfoRow icon="✅" label="Common Uses" value={checkResult.uses} />
                    <InfoRow icon="⚠️" label="Side Effects" value={checkResult.side_effects} />
                    <InfoRow icon="🔗" label="Drug Interactions" value={checkResult.interactions} />
                    <InfoRow icon="🩺" label="Your Conditions" value={checkResult.safe_for_conditions} />
                    <div className="bg-yellow-50 border border-yellow-200 rounded-xl px-4 py-3">
                      <p className="text-xs text-yellow-800">⚠️ {checkResult.disclaimer || 'This is informational only. Always consult your doctor or pharmacist.'}</p>
                    </div>
                    <button
                      onClick={() => { setForm({ name: checkResult.name || checkName, dosage: '', times: [] }); setActiveView('meds'); setShowForm(true); }}
                      className="w-full bg-primary/10 text-primary py-3 rounded-xl text-sm font-medium"
                    >
                      + Add to My Medicines
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Scanned medicines */}
            <AnimatePresence>
              {scannedMeds.length > 0 && (
                <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
                  <p className="text-sm font-semibold text-gray-700">📋 Found {scannedMeds.length} medicine(s):</p>
                  {scannedMeds.map((med, i) => (
                    <div key={i} className="bg-white rounded-2xl p-4 shadow-sm flex items-center justify-between">
                      <div>
                        <p className="font-semibold text-gray-900 text-sm">{med.name}</p>
                        {med.dosage && <p className="text-xs text-gray-500">{med.dosage}</p>}
                        {med.timing && <p className="text-xs text-gray-400">{med.timing}</p>}
                      </div>
                      <button
                        onClick={() => { setForm({ name: med.name, dosage: med.dosage, times: [] }); setActiveView('meds'); setShowForm(true); }}
                        className="bg-primary text-white px-3 py-1.5 rounded-xl text-xs font-medium"
                      >
                        + Add
                      </button>
                    </div>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Add medication modal */}
      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/40 z-50 flex items-end" onClick={e => e.target === e.currentTarget && setShowForm(false)}>
            <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', damping: 25 }} className="bg-white rounded-t-3xl w-full p-6 space-y-4">
              <h3 className="text-lg font-bold text-gray-900">Add Medicine</h3>
              <input placeholder="Medicine name" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-primary" />
              <input placeholder="Dosage (e.g. 500mg)" value={form.dosage} onChange={e => setForm(p => ({ ...p, dosage: e.target.value }))} className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-primary" />
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">When to take:</p>
                <div className="flex gap-2 flex-wrap">
                  {TIME_OPTIONS.map(t => (
                    <button key={t} onClick={() => toggleTime(t)} className={`px-3 py-2 rounded-xl text-sm font-medium transition-all ${form.times.includes(t) ? 'bg-primary text-white' : 'bg-gray-100 text-gray-600'}`}>{t}</button>
                  ))}
                </div>
              </div>
              <button onClick={() => addMed.mutate(form)} disabled={!form.name || form.times.length === 0 || addMed.isPending} className="w-full bg-primary text-white py-4 rounded-2xl font-semibold disabled:opacity-50">
                {addMed.isPending ? 'Saving...' : 'Save Medicine'}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
