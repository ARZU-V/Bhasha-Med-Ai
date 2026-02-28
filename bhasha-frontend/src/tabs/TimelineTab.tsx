import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import axios from 'axios';
import { API_BASE, DEMO_USER_ID } from '../config';

const SEVERITY_COLOR: Record<number, string> = {
  1: 'bg-green-100 text-green-700',
  2: 'bg-green-100 text-green-700',
  3: 'bg-yellow-100 text-yellow-700',
  4: 'bg-yellow-100 text-yellow-700',
  5: 'bg-orange-100 text-orange-700',
  6: 'bg-orange-100 text-orange-700',
  7: 'bg-red-100 text-red-700',
  8: 'bg-red-100 text-red-700',
  9: 'bg-red-200 text-red-800',
  10: 'bg-red-200 text-red-800',
};

export default function TimelineTab() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ description: '', severity: 5 });

  const { data: logs = [] } = useQuery({
    queryKey: ['health-logs'],
    queryFn: async () => {
      const { data } = await axios.get(`${API_BASE}/health/logs?userId=${DEMO_USER_ID}`);
      return data.logs;
    },
  });

  const addLog = useMutation({
    mutationFn: () =>
      axios.post(`${API_BASE}/health/logs`, {
        userId: DEMO_USER_ID,
        type: 'symptom',
        ...form,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['health-logs'] });
      setShowForm(false);
      setForm({ description: '', severity: 5 });
    },
  });

  return (
    <div className="px-4 py-4 space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-bold text-gray-900">Health Timeline</h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="bg-primary text-white px-4 py-2 rounded-xl text-sm font-medium"
        >
          + Log
        </button>
      </div>

      {showForm && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="bg-white rounded-2xl p-4 space-y-3 shadow-sm"
        >
          <textarea
            placeholder="Describe your symptom..."
            value={form.description}
            onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
            rows={3}
            className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-primary resize-none"
          />
          <div>
            <p className="text-sm text-gray-600 mb-2">Severity: {form.severity}/10</p>
            <input
              type="range"
              min={1}
              max={10}
              value={form.severity}
              onChange={e => setForm(p => ({ ...p, severity: Number(e.target.value) }))}
              className="w-full accent-primary"
            />
          </div>
          <button
            onClick={() => addLog.mutate()}
            disabled={!form.description || addLog.isPending}
            className="w-full bg-primary text-white py-3 rounded-xl font-medium disabled:opacity-50"
          >
            {addLog.isPending ? 'Saving...' : 'Save Entry'}
          </button>
        </motion.div>
      )}

      {logs.length === 0 ? (
        <div className="text-center py-16">
          <span className="text-6xl">📋</span>
          <p className="mt-4 text-gray-500">No health entries yet</p>
          <button
            onClick={() => setShowForm(true)}
            className="mt-4 text-primary text-sm font-medium"
          >
            Log your first entry →
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {logs.map((log: any, i: number) => (
            <motion.div
              key={log.logId || i}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="bg-white rounded-2xl p-4 shadow-sm flex gap-3"
            >
              <div className="flex flex-col items-center">
                <div className="w-2 h-2 bg-primary rounded-full mt-2" />
                {i < logs.length - 1 && <div className="w-0.5 flex-1 bg-gray-100 mt-1" />}
              </div>
              <div className="flex-1 pb-2">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs text-gray-400">
                    {new Date(log.timestamp || Date.now()).toLocaleDateString('en-IN', {
                      day: 'numeric',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                  {log.severity && (
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        SEVERITY_COLOR[log.severity] || 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      Severity {log.severity}
                    </span>
                  )}
                </div>
                <p className="text-sm text-gray-800">{log.description}</p>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
