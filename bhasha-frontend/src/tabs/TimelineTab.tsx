import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';
import { API_BASE, DEMO_USER_ID } from '../config';

const SEVERITY_STYLE: Record<number, { bg: string; text: string; label: string }> = {
  1:  { bg: 'bg-emerald-50',  text: 'text-emerald-600', label: 'Mild' },
  2:  { bg: 'bg-emerald-50',  text: 'text-emerald-600', label: 'Mild' },
  3:  { bg: 'bg-yellow-50',   text: 'text-yellow-700',  label: 'Low' },
  4:  { bg: 'bg-yellow-50',   text: 'text-yellow-700',  label: 'Low' },
  5:  { bg: 'bg-orange-50',   text: 'text-orange-600',  label: 'Moderate' },
  6:  { bg: 'bg-orange-50',   text: 'text-orange-600',  label: 'Moderate' },
  7:  { bg: 'bg-red-50',      text: 'text-red-600',     label: 'High' },
  8:  { bg: 'bg-red-50',      text: 'text-red-600',     label: 'High' },
  9:  { bg: 'bg-red-100',     text: 'text-red-700',     label: 'Severe' },
  10: { bg: 'bg-red-100',     text: 'text-red-700',     label: 'Severe' },
};

export default function TimelineTab() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form,     setForm]     = useState({ description: '', severity: 5 });

  const { data: logs = [] } = useQuery({
    queryKey: ['health-logs'],
    queryFn: async () => {
      const { data } = await axios.get(`${API_BASE}/health/logs?userId=${DEMO_USER_ID}`);
      return data.logs;
    },
  });

  const addLog = useMutation({
    mutationFn: () => axios.post(`${API_BASE}/health/logs`, { userId: DEMO_USER_ID, type: 'symptom', ...form }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['health-logs'] }); setShowForm(false); setForm({ description: '', severity: 5 }); },
  });

  const sevStyle = SEVERITY_STYLE[form.severity] ?? SEVERITY_STYLE[5];

  return (
    <div className="px-4 py-4 space-y-4">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-xl font-bold text-ink tracking-tight">Health Timeline</h2>
          <p className="text-xs text-ink-3 mt-0.5">{logs.length} entr{logs.length !== 1 ? 'ies' : 'y'} logged</p>
        </div>
        <button onClick={() => setShowForm(!showForm)} className="btn text-sm px-3 py-2">
          {showForm ? 'Cancel' : '+ Log'}
        </button>
      </div>

      {/* ── Log form ────────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            className="bg-surface border border-line rounded-xl p-4 space-y-4 overflow-hidden">
            <textarea placeholder="Describe your symptom or how you're feeling..."
              value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
              rows={3}
              className="w-full bg-surface-2 border border-line rounded-lg px-3 py-2.5 text-sm text-ink placeholder:text-ink-3 outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition-all resize-none" />
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-ink-2 uppercase tracking-widest">Severity</p>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${sevStyle.bg} ${sevStyle.text}`}>
                  {form.severity}/10 — {sevStyle.label}
                </span>
              </div>
              <input type="range" min={1} max={10} value={form.severity}
                onChange={e => setForm(p => ({ ...p, severity: Number(e.target.value) }))}
                className="w-full accent-primary" />
            </div>
            <button onClick={() => addLog.mutate()} disabled={!form.description || addLog.isPending}
              className="btn w-full py-2.5">
              {addLog.isPending ? 'Saving...' : 'Save Entry'}
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Timeline list ───────────────────────────────────────────────────── */}
      {logs.length === 0 ? (
        <div className="text-center py-16 space-y-3">
          <p className="text-4xl">📋</p>
          <p className="text-ink-2 text-sm">No health entries yet</p>
          <button onClick={() => setShowForm(true)} className="text-primary text-sm font-medium">
            Log your first entry →
          </button>
        </div>
      ) : (
        <div className="relative">
          {/* Vertical timeline line */}
          <div className="absolute left-[19px] top-3 bottom-3 w-px bg-line" />

          <div className="space-y-3">
            {logs.map((log: any, i: number) => {
              const sev   = SEVERITY_STYLE[log.severity] ?? null;
              const date  = new Date(log.timestamp || Date.now());
              return (
                <motion.div key={log.logId || i} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.04 }} className="flex gap-3">
                  {/* Timeline dot */}
                  <div className="flex flex-col items-center flex-shrink-0 pt-3.5">
                    <div className={`w-2.5 h-2.5 rounded-full ring-2 ring-base z-10 ${sev ? sev.bg : 'bg-primary/30'}`} />
                  </div>

                  {/* Entry card */}
                  <div className="flex-1 bg-surface border border-line rounded-xl p-3.5 mb-0.5">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-2xs text-ink-3">
                        {date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}{' · '}
                        {date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      {log.severity && sev && (
                        <span className={`text-2xs font-semibold px-1.5 py-0.5 rounded-full ${sev.bg} ${sev.text}`}>
                          {sev.label} {log.severity}/10
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-ink leading-relaxed">{log.description}</p>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
