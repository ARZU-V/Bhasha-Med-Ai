import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';
import { BEDROCK_AGENT_URL, DEMO_USER_ID } from '../config';
import { loadProfile } from '../components/ProfileModal';

// ── Types ─────────────────────────────────────────────────────────────────────

type AgentStatus = 'idle' | 'running' | 'done' | 'error';

type Diagnosis = {
  condition: string;
  severity: 'mild' | 'moderate' | 'severe';
  specialty_needed: string;
  urgency: 'emergency' | 'urgent' | 'routine';
  urgency_reason: string;
  red_flags: string[];
  action_steps: string[];
  image_analysis: string;
};

type Hospital = {
  id: string;
  name: string;
  address: string;
  distance_km: number;
  lat: number;
  lng: number;
  type: string;
  emergency: boolean;
  phone: string;
  rating: number;
};

type RankerResult = {
  recommended_hospital: Hospital | null;
  ranked_list: Hospital[];
  ranking_reason: string;
  visit_prep: {
    urgency_note: string;
    questions_to_ask: string[];
    what_to_bring: string[];
    transport_tip: string;
  };
};

type PastVisit = {
  found: boolean;
  hospital_name?: string;
  hospital_phone?: string;
  condition?: string;
  specialty?: string;
  days_ago?: number;
  suggestion?: string;
};

type ConsultResult = {
  orchestrator_summary: string;
  agents: {
    diagnosis: Diagnosis;
    hospital_finder: { count: number; hospitals: Hospital[]; specialty_searched: string };
    ranker: RankerResult;
  };
  past_visit: PastVisit;
};

// ── Agent step config ─────────────────────────────────────────────────────────

const AGENT_STEPS = [
  {
    id: 'diagnosis',
    icon: '🔬',
    title: 'Diagnosis Agent',
    desc: 'Analyzing symptoms with medical NLP + AI reasoning',
    doneDesc: 'Condition identified',
    color: 'text-violet-600',
    bg: 'bg-violet-500/8',
    border: 'border-violet-500/20',
    dot: 'bg-violet-500',
    delayMs: 0,
  },
  {
    id: 'hospital',
    icon: '🏥',
    title: 'Hospital Finder Agent',
    desc: 'Searching nearby specialists for your condition',
    doneDesc: 'Hospitals located',
    color: 'text-primary',
    bg: 'bg-primary/8',
    border: 'border-primary/20',
    dot: 'bg-primary',
    delayMs: 8000,
  },
  {
    id: 'ranker',
    icon: '⭐',
    title: 'Ranker Agent',
    desc: 'Ranking hospitals + preparing your visit guide',
    doneDesc: 'Best match selected',
    color: 'text-amber-600',
    bg: 'bg-amber-500/8',
    border: 'border-amber-500/20',
    dot: 'bg-amber-500',
    delayMs: 18000,
  },
];

// ── Urgency display ───────────────────────────────────────────────────────────

const URGENCY_CONFIG = {
  emergency: { label: 'Go to ER Now',    bg: 'bg-danger/10',   border: 'border-danger/25',   text: 'text-danger',   icon: '🚨' },
  urgent:    { label: 'Visit Today',      bg: 'bg-warning/10',  border: 'border-warning/25',  text: 'text-amber-700',icon: '⚡' },
  routine:   { label: 'Within a few days',bg: 'bg-success/8',   border: 'border-success/20',  text: 'text-success',  icon: '✅' },
};

const SEVERITY_COLOR = {
  mild:     'text-success',
  moderate: 'text-amber-600',
  severe:   'text-danger',
};

// ── getUserLocation helper ────────────────────────────────────────────────────

const getUserLocation = (): Promise<{ lat: number; lng: number }> =>
  new Promise(resolve => {
    if (!navigator.geolocation) return resolve({ lat: 28.6139, lng: 77.209 });
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve({ lat: 28.6139, lng: 77.209 }),
      { timeout: 6000 }
    );
  });

// ─────────────────────────────────────────────────────────────────────────────

