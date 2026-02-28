import { useState, useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import VoiceTab from './tabs/VoiceTab';
import MedicationsTab from './tabs/MedicationsTab';
import AppointmentsTab from './tabs/AppointmentsTab';
import EmergencyTab from './tabs/EmergencyTab';
import TimelineTab from './tabs/TimelineTab';
import HospitalTab from './tabs/HospitalTab';
import ProfileModal, { loadProfile, UserProfile } from './components/ProfileModal';

const queryClient = new QueryClient();

const tabs = [
  { id: 'voice', label: 'Voice', icon: '🎙️' },
  { id: 'medications', label: 'Meds', icon: '💊' },
  { id: 'hospitals', label: 'Hospitals', icon: '🏥' },
  { id: 'appointments', label: 'Book', icon: '📅' },
  { id: 'emergency', label: 'SOS', icon: '🆘' },
  { id: 'timeline', label: 'History', icon: '📋' },
];

export default function App() {
  const [activeTab, setActiveTab] = useState('voice');
  const [showProfile, setShowProfile] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);

  useEffect(() => {
    const existing = loadProfile();
    if (existing) {
      setProfile(existing);
    } else {
      // First launch — open profile setup
      setTimeout(() => setShowProfile(true), 800);
    }
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <div className="min-h-screen bg-surface flex flex-col max-w-md mx-auto relative">
        {/* Header */}
        <header className="bg-white border-b border-gray-100 px-6 pt-12 pb-4 sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-primary rounded-2xl flex items-center justify-center">
              <span className="text-white text-lg">🏥</span>
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900 tracking-tight">Bhasha AI</h1>
              <p className="text-xs text-gray-500">
                {profile?.name ? `Hello, ${profile.name}` : 'Your health companion'}
              </p>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <span className="w-2 h-2 bg-success rounded-full animate-pulse"></span>
              <button
                onClick={() => setShowProfile(true)}
                className="w-9 h-9 bg-gray-100 rounded-full flex items-center justify-center text-lg hover:bg-gray-200 transition-colors"
                title="Profile"
              >
                {profile?.name ? (
                  <span className="text-sm font-bold text-primary">
                    {profile.name.charAt(0).toUpperCase()}
                  </span>
                ) : (
                  '👤'
                )}
              </button>
            </div>
          </div>
        </header>

        {/* Tab Content */}
        <main className="flex-1 overflow-y-auto pb-24">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              className="h-full"
            >
              {activeTab === 'voice' && <VoiceTab onNavigate={setActiveTab} />}
              {activeTab === 'medications' && <MedicationsTab />}
              {activeTab === 'hospitals' && <HospitalTab />}
              {activeTab === 'appointments' && <AppointmentsTab />}
              {activeTab === 'emergency' && <EmergencyTab />}
              {activeTab === 'timeline' && <TimelineTab />}
            </motion.div>
          </AnimatePresence>
        </main>

        {/* Bottom Tab Bar */}
        <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md bg-white border-t border-gray-100 px-1 py-1.5 z-20">
          <div className="flex justify-around">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-xl transition-all duration-200 min-w-0 ${
                  activeTab === tab.id
                    ? 'text-primary bg-blue-50'
                    : 'text-gray-400 hover:text-gray-600'
                }`}
              >
                <span className="text-lg">{tab.icon}</span>
                <span className="text-xs font-medium truncate">{tab.label}</span>
              </button>
            ))}
          </div>
        </nav>

        {/* Profile Modal */}
        <ProfileModal
          open={showProfile}
          onClose={() => setShowProfile(false)}
          onSave={p => setProfile(p)}
        />
      </div>
    </QueryClientProvider>
  );
}
