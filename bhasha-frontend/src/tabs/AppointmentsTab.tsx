import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';
import { API_BASE, DEMO_USER_ID } from '../config';
import { loadProfile } from '../components/ProfileModal';

type CallStatus = 'idle' | 'initiating' | 'calling' | 'in_progress' | 'confirmed' | 'failed';

const STATUS_META: Record<CallStatus, { icon: string; label: string; color: string }> = {
  idle:        { icon: '📞', label: '',                                color: '' },
  initiating:  { icon: '📞', label: 'Initiating call to clinic...',   color: 'text-gray-700' },
  calling:     { icon: '📞', label: 'AI agent is calling the clinic...', color: 'text-primary' },
  in_progress: { icon: '🗣️', label: 'Message being delivered...',     color: 'text-primary' },
  confirmed:   { icon: '✅', label: 'Call completed!',                color: 'text-success' },
  failed:      { icon: '❌', label: 'Clinic did not answer',          color: 'text-danger' },
};

export default function AppointmentsTab() {
  const profile = loadProfile();

  const [form, setForm] = useState({
    doctorName:    '',
    clinicPhone:   '',
    preferredTime: '',
    patientName:   profile?.name || '',
    patientPhone:  '',
    symptoms:      '',
  });

  const [callStatus, setCallStatus]   = useState<CallStatus>('idle');
  const [callId, setCallId]           = useState<string | null>(null);
  const [callDuration, setCallDuration] = useState(0);
  const [errorMsg, setErrorMsg]       = useState('');

  const pollRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const maxPollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Live call timer
  useEffect(() => {
    if (callStatus === 'calling' || callStatus === 'in_progress') {
      timerRef.current = setInterval(() => setCallDuration(d => d + 1), 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [callStatus]);

  // Poll call status from backend
  useEffect(() => {
    if (!callId || callStatus === 'confirmed' || callStatus === 'failed') return;

    pollRef.current = setInterval(async () => {
      try {
        const { data } = await axios.get(`${API_BASE}/appointments/status/${callId}`);
        const s: CallStatus = data.status;
        if (['calling', 'in_progress', 'confirmed', 'failed'].includes(s)) {
          setCallStatus(s);
        }
        if (s === 'confirmed' || s === 'failed') {
          if (pollRef.current)    clearInterval(pollRef.current);
          if (maxPollRef.current) clearTimeout(maxPollRef.current);
        }
      } catch (e) {
        console.warn('Poll error:', e);
      }
    }, 3000);

    // Stop polling after 3 minutes maximum
    maxPollRef.current = setTimeout(() => {
      if (pollRef.current) clearInterval(pollRef.current);
      setCallStatus(s => (s === 'calling' || s === 'in_progress') ? 'failed' : s);
      setErrorMsg('Timed out waiting for call result.');
    }, 180_000);

    return () => {
      if (pollRef.current)    clearInterval(pollRef.current);
      if (maxPollRef.current) clearTimeout(maxPollRef.current);
    };
  }, [callId]);

  const bookAppointment = async () => {
    setCallStatus('initiating');
    setErrorMsg('');
    setCallDuration(0);
    try {
      const { data } = await axios.post(`${API_BASE}/appointments/book`, {
        ...form,
        userId: DEMO_USER_ID,
      });
      setCallId(data.callId);
      setCallStatus('calling');
    } catch (err: any) {
      setErrorMsg(err?.response?.data?.error || 'Failed to initiate call. Try again.');
      setCallStatus('failed');
    }
  };

  const reset = () => {
    if (pollRef.current)    clearInterval(pollRef.current);
    if (timerRef.current)   clearInterval(timerRef.current);
    if (maxPollRef.current) clearTimeout(maxPollRef.current);
    setCallStatus('idle');
    setCallId(null);
    setCallDuration(0);
    setErrorMsg('');
    setForm({
      doctorName: '', clinicPhone: '', preferredTime: '',
      patientName: profile?.name || '', patientPhone: '', symptoms: '',
    });
  };

  const fmtDuration = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const meta = STATUS_META[callStatus];

  return (
    <div className="px-4 py-4 space-y-4">
      <div>
        <h2 className="text-xl font-bold text-gray-900">Book Appointment</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          AI agent calls the clinic on your behalf and speaks to the receptionist
        </p>
      </div>

      <AnimatePresence mode="wait">

        {/* ── FORM ── */}
        {callStatus === 'idle' && (
          <motion.div key="form" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-3">
            <input
              placeholder="Doctor / Clinic name *"
              value={form.doctorName}
              onChange={e => setForm(p => ({ ...p, doctorName: e.target.value }))}
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm bg-white outline-none focus:border-primary"
            />
            <input
              placeholder="Clinic phone (+91XXXXXXXXXX) *"
              value={form.clinicPhone}
              onChange={e => setForm(p => ({ ...p, clinicPhone: e.target.value }))}
              type="tel"
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm bg-white outline-none focus:border-primary"
            />
            <input
              placeholder="Your name *"
              value={form.patientName}
              onChange={e => setForm(p => ({ ...p, patientName: e.target.value }))}
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm bg-white outline-none focus:border-primary"
            />
            <input
              placeholder="Your phone (clinic will call you back) *"
              value={form.patientPhone}
              onChange={e => setForm(p => ({ ...p, patientPhone: e.target.value }))}
              type="tel"
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm bg-white outline-none focus:border-primary"
            />
            <input
              placeholder="Preferred time (e.g. Tomorrow 5pm)"
              value={form.preferredTime}
              onChange={e => setForm(p => ({ ...p, preferredTime: e.target.value }))}
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm bg-white outline-none focus:border-primary"
            />
            <textarea
              placeholder="Symptoms or reason (optional)"
              value={form.symptoms}
              onChange={e => setForm(p => ({ ...p, symptoms: e.target.value }))}
              rows={2}
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm bg-white outline-none focus:border-primary resize-none"
            />

            <motion.button
              onClick={bookAppointment}
              disabled={!form.doctorName || !form.clinicPhone || !form.patientName || !form.patientPhone}
              className="w-full bg-primary text-white py-4 rounded-2xl font-semibold text-base disabled:opacity-50 flex items-center justify-center gap-2"
              whileTap={{ scale: 0.98 }}
            >
              <span>📞</span> Call Clinic via AI Agent
            </motion.button>

            <p className="text-center text-xs text-gray-400">
              Our AI speaks to the receptionist — the clinic calls you back to confirm
            </p>
          </motion.div>
        )}

        {/* ── ACTIVE CALL ── */}
        {(callStatus === 'initiating' || callStatus === 'calling' || callStatus === 'in_progress') && (
          <motion.div
            key="calling"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="bg-white rounded-2xl p-6 shadow-sm space-y-6"
          >
            {/* Animated phone icon */}
            <div className="flex flex-col items-center gap-3">
              <div className="relative">
                <motion.div
                  className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center"
                  animate={{ scale: [1, 1.08, 1] }}
                  transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
                >
                  <span className="text-4xl">{meta.icon}</span>
                </motion.div>
                {/* Pulse rings */}
                {(callStatus === 'calling' || callStatus === 'in_progress') && (
                  <>
                    <motion.div
                      className="absolute inset-0 rounded-full border-2 border-primary/30"
                      animate={{ scale: [1, 1.6], opacity: [0.6, 0] }}
                      transition={{ duration: 1.4, repeat: Infinity }}
                    />
                    <motion.div
                      className="absolute inset-0 rounded-full border-2 border-primary/20"
                      animate={{ scale: [1, 2], opacity: [0.4, 0] }}
                      transition={{ duration: 1.4, repeat: Infinity, delay: 0.4 }}
                    />
                  </>
                )}
              </div>

              <p className={`font-semibold text-base text-center ${meta.color}`}>{meta.label}</p>

              {callStatus !== 'initiating' && (
                <p className="text-xs text-gray-400 font-mono">{fmtDuration(callDuration)}</p>
              )}
            </div>

            {/* Call details */}
            <div className="bg-gray-50 rounded-xl p-3 space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Calling</span>
                <span className="font-medium text-gray-900">{form.doctorName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Number</span>
                <span className="font-medium text-gray-900 font-mono">{form.clinicPhone}</span>
              </div>
              {form.preferredTime && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Requesting</span>
                  <span className="font-medium text-gray-900">{form.preferredTime}</span>
                </div>
              )}
            </div>

            {/* What the AI will say */}
            <div className="bg-blue-50 rounded-xl p-3">
              <p className="text-xs font-semibold text-blue-700 mb-1">AI agent script</p>
              <p className="text-xs text-blue-600 leading-relaxed">
                "Hello, this is Bhasha AI calling on behalf of <strong>{form.patientName}</strong> to request
                an appointment with <strong>{form.doctorName}</strong>
                {form.preferredTime ? ` for ${form.preferredTime}` : ''}.
                {form.symptoms ? ` The patient is experiencing: ${form.symptoms}.` : ''}
                {form.patientPhone ? ` Please call back at ${form.patientPhone} to confirm.` : ''}"
              </p>
            </div>

            <p className="text-xs text-gray-400 text-center">
              Please keep your phone available — the clinic will call you to confirm
            </p>
          </motion.div>
        )}

        {/* ── CONFIRMED ── */}
        {callStatus === 'confirmed' && (
          <motion.div
            key="confirmed"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className="space-y-3"
          >
            <div className="bg-white rounded-2xl p-5 shadow-sm space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-success/10 rounded-2xl flex items-center justify-center text-2xl">✅</div>
                <div>
                  <p className="font-bold text-gray-900">AI call completed!</p>
                  <p className="text-xs text-gray-500">Message delivered to {form.doctorName}'s clinic</p>
                </div>
              </div>

              <div className="bg-gray-50 rounded-xl p-3 space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Doctor</span>
                  <span className="font-medium">{form.doctorName}</span>
                </div>
                {form.preferredTime && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Requested time</span>
                    <span className="font-medium">{form.preferredTime}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-gray-500">Call duration</span>
                  <span className="font-medium font-mono">{fmtDuration(callDuration)}</span>
                </div>
              </div>

              <div className="bg-success/10 rounded-xl px-4 py-3 text-sm text-success font-medium text-center">
                📱 Clinic will call you at {form.patientPhone} to confirm
              </div>
            </div>

            <button onClick={reset} className="w-full border border-gray-200 py-3 rounded-xl text-sm font-medium text-gray-600 bg-white">
              Book Another Appointment
            </button>
          </motion.div>
        )}

        {/* ── FAILED ── */}
        {callStatus === 'failed' && (
          <motion.div
            key="failed"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="bg-white rounded-2xl p-6 shadow-sm space-y-4"
          >
            <div className="text-center space-y-2">
              <div className="text-4xl">📵</div>
              <p className="font-semibold text-danger">Clinic did not answer</p>
              {errorMsg && <p className="text-xs text-gray-500">{errorMsg}</p>}
              {!errorMsg && (
                <p className="text-xs text-gray-500">
                  The clinic may be busy. Try calling directly or book again later.
                </p>
              )}
            </div>

            <div className="flex gap-2">
              <button
                onClick={reset}
                className="flex-1 border border-gray-200 py-3 rounded-xl text-sm font-medium text-gray-600"
              >
                Try Again
              </button>
              {form.clinicPhone && (
                <a
                  href={`tel:${form.clinicPhone}`}
                  className="flex-1 bg-primary text-white py-3 rounded-xl text-sm font-medium text-center"
                >
                  📞 Call Directly
                </a>
              )}
            </div>
          </motion.div>
        )}

      </AnimatePresence>
    </div>
  );
}
