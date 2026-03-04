import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';
import { API_BASE } from '../config';
import { loadProfile } from '../components/ProfileModal';

type Phase = 'search' | 'results' | 'form';

type Hospital = {
  name: string;
  address: string;
  distance_km: number;
  lat: number;
  lng: number;
  type: string;
  phone?: string;
  emergency: boolean;
};

type BookingPrefill = { doctorName: string; preferredTime: string; patientPhone: string; clinicPhone?: string };

const QUICK_CONDITIONS = [
  'Fever & cold', 'Back pain', 'Diabetes check',
  'Eye checkup', 'Dental', 'Skin problem',
];

const getUserLocation = (): Promise<{ lat: number; lng: number }> =>
  new Promise(resolve => {
    if (!navigator.geolocation) return resolve({ lat: 28.6139, lng: 77.209 });
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      ()  => resolve({ lat: 28.6139, lng: 77.209 }),
      { timeout: 6000 }
    );
  });

export default function AppointmentsTab({ prefill, onPrefillUsed }: { prefill?: BookingPrefill; onPrefillUsed?: () => void }) {
  const profile = loadProfile();

  const [phase,          setPhase]          = useState<Phase>('search');
  const [conditionQuery, setConditionQuery] = useState('');
  const [searching,      setSearching]      = useState(false);
  const [suggestions,    setSuggestions]    = useState<Hospital[]>([]);
  const [searchError,    setSearchError]    = useState('');
  const [scriptCopied,   setScriptCopied]   = useState(false);
  const [called,         setCalled]         = useState(false);

  const [form, setForm] = useState({
    doctorName:    '',
    clinicPhone:   '',
    preferredTime: '',
    patientName:   profile?.name  || '',
    patientPhone:  profile?.phone || '',
    symptoms:      '',
  });

  // Prefill from HospitalTab or VoiceTab → skip straight to form
  useEffect(() => {
    if (!prefill) return;
    setForm(prev => ({
      ...prev,
      doctorName:    prefill.doctorName    || prev.doctorName,
      clinicPhone:   prefill.clinicPhone   || prev.clinicPhone,
      preferredTime: prefill.preferredTime || prev.preferredTime,
      patientPhone:  prefill.patientPhone  || prev.patientPhone || profile?.phone || '',
      patientName:   prev.patientName      || profile?.name || '',
    }));
    setPhase('form');
    onPrefillUsed?.();
  }, [prefill]);

  const findDoctor = async () => {
    if (!conditionQuery.trim()) return;
    setSearching(true);
    setSearchError('');
    const loc = await getUserLocation();
    try {
      const { data } = await axios.get(
        `${API_BASE}/hospitals/nearby?lat=${loc.lat}&lng=${loc.lng}&radius=10&condition=${encodeURIComponent(conditionQuery)}`
      );
      const results: Hospital[] = (data.hospitals || []).slice(0, 3);
      setSuggestions(results);
      setPhase('results');
    } catch {
      setSearchError('Could not find nearby doctors. Fill in details manually below.');
      setForm(prev => ({ ...prev, symptoms: conditionQuery }));
      setPhase('form');
    } finally {
      setSearching(false);
    }
  };

  const selectHospital = (h: Hospital) => {
    setForm(prev => ({
      ...prev,
      doctorName:  h.name,
      clinicPhone: h.phone || '',
      symptoms:    conditionQuery,
    }));
    setPhase('form');
  };

  const callScript = `Hello, I'd like to book an appointment${form.doctorName ? ` at ${form.doctorName}` : ''}. My name is ${form.patientName || '___'}${form.preferredTime ? `, my preferred time is ${form.preferredTime}` : ''}${form.symptoms ? `. Reason: ${form.symptoms}` : ''}. Please call me back on ${form.patientPhone || '___'} to confirm. Thank you.`;

  const reset = () => {
    setPhase('search');
    setConditionQuery('');
    setSuggestions([]);
    setSearchError('');
    setCalled(false);
    setScriptCopied(false);
    setForm({ doctorName: '', clinicPhone: '', preferredTime: '', patientName: profile?.name || '', patientPhone: '', symptoms: '' });
  };

  return (
    <div className="px-4 py-4 pb-10 space-y-4">

      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-ink">Book Appointment</h2>
        <p className="text-sm text-ink-3 mt-0.5">AI finds the best doctor nearby, you make the call</p>
      </div>

      <AnimatePresence mode="wait">

        {/* ── PHASE 1: Search ── */}
        {phase === 'search' && (
          <motion.div key="search" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4">

            {/* How it works */}
            <div className="bg-primary/8 border border-primary/20 rounded-2xl p-4 space-y-2.5">
              <p className="text-xs font-bold text-primary uppercase tracking-wider">How it works</p>
              {[
                { icon: '🔍', text: 'Tell us your condition — AI finds best nearby doctor' },
                { icon: '📋', text: 'We prepare a ready-to-use call script for you' },
                { icon: '📞', text: 'You call directly from your phone — takes 30 seconds' },
              ].map((s, i) => (
                <div key={i} className="flex items-start gap-3">
                  <span className="text-lg flex-shrink-0">{s.icon}</span>
                  <p className="text-sm text-ink-2">{s.text}</p>
                </div>
              ))}
            </div>

            {/* Condition input */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-ink-3 uppercase tracking-wider">What do you need a doctor for?</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="e.g. fever, knee pain, diabetes..."
                  value={conditionQuery}
                  onChange={e => setConditionQuery(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && findDoctor()}
                  className="flex-1 bg-surface border border-line rounded-xl px-4 py-3 text-sm text-ink outline-none focus:border-primary placeholder:text-ink-3"
                />
                <motion.button
                  onClick={findDoctor}
                  disabled={!conditionQuery.trim() || searching}
                  whileTap={{ scale: 0.96 }}
                  className="bg-primary text-white px-4 py-3 rounded-xl font-semibold text-sm disabled:opacity-40 flex items-center gap-1.5 flex-shrink-0"
                >
                  {searching ? (
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : '🔍'}
                  {searching ? '' : 'Find'}
                </motion.button>
              </div>
            </div>

            {/* Quick condition chips */}
            <div className="space-y-2">
              <p className="text-2xs text-ink-3 font-medium">Quick select</p>
              <div className="flex flex-wrap gap-2">
                {QUICK_CONDITIONS.map(c => (
                  <button key={c}
                    onClick={() => { setConditionQuery(c); }}
                    className="text-xs bg-surface-2 border border-line text-ink-2 px-3 py-1.5 rounded-full font-medium active:scale-95 transition-all">
                    {c}
                  </button>
                ))}
              </div>
            </div>

            {/* Skip to manual form */}
            <button onClick={() => setPhase('form')} className="w-full text-sm text-ink-3 py-2 underline underline-offset-2">
              I already know the doctor → Fill manually
            </button>
          </motion.div>
        )}

        {/* ── PHASE 2: AI Results ── */}
        {phase === 'results' && (
          <motion.div key="results" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-4">

            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-ink-3 uppercase tracking-wider">Best matches for</p>
                <p className="font-bold text-ink">"{conditionQuery}"</p>
              </div>
              <button onClick={() => setPhase('search')} className="text-xs text-ink-3 border border-line px-3 py-1.5 rounded-lg">← Back</button>
            </div>

            <div className="space-y-2.5">
              {suggestions.length === 0 ? (
                <div className="text-center py-8 space-y-2">
                  <span className="text-3xl">🏥</span>
                  <p className="text-ink-2 text-sm">No results found nearby</p>
                  <button onClick={() => setPhase('form')} className="text-primary text-sm underline">Fill details manually</button>
                </div>
              ) : (
                suggestions.map((h, i) => (
                  <motion.button
                    key={i}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.08 }}
                    onClick={() => selectHospital(h)}
                    className="w-full bg-surface border border-line rounded-2xl p-4 text-left active:scale-[0.98] transition-all hover:border-primary"
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-9 h-9 bg-primary/10 border border-primary/20 rounded-xl flex items-center justify-center text-lg flex-shrink-0 mt-0.5">
                        {i === 0 ? '🏆' : i === 1 ? '🥈' : '🏥'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-semibold text-ink text-sm truncate">{h.name}</p>
                            <p className="text-xs text-ink-3 mt-0.5 truncate">{h.address}</p>
                          </div>
                          <span className="text-xs font-bold text-primary flex-shrink-0">{h.distance_km.toFixed(1)} km</span>
                        </div>
                        <div className="flex items-center gap-2 mt-2">
                          {i === 0 && <span className="text-2xs bg-success/10 border border-success/20 text-success px-2 py-0.5 rounded-full font-semibold">Best Match</span>}
                          {h.emergency && <span className="text-2xs bg-danger/8 border border-danger/15 text-danger px-2 py-0.5 rounded-full font-semibold">🚨 Emergency</span>}
                          <span className="text-2xs text-ink-3 ml-auto font-medium">Tap to select →</span>
                        </div>
                      </div>
                    </div>
                  </motion.button>
                ))
              )}
            </div>

            <button onClick={() => setPhase('form')} className="w-full text-sm text-ink-3 border border-line bg-surface py-3 rounded-xl">
              None of these — Fill manually
            </button>
          </motion.div>
        )}

        {/* ── PHASE 3: Form + Call ── */}
        {phase === 'form' && (
          <motion.div key="form" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-4">

            {!called ? (
              <>
                {searchError && (
                  <div className="bg-warning/8 border border-warning/20 rounded-xl px-3.5 py-2.5 text-xs text-ink-2">{searchError}</div>
                )}

                {/* Back link (if came from search) */}
                {conditionQuery && (
                  <button onClick={() => setPhase('results')} className="text-xs text-ink-3">← Back to results</button>
                )}

                {/* Hospital/Doctor found badge */}
                {form.doctorName && (
                  <div className="bg-success/8 border border-success/20 rounded-xl px-3.5 py-3 flex items-center gap-2">
                    <span className="text-success">✓</span>
                    <p className="text-sm text-success font-semibold">{form.doctorName} selected</p>
                  </div>
                )}

                {/* Form fields */}
                <div className="space-y-2.5">
                  <p className="text-xs font-semibold text-ink-3 uppercase tracking-wider">Appointment Details</p>
                  {[
                    { placeholder: 'Doctor / Hospital name *', key: 'doctorName', type: 'text' },
                    { placeholder: 'Clinic phone number *', key: 'clinicPhone', type: 'tel' },
                    { placeholder: 'Your full name *', key: 'patientName', type: 'text' },
                    { placeholder: 'Your phone (so they can call back) *', key: 'patientPhone', type: 'tel' },
                    { placeholder: 'Preferred time (e.g. Tomorrow 5 PM)', key: 'preferredTime', type: 'text' },
                  ].map(({ placeholder, key, type }) => (
                    <input key={key}
                      type={type}
                      placeholder={placeholder}
                      value={(form as any)[key]}
                      onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))}
                      className="w-full bg-surface border border-line rounded-xl px-4 py-3 text-sm text-ink outline-none focus:border-primary placeholder:text-ink-3"
                    />
                  ))}
                  <textarea
                    placeholder="Reason / symptoms (optional)"
                    value={form.symptoms}
                    onChange={e => setForm(p => ({ ...p, symptoms: e.target.value }))}
                    rows={2}
                    className="w-full bg-surface border border-line rounded-xl px-4 py-3 text-sm text-ink outline-none focus:border-primary placeholder:text-ink-3 resize-none"
                  />
                </div>

                {/* Script card */}
                {form.patientName && (
                  <div className="bg-surface-2 border border-line rounded-xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold text-ink uppercase tracking-wide">📋 Your Call Script</p>
                      <button
                        onClick={() => navigator.clipboard.writeText(callScript).then(() => { setScriptCopied(true); setTimeout(() => setScriptCopied(false), 2000); })}
                        className={`text-xs font-semibold px-2.5 py-1 rounded-lg border transition-all ${scriptCopied ? 'bg-success/10 border-success/20 text-success' : 'border-line text-ink-2'}`}
                      >
                        {scriptCopied ? '✓ Copied' : 'Copy'}
                      </button>
                    </div>
                    <p className="text-sm text-ink-2 leading-relaxed bg-surface border border-line rounded-lg px-3 py-2.5 italic">
                      "{callScript}"
                    </p>
                    <p className="text-2xs text-ink-3">Read this when the receptionist picks up — takes about 20 seconds</p>
                  </div>
                )}

                {/* Call button */}
                <a
                  href={form.clinicPhone ? `tel:${form.clinicPhone}` : '#'}
                  onClick={() => form.clinicPhone && setCalled(true)}
                  className={`w-full py-4 rounded-2xl font-bold text-base flex items-center justify-center gap-2 transition-all
                    ${form.clinicPhone && form.patientName
                      ? 'bg-success text-white active:scale-[0.98]'
                      : 'bg-surface-2 border border-line text-ink-3 pointer-events-none'}`}
                >
                  📞 Call {form.doctorName ? form.doctorName.split(' ').slice(0, 3).join(' ') : 'Clinic'} Now
                </a>

                {(!form.clinicPhone || !form.patientName) && (
                  <p className="text-center text-xs text-ink-3">Fill in clinic phone and your name to continue</p>
                )}

                <button onClick={reset} className="w-full text-xs text-ink-3 py-2">← Start over</button>
              </>
            ) : (
              /* After calling */
              <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="space-y-3">
                <div className="bg-surface border border-line rounded-2xl p-5 space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 bg-success/10 border border-success/20 rounded-2xl flex items-center justify-center text-2xl">📞</div>
                    <div>
                      <p className="font-bold text-ink">Call placed!</p>
                      <p className="text-xs text-ink-3">Calling {form.doctorName}</p>
                    </div>
                  </div>

                  <div className="bg-primary/8 border border-primary/20 rounded-xl px-3.5 py-3 space-y-1.5">
                    <p className="text-xs font-semibold text-primary">After the call</p>
                    {[
                      'Tell them your name and preferred time',
                      'Note down the appointment date & time',
                      'Ask if they need any documents or tests',
                      'Save the clinic number for follow-up',
                    ].map((tip, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <span className="text-primary text-xs mt-0.5">•</span>
                        <p className="text-xs text-ink-2">{tip}</p>
                      </div>
                    ))}
                  </div>

                  {/* Call again button */}
                  <a href={`tel:${form.clinicPhone}`}
                    className="w-full bg-surface-2 border border-line py-3 rounded-xl text-sm font-medium text-ink-2 flex items-center justify-center gap-2">
                    📞 Call Again
                  </a>
                </div>

                <button onClick={reset}
                  className="w-full border border-line py-3 rounded-xl text-sm font-medium text-ink-2 bg-surface active:scale-[0.98] transition-all">
                  Book Another Appointment
                </button>
              </motion.div>
            )}
          </motion.div>
        )}

      </AnimatePresence>
    </div>
  );
}
