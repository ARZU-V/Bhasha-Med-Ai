import { useState, useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import DashboardTab     from './tabs/DashboardTab';
import VoiceTab         from './tabs/VoiceTab';
import MedicationsTab   from './tabs/MedicationsTab';
import AppointmentsTab  from './tabs/AppointmentsTab';
import EmergencyTab     from './tabs/EmergencyTab';
import TimelineTab      from './tabs/TimelineTab';
import HospitalTab      from './tabs/HospitalTab';
import HistoryTab       from './tabs/HistoryTab';
import NavigatorTab     from './tabs/NavigatorTab';
import DietTab          from './tabs/DietTab';
import AgentTab         from './tabs/AgentTab';
import ProfileModal, { loadProfile, UserProfile } from './components/ProfileModal';

const queryClient = new QueryClient();

const tabs = [
  { id: 'home',         label: 'Home',    icon: '🏠' },
  { id: 'voice',        label: 'Voice',   icon: '🎙️' },
  { id: 'history',      label: 'History', icon: '🗂️' },
  { id: 'appointments', label: 'Book',    icon: '📅' },
  { id: 'emergency',    label: 'SOS',     icon: '🆘' },
];

type BookingPrefill = { doctorName: string; preferredTime: string; patientPhone: string; clinicPhone?: string };

export default function App() {
  const [activeTab,        setActiveTab]        = useState('home');
  const [showProfile,      setShowProfile]      = useState(false);
  const [profile,          setProfile]          = useState<UserProfile | null>(null);
  const [apptPrefill,      setApptPrefill]      = useState<BookingPrefill | undefined>();
  const [symptomCondition, setSymptomCondition] = useState('');  // passed voice→hospitals
  const [historyPrefill,   setHistoryPrefill]   = useState<any>(undefined); // voice→history

  const handleNavigate = (tab: string, data?: any) => {
    if (tab === 'appointments' && data?.doctorName) setApptPrefill(data);
    if (tab === 'hospitals'    && data?.condition)  setSymptomCondition(data.condition);
    if (tab === 'history'      && data)              setHistoryPrefill(data);
    setActiveTab(tab);
  };

  useEffect(() => {
    const existing = loadProfile();
    if (existing) setProfile(existing);
    else setTimeout(() => setShowProfile(true), 800);
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <div className="min-h-screen bg-base flex flex-col max-w-md mx-auto relative">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <header className="bg-surface border-b border-line px-5 pt-12 pb-4 sticky top-0 z-10">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 bg-primary rounded-md flex items-center justify-center flex-shrink-0">
                  <span className="text-white text-xs font-bold leading-none">B</span>
                </div>
                <span className="text-base font-bold text-ink tracking-tight">Bhasha AI</span>
                <div className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 bg-success rounded-full" />
                  <span className="text-2xs text-success font-medium">Live</span>
                </div>
              </div>
              {profile?.name && (
                <p className="text-2xs text-ink-3 mt-0.5 ml-8">Welcome back, {profile.name}</p>
              )}
            </div>

            <button
              onClick={() => setShowProfile(true)}
              className="w-8 h-8 rounded-lg border border-line bg-surface-2 flex items-center justify-center transition-all active:scale-95"
            >
              {profile?.name ? (
                <span className="text-xs font-bold text-ink-2">
                  {profile.name.charAt(0).toUpperCase()}
                </span>
              ) : (
                <span className="text-sm">👤</span>
              )}
            </button>
          </div>
        </header>

        {/* ── Content ─────────────────────────────────────────────────────── */}
        <main className="flex-1 overflow-y-auto pb-24">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15, ease: 'easeOut' }}
              className="h-full"
            >
              {activeTab === 'home'         && <DashboardTab onNavigate={handleNavigate} />}
              {activeTab === 'voice'        && <VoiceTab onNavigate={handleNavigate} />}
              {activeTab === 'medications'  && <MedicationsTab />}
              {activeTab === 'hospitals'    && <HospitalTab onNavigate={handleNavigate} symptomCondition={symptomCondition} onConditionUsed={() => setSymptomCondition('')} />}
              {activeTab === 'history'      && <HistoryTab prefillEntry={historyPrefill} />}
              {activeTab === 'appointments' && <AppointmentsTab prefill={apptPrefill} onPrefillUsed={() => setApptPrefill(undefined)} />}
              {activeTab === 'navigator'    && <NavigatorTab />}
              {activeTab === 'diet'         && <DietTab />}
              {activeTab === 'agents'       && <AgentTab />}
              {activeTab === 'emergency'    && <EmergencyTab />}
              {activeTab === 'timeline'     && <TimelineTab />}
            </motion.div>
          </AnimatePresence>
        </main>

        {/* ── Bottom nav ──────────────────────────────────────────────────── */}
        <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md bg-surface border-t border-line z-20">
          <div className="flex justify-around px-1 pt-2 pb-4">
            {tabs.map(tab => {
              const active = activeTab === tab.id;
              const isSOS  = tab.id === 'emergency';
              const accent = isSOS ? 'text-danger' : 'text-primary';
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex flex-col items-center gap-0.5 px-2 py-1 min-w-0
                    rounded-lg transition-all duration-150 active:scale-95
                    ${active ? accent : 'text-ink-3'}`}
                >
                  <span className={`text-base leading-none ${active ? 'opacity-100' : 'opacity-40'}`}>
                    {tab.icon}
                  </span>
                  <span className={`text-[10px] font-medium leading-none ${active ? accent : 'text-ink-3'}`}>
                    {tab.label}
                  </span>
                  {active && (
                    <motion.span
                      layoutId="nav-dot"
                      className={`w-3 h-0.5 rounded-full mt-0.5 ${isSOS ? 'bg-danger' : 'bg-primary'}`}
                      transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                    />
                  )}
                </button>
              );
            })}
          </div>
        </nav>

        <ProfileModal
          open={showProfile}
          onClose={() => setShowProfile(false)}
          onSave={p => setProfile(p)}
        />
      </div>
    </QueryClientProvider>
  );
}
