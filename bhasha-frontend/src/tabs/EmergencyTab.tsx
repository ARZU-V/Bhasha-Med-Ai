import { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';
import { API_BASE, DEMO_USER_ID } from '../config';

type Contact = { name: string; phone: string; relation: string };

export default function EmergencyTab() {
  const [contacts, setContacts] = useState<Contact[]>([
    { name: 'Priya (Wife)', phone: '+919876543210', relation: 'Family' },
  ]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newContact, setNewContact] = useState({ name: '', phone: '', relation: '' });
  const [emergencyState, setEmergencyState] = useState<
    'idle' | 'countdown' | 'active' | 'cancelled'
  >('idle');
  const [countdown, setCountdown] = useState(30);
  const [emergencyId, setEmergencyId] = useState<string | null>(null);
  const [holdProgress, setHoldProgress] = useState(0);
  const holdIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startHold = () => {
    let progress = 0;
    holdIntervalRef.current = setInterval(() => {
      progress += 5;
      setHoldProgress(progress);
      if (progress >= 100) {
        clearInterval(holdIntervalRef.current!);
        triggerEmergency();
      }
    }, 100);
  };

  const cancelHold = () => {
    clearInterval(holdIntervalRef.current!);
    setHoldProgress(0);
  };

  const triggerEmergency = async () => {
    setEmergencyState('active');
    setCountdown(30);

    try {
      const { data } = await axios.post(`${API_BASE}/emergency/trigger`, {
        userId: DEMO_USER_ID,
        symptoms: 'Emergency SOS triggered',
        location: { lat: 28.6139, lng: 77.209, address: 'Current Location' },
      });
      setEmergencyId(data.emergencyId);
    } catch (e) {
      console.error(e);
    }

    countdownRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(countdownRef.current!);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const cancelEmergency = async () => {
    clearInterval(countdownRef.current!);
    if (emergencyId) {
      try {
        await axios.post(`${API_BASE}/emergency/cancel`, {
          emergencyId,
          userId: DEMO_USER_ID,
        });
      } catch (e) {
        console.error(e);
      }
    }
    setEmergencyState('cancelled');
    setHoldProgress(0);
    setTimeout(() => setEmergencyState('idle'), 2000);
  };

  return (
    <div className="px-4 py-4 space-y-4">
      <h2 className="text-xl font-bold text-gray-900">Emergency</h2>

      {/* SOS Button */}
      <div className="bg-white rounded-2xl p-6 text-center shadow-sm">
        <AnimatePresence mode="wait">
          {emergencyState === 'idle' && (
            <motion.div
              key="idle"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <p className="text-sm text-gray-500 mb-4">
                Hold the button for 2 seconds to trigger emergency
              </p>
              <div className="relative inline-flex">
                <motion.button
                  onMouseDown={startHold}
                  onMouseUp={cancelHold}
                  onMouseLeave={cancelHold}
                  onTouchStart={startHold}
                  onTouchEnd={cancelHold}
                  className="w-32 h-32 bg-danger rounded-full flex flex-col items-center justify-center text-white shadow-xl shadow-red-200 select-none"
                  whileTap={{ scale: 0.95 }}
                >
                  <span className="text-4xl">🆘</span>
                  <span className="text-sm font-bold mt-1">SOS</span>
                </motion.button>
                {holdProgress > 0 && (
                  <svg
                    className="absolute inset-0 w-32 h-32 -rotate-90 pointer-events-none"
                    viewBox="0 0 128 128"
                  >
                    <circle
                      cx="64"
                      cy="64"
                      r="60"
                      fill="none"
                      stroke="white"
                      strokeWidth="4"
                      strokeDasharray={`${holdProgress * 3.77} 377`}
                      strokeLinecap="round"
                      opacity="0.6"
                    />
                  </svg>
                )}
              </div>
            </motion.div>
          )}

          {emergencyState === 'active' && (
            <motion.div
              key="active"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="space-y-4"
            >
              <motion.div
                className="text-6xl"
                animate={{ scale: [1, 1.1, 1] }}
                transition={{ duration: 0.5, repeat: Infinity }}
              >
                🚨
              </motion.div>
              <p className="font-bold text-danger text-xl">Emergency Triggered!</p>
              <p className="text-sm text-gray-600">Calling {contacts.length} contact(s)...</p>

              <div className="space-y-2">
                {contacts.map((c, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.2 }}
                    className="flex items-center justify-between bg-red-50 rounded-xl px-4 py-3"
                  >
                    <div className="text-left">
                      <p className="font-medium text-sm text-gray-900">{c.name}</p>
                      <p className="text-xs text-gray-500">{c.phone}</p>
                    </div>
                    <motion.div
                      animate={{ opacity: [1, 0.3, 1] }}
                      transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.2 }}
                      className="text-success text-sm font-medium"
                    >
                      📞 Calling
                    </motion.div>
                  </motion.div>
                ))}
              </div>

              <button
                onClick={cancelEmergency}
                className="w-full bg-gray-100 text-gray-700 py-3 rounded-xl font-medium"
              >
                Cancel ({countdown}s)
              </button>
            </motion.div>
          )}

          {emergencyState === 'cancelled' && (
            <motion.div
              key="cancelled"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center py-4"
            >
              <span className="text-4xl">✅</span>
              <p className="mt-2 font-medium text-gray-700">Emergency cancelled</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Emergency Contacts */}
      <div className="space-y-3">
        <div className="flex justify-between items-center">
          <h3 className="font-semibold text-gray-900">Emergency Contacts</h3>
          <button
            onClick={() => setShowAddForm(true)}
            className="text-primary text-sm font-medium"
          >
            + Add
          </button>
        </div>

        {contacts.map((c, i) => (
          <div
            key={i}
            className="bg-white rounded-2xl p-4 flex items-center justify-between shadow-sm"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center text-lg">
                👤
              </div>
              <div>
                <p className="font-medium text-sm text-gray-900">{c.name}</p>
                <p className="text-xs text-gray-500">
                  {c.phone} · {c.relation}
                </p>
              </div>
            </div>
            <button
              onClick={() => setContacts(contacts.filter((_, j) => j !== i))}
              className="text-gray-300 hover:text-danger transition-colors"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      {/* Add contact modal */}
      <AnimatePresence>
        {showAddForm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 z-50 flex items-end"
            onClick={e => e.target === e.currentTarget && setShowAddForm(false)}
          >
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25 }}
              className="bg-white rounded-t-3xl w-full p-6 space-y-4"
            >
              <h3 className="text-lg font-bold">Add Emergency Contact</h3>
              <input
                placeholder="Full name"
                value={newContact.name}
                onChange={e => setNewContact(p => ({ ...p, name: e.target.value }))}
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-primary"
              />
              <input
                placeholder="Phone (+91XXXXXXXXXX)"
                value={newContact.phone}
                type="tel"
                onChange={e => setNewContact(p => ({ ...p, phone: e.target.value }))}
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-primary"
              />
              <input
                placeholder="Relation (Family / Neighbor / Doctor)"
                value={newContact.relation}
                onChange={e => setNewContact(p => ({ ...p, relation: e.target.value }))}
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-primary"
              />
              <button
                onClick={() => {
                  if (newContact.name && newContact.phone) {
                    setContacts(p => [...p, newContact]);
                    setShowAddForm(false);
                    setNewContact({ name: '', phone: '', relation: '' });
                  }
                }}
                disabled={!newContact.name || !newContact.phone}
                className="w-full bg-danger text-white py-4 rounded-2xl font-semibold disabled:opacity-50"
              >
                Add Contact
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