export default function AgentTab() {
  const profile = loadProfile();

  const [phase,          setPhase]          = useState<'input' | 'processing' | 'result'>('input');
  const [symptoms,       setSymptoms]       = useState('');
  const [imageFile,      setImageFile]      = useState<File | null>(null);
  const [imagePreview,   setImagePreview]   = useState('');
  const [imageB64,       setImageB64]       = useState('');
  const [error,          setError]          = useState('');
  const [result,         setResult]         = useState<ConsultResult | null>(null);
  const [activeTab,      setActiveTab]      = useState<'diagnosis' | 'hospital' | 'prep'>('diagnosis');
  const [questionsCopied,setQuestionsCopied]= useState(false);

  // Voice recording state
  const [isRecording,    setIsRecording]    = useState(false);
  const [micError,       setMicError]       = useState('');
  const recognitionRef = useRef<any>(null);

  // Agent progress animation state
  const [agentStatuses, setAgentStatuses]   = useState<Record<string, AgentStatus>>({
    diagnosis: 'idle', hospital: 'idle', ranker: 'idle',
  });
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Cleanup timers on unmount
  useEffect(() => () => { timersRef.current.forEach(clearTimeout); }, []);

  const startProgressAnimation = () => {
    setAgentStatuses({ diagnosis: 'running', hospital: 'idle', ranker: 'idle' });
    // Simulated progress matching rough API timing
    const t1 = setTimeout(() => setAgentStatuses(p => ({ ...p, diagnosis: 'done', hospital: 'running' })), 8000);
    const t2 = setTimeout(() => setAgentStatuses(p => ({ ...p, hospital: 'done', ranker: 'running' })),  18000);
    timersRef.current = [t1, t2];
  };

  const handleImagePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageFile(file);
    const reader = new FileReader();
    reader.onload = ev => {
      const dataUrl = ev.target?.result as string;
      setImagePreview(dataUrl);
      setImageB64(dataUrl); // send full data URL; backend strips the prefix
    };
    reader.readAsDataURL(file);
  };

  const removeImage = () => {
    setImageFile(null);
    setImagePreview('');
    setImageB64('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const startVoice = () => {
    setMicError('');
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setMicError('Voice not supported on this browser. Try Chrome.');
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = profile?.language === 'hi' ? 'hi-IN'
      : profile?.language === 'te' ? 'te-IN'
      : profile?.language === 'ta' ? 'ta-IN'
      : profile?.language === 'mr' ? 'mr-IN'
      : profile?.language === 'bn' ? 'bn-IN'
      : profile?.language === 'gu' ? 'gu-IN'
      : profile?.language === 'kn' ? 'kn-IN'
      : profile?.language === 'ml' ? 'ml-IN'
      : profile?.language === 'pa' ? 'pa-IN'
      : 'en-IN';

    let finalText = symptoms;
    recognition.onresult = (e: any) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalText += e.results[i][0].transcript + ' ';
        else interim = e.results[i][0].transcript;
      }
      setSymptoms(finalText + interim);
    };
    recognition.onerror = () => {
      setMicError('Could not access microphone. Please allow mic permission.');
      setIsRecording(false);
    };
    recognition.onend = () => setIsRecording(false);

    recognitionRef.current = recognition;
    recognition.start();
    setIsRecording(true);
  };

  const stopVoice = () => {
    recognitionRef.current?.stop();
    setIsRecording(false);
  };

  const runAnalysis = async () => {
    if (!symptoms.trim() && !imageB64) return;
    setError('');
    setPhase('processing');
    startProgressAnimation();

    try {
      const loc = await getUserLocation();
      const { data } = await axios.post(BEDROCK_AGENT_URL, {
        userId:         DEMO_USER_ID,
        symptoms:       symptoms.trim(),
        image:          imageB64 || undefined,
        lat:            loc.lat,
        lng:            loc.lng,
        language:       profile?.language || 'en',
        userConditions: profile?.conditions || [],
      }, { timeout: 120000 });

      // Mark all agents done
      timersRef.current.forEach(clearTimeout);
      setAgentStatuses({ diagnosis: 'done', hospital: 'done', ranker: 'done' });

      // Brief pause so user sees all agents complete before results appear
      setTimeout(() => {
        setResult(data);
        setPhase('result');
        setActiveTab('diagnosis');
      }, 800);
    } catch (err: any) {
      timersRef.current.forEach(clearTimeout);
      setAgentStatuses({ diagnosis: 'error', hospital: 'error', ranker: 'error' });
      setError(err?.response?.data?.error || 'Analysis failed. Check your connection and try again.');
      setTimeout(() => setPhase('input'), 1500);
    }
  };

  const reset = () => {
    setPhase('input');
    setResult(null);
    setSymptoms('');
    removeImage();
    setError('');
    setAgentStatuses({ diagnosis: 'idle', hospital: 'idle', ranker: 'idle' });
  };

  // ── RENDER ──────────────────────────────────────────────────────────────────

  return (
    <div className="px-4 py-4 pb-10 space-y-4">

      {/* Header */}
      <div>
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-xl font-bold text-ink flex items-center gap-2">
            🤖 AI Medical Agents
          </h2>
          <span className="flex-shrink-0 mt-0.5 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-700 border border-amber-500/20">
            AWS Bedrock Agent
          </span>
        </div>
        <p className="text-sm text-ink-3 mt-0.5">
          Managed multi-agent pipeline — diagnose, find, rank
        </p>
      </div>

      <AnimatePresence mode="wait">

        {/* ═══ INPUT PHASE ═══ */}
        {phase === 'input' && (
          <motion.div key="input" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-4">

            {/* Agent pipeline preview */}
            <div className="grid grid-cols-3 gap-2">
              {AGENT_STEPS.map(s => (
                <div key={s.id} className={`${s.bg} border ${s.border} rounded-xl p-2.5 text-center`}>
                  <div className="text-xl mb-1">{s.icon}</div>
                  <p className={`text-[10px] font-bold ${s.color} leading-tight`}>{s.title.split(' ')[0]}</p>
                  <p className="text-[9px] text-ink-3 mt-0.5 leading-tight">{s.title.split(' ').slice(1).join(' ')}</p>
                </div>
              ))}
            </div>

            {/* Symptom input */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-ink-3 uppercase tracking-wider">Describe your symptoms</p>
              <textarea
                value={symptoms}
                onChange={e => setSymptoms(e.target.value)}
                placeholder="e.g. I have had chest pain when walking for the past 2 days, with mild breathlessness..."
                rows={4}
                className="w-full bg-surface border border-line rounded-xl px-4 py-3 text-sm text-ink outline-none focus:border-primary placeholder:text-ink-3 resize-none leading-relaxed"
              />

              {/* Mic hold-to-speak button */}
              <div className="flex flex-col items-center gap-2 pt-1">
                <div className="flex items-center gap-2 text-xs text-ink-3">
                  <span>📍</span>
                  <span>Your location will be sent automatically</span>
                </div>
                <motion.button
                  onPointerDown={startVoice}
                  onPointerUp={stopVoice}
                  onPointerLeave={stopVoice}
                  whileTap={{ scale: 0.93 }}
                  className={`w-full py-4 rounded-2xl font-semibold text-sm flex items-center justify-center gap-2.5 select-none transition-all ${
                    isRecording
                      ? 'bg-danger text-white shadow-lg shadow-danger/30'
                      : 'bg-surface border-2 border-dashed border-primary/40 text-primary'
                  }`}
                >
                  {isRecording ? (
                    <>
                      <motion.span
                        animate={{ scale: [1, 1.3, 1] }}
                        transition={{ duration: 0.7, repeat: Infinity }}
                        className="text-lg"
                      >🎙️</motion.span>
                      <span>Listening... release to stop</span>
                      <div className="flex gap-0.5">
                        {[0, 1, 2, 3].map(i => (
                          <motion.div
                            key={i}
                            className="w-1 bg-white rounded-full"
                            animate={{ height: ['8px', '20px', '8px'] }}
                            transition={{ duration: 0.5, repeat: Infinity, delay: i * 0.1 }}
                          />
                        ))}
                      </div>
                    </>
                  ) : (
                    <>
                      <span className="text-lg">🎙️</span>
                      <span>Hold to speak your symptoms</span>
                    </>
                  )}
                </motion.button>
                {micError && (
                  <p className="text-xs text-danger text-center">{micError}</p>
                )}
                {!isRecording && (
                  <p className="text-2xs text-ink-3 text-center leading-relaxed">
                    Say everything — your symptoms, how long, severity, and your location
                  </p>
                )}
              </div>
            </div>

            {/* Image upload */}
            <div>
              <p className="text-xs font-semibold text-ink-3 uppercase tracking-wider mb-2">Attach image (optional)</p>
              {imagePreview ? (
                <div className="relative rounded-xl overflow-hidden border border-line">
                  <img src={imagePreview} alt="Attached" className="w-full max-h-40 object-cover" />
                  <button
                    onClick={removeImage}
                    className="absolute top-2 right-2 w-7 h-7 bg-ink/60 rounded-full flex items-center justify-center text-white text-sm"
                  >×</button>
                  <div className="absolute bottom-0 left-0 right-0 bg-ink/50 px-3 py-1.5">
                    <p className="text-white text-xs font-medium truncate">{imageFile?.name}</p>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full border-2 border-dashed border-line rounded-xl py-4 flex flex-col items-center gap-2 text-ink-3 active:scale-[0.98] transition-all"
                >
                  <span className="text-2xl">📸</span>
                  <p className="text-xs font-medium">Add photo of rash, report, prescription, X-ray</p>
                  <p className="text-2xs">JPG, PNG up to 5MB</p>
                </button>
              )}
              <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImagePick} className="hidden" />
            </div>

            {error && (
              <div className="bg-danger/8 border border-danger/20 rounded-xl px-3.5 py-3 text-xs text-danger">{error}</div>
            )}

            <motion.button
              onClick={runAnalysis}
              disabled={!symptoms.trim() && !imageB64}
              whileTap={{ scale: 0.97 }}
              className="w-full bg-primary text-white py-4 rounded-2xl font-bold text-base disabled:opacity-40 flex items-center justify-center gap-2 transition-all"
            >
              🤖 Run 3-Agent Analysis
            </motion.button>

            <p className="text-center text-2xs text-ink-3">
              Takes 20–35 seconds · Diagnosis + Nearest Doctor + Visit Prep
            </p>
          </motion.div>
        )}

        {/* ═══ PROCESSING PHASE ═══ */}
        {phase === 'processing' && (
          <motion.div key="processing" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-3">

            <p className="text-sm text-ink-2 font-medium text-center">Agents working in sequence...</p>

            {AGENT_STEPS.map((step, idx) => {
              const status = agentStatuses[step.id];
              const isRunning = status === 'running';
              const isDone    = status === 'done';
              const isError   = status === 'error';
              const isPending = status === 'idle';

              return (
                <motion.div
                  key={step.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.1 }}
                  className={`rounded-2xl border p-4 transition-all ${
                    isDone    ? `${step.bg} ${step.border}` :
                    isRunning ? 'bg-surface border-primary ring-1 ring-primary/20' :
                    isError   ? 'bg-danger/5 border-danger/20' :
                    'bg-surface-2 border-line opacity-50'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0 ${
                      isDone ? step.bg : isRunning ? 'bg-primary/10' : 'bg-surface border border-line'
                    }`}>
                      {isRunning ? (
                        <motion.span
                          animate={{ rotate: 360 }}
                          transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
                          className="block text-sm"
                        >⚙️</motion.span>
                      ) : isDone ? (
                        <span className={step.color}>{step.icon}</span>
                      ) : (
                        <span className="opacity-40">{step.icon}</span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className={`text-sm font-bold ${isDone ? step.color : isRunning ? 'text-ink' : 'text-ink-3'}`}>
                          {step.title}
                        </p>
                        {isDone && (
                          <span className={`text-2xs ${step.bg} ${step.border} ${step.color} border px-2 py-0.5 rounded-full font-semibold`}>
                            Done
                          </span>
                        )}
                        {isRunning && (
                          <span className="text-2xs bg-primary/10 border border-primary/20 text-primary border px-2 py-0.5 rounded-full font-semibold">
                            Running
                          </span>
                        )}
                      </div>
                      <p className={`text-xs mt-0.5 ${isDone ? 'text-ink-2' : 'text-ink-3'}`}>
                        {isDone ? step.doneDesc : isRunning ? step.desc : 'Waiting...'}
                      </p>
                    </div>
                    {isRunning && (
                      <div className="flex gap-0.5 flex-shrink-0">
                        {[0, 1, 2].map(i => (
                          <motion.div
                            key={i}
                            className={`w-1.5 h-1.5 rounded-full ${step.dot}`}
                            animate={{ y: [0, -4, 0] }}
                            transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.15 }}
                          />
                        ))}
                      </div>
                    )}
                    {isDone && <span className={`${step.color} text-sm flex-shrink-0`}>✓</span>}
                  </div>
                </motion.div>
              );
            })}

            <p className="text-center text-xs text-ink-3 pt-2">
              Please wait — this usually takes 20–35 seconds
            </p>
          </motion.div>
        )}

        {/* ═══ RESULT PHASE ═══ */}
        {phase === 'result' && result && (
          <motion.div key="result" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-4">

            {/* Orchestrator summary */}
            {result.orchestrator_summary && (
              <div className="bg-primary/8 border border-primary/20 rounded-2xl px-4 py-3">
                <div className="flex items-start gap-2">
                  <span className="text-primary text-lg flex-shrink-0 mt-0.5">🤖</span>
                  <p className="text-sm text-ink-2 leading-relaxed">{result.orchestrator_summary}</p>
                </div>
              </div>
            )}

            {/* Past visit banner */}
            {result.past_visit?.found && (
              <motion.div
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-amber-500/8 border border-amber-500/25 rounded-2xl px-4 py-3.5"
              >
                <div className="flex items-start gap-2.5">
                  <span className="text-xl flex-shrink-0">🔁</span>
                  <div>
                    <p className="text-sm font-bold text-amber-700">Return Visit Suggested</p>
                    <p className="text-xs text-ink-2 mt-0.5 leading-relaxed">{result.past_visit.suggestion}</p>
                    {result.past_visit.hospital_phone && (
                      <a href={`tel:${result.past_visit.hospital_phone}`}
                        className="inline-flex items-center gap-1.5 mt-2 text-xs font-semibold text-amber-700 bg-amber-500/10 border border-amber-500/20 px-3 py-1.5 rounded-lg">
                        📞 Call {result.past_visit.hospital_name}
                      </a>
                    )}
                  </div>
                </div>
              </motion.div>
            )}

            {/* Result tabs */}
            <div className="flex border-b border-line">
              {[
                { id: 'diagnosis' as const, label: '🔬 Diagnosis' },
                { id: 'hospital'  as const, label: '🏥 Best Hospital' },
                { id: 'prep'      as const, label: '📋 Visit Prep' },
              ].map(t => (
                <button key={t.id} onClick={() => setActiveTab(t.id)}
                  className={`flex-1 py-2.5 text-xs font-semibold border-b-2 transition-all ${
                    activeTab === t.id ? 'border-primary text-primary' : 'border-transparent text-ink-3'
                  }`}>
                  {t.label}
                </button>
              ))}
            </div>

            {/* ── DIAGNOSIS TAB ── */}
            {activeTab === 'diagnosis' && (() => {
              const d = result.agents.diagnosis;
              const urg = URGENCY_CONFIG[d.urgency] || URGENCY_CONFIG.routine;
              return (
                <div className="space-y-3">
                  {/* Condition card */}
                  <div className="bg-surface border border-line rounded-2xl p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-2xs text-ink-3 font-semibold uppercase tracking-wider">Likely Condition</p>
                        <p className="text-lg font-bold text-ink mt-0.5">{d.condition}</p>
                      </div>
                      <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${SEVERITY_COLOR[d.severity]} bg-surface-2 border border-line`}>
                        {d.severity.charAt(0).toUpperCase() + d.severity.slice(1)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm">👨‍⚕️</span>
                      <p className="text-sm text-ink-2">See a <strong>{d.specialty_needed}</strong></p>
                    </div>
                  </div>

                  {/* Urgency */}
                  <div className={`${urg.bg} border ${urg.border} rounded-xl px-4 py-3 flex items-start gap-3`}>
                    <span className="text-xl flex-shrink-0">{urg.icon}</span>
                    <div>
                      <p className={`font-bold text-sm ${urg.text}`}>{urg.label}</p>
                      <p className="text-xs text-ink-2 mt-0.5">{d.urgency_reason}</p>
                    </div>
                  </div>

                  {/* Image analysis */}
                  {d.image_analysis && (
                    <div className="bg-surface-2 border border-line rounded-xl px-3.5 py-3">
                      <p className="text-xs font-semibold text-ink-2 mb-1.5">📸 Image Analysis</p>
                      <p className="text-xs text-ink-2 leading-relaxed">{d.image_analysis}</p>
                    </div>
                  )}

                  {/* Action steps */}
                  {d.action_steps.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-ink-3 uppercase tracking-wider mb-2">What to do now</p>
                      <div className="space-y-1.5">
                        {d.action_steps.map((step, i) => (
                          <div key={i} className="flex items-start gap-2.5 bg-surface border border-line rounded-xl px-3.5 py-2.5">
                            <div className="w-5 h-5 bg-primary/10 rounded-full flex items-center justify-center text-2xs font-bold text-primary flex-shrink-0 mt-0.5">{i + 1}</div>
                            <p className="text-sm text-ink-2">{step}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Red flags */}
                  {d.red_flags.length > 0 && (
                    <div className="bg-danger/5 border border-danger/20 rounded-xl px-3.5 py-3">
                      <p className="text-xs font-bold text-danger mb-2">🚨 Go to ER immediately if you notice</p>
                      <div className="space-y-1">
                        {d.red_flags.map((f, i) => (
                          <div key={i} className="flex items-start gap-2">
                            <span className="text-danger text-xs mt-0.5">•</span>
                            <p className="text-xs text-ink-2">{f}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* ── HOSPITAL TAB ── */}
            {activeTab === 'hospital' && (() => {
              const r = result.agents.ranker;
              const rec = r.recommended_hospital;
              const others = r.ranked_list.filter(h => h.name !== rec?.name).slice(0, 3);

              if (!rec && others.length === 0) {
                return (
                  <div className="bg-amber-500/8 border border-amber-500/20 rounded-2xl p-5 text-center space-y-2">
                    <p className="text-2xl">🏥</p>
                    <p className="text-sm font-bold text-amber-700">Hospitals not found</p>
                    <p className="text-xs text-ink-2 leading-relaxed">
                      The agent didn't complete hospital search. This happens when it asks clarifying questions instead of calling tools.
                    </p>
                    <p className="text-xs text-ink-3 mt-2">Try again — describe symptoms AND mention your city/area in the text.</p>
                    <button onClick={reset} className="mt-1 text-xs font-semibold text-primary underline">Start new analysis</button>
                  </div>
                );
              }

              return (
                <div className="space-y-3">
                  {/* Recommended */}
                  {rec && (
                    <div className="bg-success/5 border-2 border-success/30 rounded-2xl p-4 space-y-3">
                      <div className="flex items-start gap-2">
                        <span className="text-xl">🏆</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-2xs bg-success/15 text-success border border-success/25 px-2 py-0.5 rounded-full font-bold">Best Match</span>
                            {rec.emergency && <span className="text-2xs bg-danger/8 text-danger border border-danger/15 px-1.5 py-0.5 rounded-full font-semibold">🚨 24/7</span>}
                          </div>
                          <p className="font-bold text-ink text-base mt-1">{rec.name}</p>
                          <p className="text-xs text-ink-3 mt-0.5">{rec.address}</p>
                          <div className="flex items-center gap-3 mt-1.5">
                            <span className="text-xs font-bold text-primary">{rec.distance_km.toFixed(1)} km</span>
                            {rec.rating > 0 && <span className="text-xs text-amber-600">⭐ {rec.rating}</span>}
                          </div>
                        </div>
                      </div>

                      {/* Ranking reason */}
                      {r.ranking_reason && (
                        <div className="bg-success/8 border border-success/20 rounded-xl px-3 py-2">
                          <p className="text-xs text-ink-2 leading-relaxed">💡 {r.ranking_reason}</p>
                        </div>
                      )}

                      {/* CTA buttons */}
                      <div className="flex gap-2">
                        {rec.phone ? (
                          <a href={`tel:${rec.phone}`}
                            className="flex-1 bg-success text-white py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-1.5">
                            📞 Call
                          </a>
                        ) : (
                          <div className="flex-1 bg-surface-2 border border-line py-3 rounded-xl text-sm text-ink-3 text-center">No phone</div>
                        )}
                        <a
                          href={`https://www.google.com/maps/dir/?api=1&destination=${rec.lat},${rec.lng}`}
                          target="_blank" rel="noopener noreferrer"
                          className="flex-1 bg-primary text-white py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-1.5">
                          🗺️ Directions
                        </a>
                      </div>
                    </div>
                  )}

                  {/* Other options */}
                  {others.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-ink-3 uppercase tracking-wider mb-2">Other Options</p>
                      <div className="space-y-2">
                        {others.map((h, i) => (
                          <div key={i} className="bg-surface border border-line rounded-xl p-3.5 flex items-center gap-3">
                            <div className="w-7 h-7 bg-surface-2 border border-line rounded-lg flex items-center justify-center text-xs font-bold text-ink-3">{i + 2}</div>
                            <div className="flex-1 min-w-0">
                              <p className="font-semibold text-ink text-sm truncate">{h.name}</p>
                              <p className="text-xs text-ink-3 truncate">{h.address || `${h.distance_km.toFixed(1)} km away`}</p>
                            </div>
                            <div className="flex flex-col items-end gap-1">
                              <span className="text-xs font-bold text-primary">{h.distance_km.toFixed(1)} km</span>
                              {h.phone && (
                                <a href={`tel:${h.phone}`} className="text-2xs text-success font-semibold">📞 Call</a>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* ── PREP TAB ── */}
            {activeTab === 'prep' && (() => {
              const rawPrep = result.agents.ranker.visit_prep || {};
              const prep = {
                urgency_note:     rawPrep.urgency_note     || '',
                questions_to_ask: rawPrep.questions_to_ask || [],
                what_to_bring:    rawPrep.what_to_bring    || [],
                transport_tip:    rawPrep.transport_tip    || '',
              };
              return (
                <div className="space-y-3">
                  {/* Urgency note */}
                  {prep.urgency_note && (
                    <div className="bg-primary/8 border border-primary/20 rounded-xl px-3.5 py-3 flex items-start gap-2.5">
                      <span className="text-lg flex-shrink-0">⏰</span>
                      <p className="text-sm text-ink-2 leading-relaxed">{prep.urgency_note}</p>
                    </div>
                  )}

                  {/* Transport */}
                  {prep.transport_tip && (
                    <div className="bg-surface border border-line rounded-xl px-3.5 py-3 flex items-start gap-2.5">
                      <span className="text-lg flex-shrink-0">🚗</span>
                      <p className="text-sm text-ink-2">{prep.transport_tip}</p>
                    </div>
                  )}

                  {/* Questions */}
                  {prep.questions_to_ask.length > 0 && (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-xs font-semibold text-ink-3 uppercase tracking-wider">Questions to Ask</p>
                        <button
                          onClick={() => {
                            const text = prep.questions_to_ask.map((q, i) => `${i + 1}. ${q}`).join('\n');
                            navigator.clipboard.writeText(text).then(() => {
                              setQuestionsCopied(true);
                              setTimeout(() => setQuestionsCopied(false), 2000);
                            });
                          }}
                          className={`text-xs font-semibold px-2.5 py-1 rounded-lg border transition-all ${questionsCopied ? 'bg-success/10 border-success/20 text-success' : 'border-line text-ink-2'}`}
                        >
                          {questionsCopied ? '✓ Copied' : '📋 Copy'}
                        </button>
                      </div>
                      <div className="space-y-1.5">
                        {prep.questions_to_ask.map((q, i) => (
                          <div key={i} className="bg-surface border border-line rounded-xl px-3.5 py-2.5 flex items-start gap-2.5">
                            <div className="w-5 h-5 bg-primary/10 rounded-full flex items-center justify-center text-2xs font-bold text-primary flex-shrink-0 mt-0.5">{i + 1}</div>
                            <p className="text-sm text-ink-2">{q}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* What to bring */}
                  {prep.what_to_bring.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-ink-3 uppercase tracking-wider mb-2">What to Bring</p>
                      <div className="bg-surface-2 border border-line rounded-xl overflow-hidden">
                        {prep.what_to_bring.map((item, i) => (
                          <div key={i} className={`flex items-center gap-3 px-3.5 py-2.5 ${i < prep.what_to_bring.length - 1 ? 'border-b border-line' : ''}`}>
                            <span className="text-success text-sm">✓</span>
                            <p className="text-sm text-ink-2">{item}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Disclaimer */}
                  <div className="bg-amber-500/8 border border-amber-500/20 rounded-xl px-3.5 py-3">
                    <p className="text-xs text-amber-700 leading-relaxed">
                      ⚠️ AI-generated analysis. Not a substitute for professional medical advice. Always consult a qualified doctor.
                    </p>
                  </div>
                </div>
              );
            })()}

            {/* New analysis button */}
            <button onClick={reset}
              className="w-full border border-line py-3.5 rounded-2xl text-sm font-semibold text-ink-2 bg-surface active:scale-[0.98] transition-all">
              🔄 Start New Analysis
            </button>

          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
