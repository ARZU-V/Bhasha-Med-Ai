import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';
import { API_BASE, DEMO_USER_ID } from '../config';
import { loadProfile } from '../components/ProfileModal';

type HistoryEntry = {
  userId: string;
  recordId: string;
  timestamp: string;
  condition: string;
  year: string;
  doctorName?: string;
  hospital?: string;
  notes?: string;
  aiSummary?: string;
  docUrl?: string;
};

const GUIDED_QUESTIONS = [
  { key: 'condition',  label: 'What health issue did you have?',   placeholder: 'e.g. knee pain, fever, diabetes...',   required: true  },
  { key: 'year',       label: 'When did this happen?',             placeholder: 'e.g. 2022, 3 years back, last year',  required: true  },
  { key: 'doctorName', label: 'Which doctor did you see?',         placeholder: 'Dr. Sharma (optional)',               required: false },
  { key: 'hospital',   label: 'Hospital or clinic name?',          placeholder: 'Apollo, AIIMS... (optional)',         required: false },
  { key: 'notes',      label: 'Any other details?',                placeholder: 'Tests done, medicines, outcomes...',  required: false },
];

// ── Voice mode constants ─────────────────────────────────────────────────────

const LANG_CODES: Record<string, string> = {
  en: 'en-IN', hi: 'hi-IN', te: 'te-IN', ta: 'ta-IN', mr: 'mr-IN', bn: 'bn-IN',
};

const VOICE_INTRO: Record<string, string> = {
  en: "I'll help you record your medical history. I'll ask a few questions — just speak your answer after each one. Let's start.",
  hi: "मैं आपका स्वास्थ्य इतिहास रिकॉर्ड करने में मदद करूंगा। कुछ सवाल पूछूंगा — हर सवाल के बाद जवाब बोलें। शुरू करते हैं।",
  te: "నేను మీ వైద్య చరిత్రను నమోదు చేయడంలో సహాయం చేస్తాను. కొన్ని ప్రశ్నలు అడుగుతాను — ప్రతి ప్రశ్న తర్వాత మీ సమాధానం చెప్పండి.",
  ta: "நான் உங்கள் மருத்துவ வரலாற்றை பதிவு செய்ய உதவுகிறேன். சில கேள்விகள் கேட்கிறேன் — ஒவ்வொரு கேள்விக்கும் பதில் சொல்லுங்கள்.",
  mr: "मी तुमचा वैद्यकीय इतिहास नोंदवण्यासाठी मदत करतो. काही प्रश्न विचारतो — प्रत्येक प्रश्नानंतर उत्तर द्या.",
  bn: "আমি আপনার চিকিৎসা ইতিহাস রেকর্ড করতে সাহায্য করব। কয়েকটি প্রশ্ন করব — প্রতিটি প্রশ্নের পরে উত্তর দিন।",
};

const VOICE_QUESTIONS: Record<string, string[]> = {
  en: [
    "What health issue or disease did you have? For example: knee pain, fever, diabetes, or back problem.",
    "When did this happen? Tell me the year — like 2022 — or say something like 3 years back.",
    "Which doctor did you see? Say the doctor's name, or say skip to move on.",
    "Which hospital or clinic did you go to? Say the name, or say skip.",
    "Any other details — tests done, medicines taken, or how it turned out? Say done when finished.",
  ],
  hi: [
    "आपको कौन सी बीमारी या तकलीफ थी? जैसे घुटने में दर्द, बुखार, शुगर, या पीठ दर्द।",
    "यह कब हुआ था? साल बताएं जैसे 2022, या कहें 3 साल पहले।",
    "कौन से डॉक्टर को दिखाया था? नाम बताएं, या आगे कहें।",
    "कौन सा अस्पताल या क्लिनिक था? नाम बताएं, या आगे कहें।",
    "कोई और जानकारी? जैसे टेस्ट, दवाइयां, या नतीजा। बस हो गया कहें जब पूरा हो जाए।",
  ],
  te: [
    "మీకు ఏ ఆరోగ్య సమస్య వచ్చింది? ఉదా: మోకాలు నొప్పి, జ్వరం, మధుమేహం, లేదా వెన్ను నొప్పి.",
    "ఇది ఎప్పుడు జరిగింది? 2022 వంటి సంవత్సరం చెప్పండి, లేదా 3 సంవత్సరాల క్రితం అని చెప్పండి.",
    "మీరు ఏ డాక్టర్‌ని చూశారు? పేరు చెప్పండి, లేదా దాటండి అనండి.",
    "ఏ ఆసుపత్రి లేదా క్లినిక్? పేరు చెప్పండి, లేదా దాటండి అనండి.",
    "ఇతర వివరాలు ఏమైనా? పరీక్షలు, మందులు. పూర్తయింది అంటే ముందుకు వెళ్తాం.",
  ],
  ta: [
    "உங்களுக்கு என்ன நோய் அல்லது பிரச்சினை இருந்தது? உதா: முழங்கால் வலி, காய்ச்சல், நீரிழிவு.",
    "இது எப்போது நடந்தது? 2022 போன்ற ஆண்டை சொல்லுங்கள், அல்லது 3 ஆண்டுகளுக்கு முன்பு என்று சொல்லுங்கள்.",
    "எந்த மருத்துவரை பார்த்தீர்கள்? பெயர் சொல்லுங்கள், அல்லது தவிர்க்கவும் என்று சொல்லுங்கள்.",
    "எந்த மருத்துவமனை அல்லது கிளினிக்? பெயர் சொல்லுங்கள், அல்லது தவிர்க்கவும்.",
    "வேறு விவரங்கள்? மருந்துகள், பரிசோதனைகள். முடிந்தது என்றால் சொல்லுங்கள்.",
  ],
  mr: [
    "तुम्हाला कोणता आजार किंवा त्रास होता? उदा: गुडघेदुखी, ताप, मधुमेह.",
    "हे केव्हा झाले? 2022 सारखे वर्ष सांगा, किंवा 3 वर्षांपूर्वी सारखे सांगा.",
    "कोणत्या डॉक्टरांना दाखवले? नाव सांगा, किंवा पुढे म्हणा.",
    "कोणते रुग्णालय किंवा क्लिनिक? नाव सांगा, किंवा पुढे म्हणा.",
    "इतर माहिती? तपासण्या, औषधे. झाले म्हणा जेव्हा संपेल.",
  ],
  bn: [
    "আপনার কী স্বাস্থ্য সমস্যা ছিল? যেমন: হাঁটু ব্যথা, জ্বর, ডায়াবেটিস।",
    "এটি কখন হয়েছিল? 2022 এর মতো বছর বলুন, বা 3 বছর আগে বলুন।",
    "কোন ডাক্তারের কাছে গিয়েছিলেন? নাম বলুন, অথবা এড়িয়ে যান বলুন।",
    "কোন হাসপাতাল বা ক্লিনিক? নাম বলুন, অথবা এড়িয়ে যান বলুন।",
    "অন্য কোনো তথ্য? পরীক্ষা, ওষুধ। শেষ হলে সম্পন্ন বলুন।",
  ],
};

const VOICE_DONE: Record<string, string> = {
  en: "Perfect! Saving your health record now.",
  hi: "बहुत अच्छा! आपका स्वास्थ्य रिकॉर्ड सेव हो रहा है।",
  te: "చాలా బాగుంది! మీ ఆరోగ్య రికార్డు సేవ్ అవుతోంది.",
  ta: "மிகவும் நல்லது! உங்கள் சுகாதார பதிவு சேமிக்கப்படுகிறது.",
  mr: "उत्तम! तुमची आरोग्य नोंद सेव्ह होत आहे.",
  bn: "চমৎকার! আপনার স্বাস্থ্য রেকর্ড সংরক্ষণ হচ্ছে।",
};

// ── Component ────────────────────────────────────────────────────────────────

export default function HistoryTab({ prefillEntry }: { prefillEntry?: Partial<HistoryEntry> }) {
  const [entries,        setEntries]        = useState<HistoryEntry[]>([]);
  const [loading,        setLoading]        = useState(false);
  const [showAddModal,   setShowAddModal]   = useState(false);
  const [summaryText,    setSummaryText]    = useState('');
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [showSummary,    setShowSummary]    = useState(false);
  const [expandedId,     setExpandedId]     = useState<string | null>(null);
  const [saving,         setSaving]         = useState(false);

  // Typed form state
  const [step,     setStep]     = useState(0);
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [docFile,  setDocFile]  = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Voice mode state
  const [voiceMode,     setVoiceMode]     = useState(false);
  const [voicePhase,    setVoicePhase]    = useState<'speaking' | 'listening' | 'idle'>('idle');
  const [voiceCurrentQ, setVoiceCurrentQ] = useState('');
  const [voiceTranscript, setVoiceTranscript] = useState('');
  const voiceTranscriptRef = useRef('');
  const recognitionRef     = useRef<any>(null);

  const profile     = loadProfile();
  const userId      = DEMO_USER_ID;
  const profileLang = (profile?.language || 'en') as string;
  const langCode    = LANG_CODES[profileLang] || 'en-IN';
  const vQuestions  = VOICE_QUESTIONS[profileLang] || VOICE_QUESTIONS.en;

  useEffect(() => { fetchEntries(); }, []);

  useEffect(() => {
    if (prefillEntry) {
      setFormData({
        condition:  prefillEntry.condition  || '',
        year:       prefillEntry.year       || new Date().getFullYear().toString(),
        doctorName: prefillEntry.doctorName || '',
        hospital:   prefillEntry.hospital   || '',
        notes:      prefillEntry.notes      || '',
      });
      setStep(0);
      setVoiceMode(false);
      setShowAddModal(true);
    }
  }, [prefillEntry]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      window.speechSynthesis?.cancel();
      recognitionRef.current?.stop();
    };
  }, []);

  // ── Data fetching ──────────────────────────────────────────────────────────

  const fetchEntries = async () => {
    setLoading(true);
    try {
      const { data } = await axios.get(`${API_BASE}/history?userId=${userId}`);
      setEntries(data.entries || []);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  };

  // ── Typed form ─────────────────────────────────────────────────────────────

  const handleNext = () => {
    const q = GUIDED_QUESTIONS[step];
    if (q.required && !formData[q.key]?.trim()) return;
    if (step < GUIDED_QUESTIONS.length - 1) setStep(s => s + 1);
    else submitEntry();
  };

  const submitEntry = async () => {
    setSaving(true);
    try {
      let docBase64 = '';
      let docName   = '';
      if (docFile) {
        const buf  = await docFile.arrayBuffer();
        docBase64  = btoa(String.fromCharCode(...new Uint8Array(buf)));
        docName    = docFile.name;
      }
      const { data } = await axios.post(`${API_BASE}/history`, {
        userId,
        ...formData,
        docBase64,
        docName,
        language: profileLang,
      });
      setEntries(prev => [data.entry, ...prev]);
      resetForm();
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  const resetForm = () => {
    setShowAddModal(false);
    setStep(0);
    setFormData({});
    setDocFile(null);
    stopVoice();
  };

  // ── Voice helpers ──────────────────────────────────────────────────────────

  const speak = (text: string, onEnd?: () => void) => {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang  = langCode;
    u.rate  = 0.88;
    u.pitch = 1.0;
    if (onEnd) u.onend = onEnd;
    setVoicePhase('speaking');
    setVoiceCurrentQ(text);
    window.speechSynthesis.speak(u);
  };

  const stopVoice = () => {
    window.speechSynthesis?.cancel();
    recognitionRef.current?.stop();
    setVoiceMode(false);
    setVoicePhase('idle');
    setVoiceCurrentQ('');
    setVoiceTranscript('');
  };

  const startListening = (stepIdx: number) => {
    const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRec) { setVoiceMode(false); return; }

    voiceTranscriptRef.current = '';
    setVoiceTranscript('');
    setVoicePhase('listening');

    const rec = new SpeechRec();
    rec.lang            = langCode;
    rec.continuous      = false;
    rec.interimResults  = true;

    rec.onresult = (e: any) => {
      const t = Array.from(e.results as any[]).map((r: any) => r[0].transcript).join('');
      voiceTranscriptRef.current = t;
      setVoiceTranscript(t);
    };

    rec.onend = () => {
      setVoicePhase('idle');
      processVoiceAnswer(stepIdx, voiceTranscriptRef.current);
    };

    rec.onerror = (e: any) => {
      if (e.error === 'no-speech') {
        startListening(stepIdx); // re-listen on silence
      } else {
        setVoicePhase('idle');
      }
    };

    rec.start();
    recognitionRef.current = rec;
  };

  const processVoiceAnswer = (stepIdx: number, answer: string) => {
    const key    = GUIDED_QUESTIONS[stepIdx].key;
    const isSkip = /\b(skip|आगे|దాటండి|தவிர்|done|हो गया|पुढे|এড়িয়ে)\b/i.test(answer);

    if (!isSkip && answer.trim()) {
      setFormData(prev => ({ ...prev, [key]: answer.trim() }));
    }

    const next = stepIdx + 1;
    if (next >= GUIDED_QUESTIONS.length) {
      const doneMsg = VOICE_DONE[profileLang] || VOICE_DONE.en;
      speak(doneMsg, () => {
        setVoiceMode(false);
        setVoicePhase('idle');
        submitEntry();
      });
    } else {
      setStep(next);
      speak(vQuestions[next], () => startListening(next));
    }
  };

  const startVoiceMode = () => {
    const hasSpeech = !!window.speechSynthesis;
    const hasRec    = !!(window as any).SpeechRecognition || !!(window as any).webkitSpeechRecognition;
    if (!hasSpeech || !hasRec) {
      alert('Voice mode needs Chrome or Edge browser with mic permission.');
      return;
    }
    setVoiceMode(true);
    setStep(0);
    setFormData({});
    setVoiceTranscript('');
    voiceTranscriptRef.current = '';
    const intro = VOICE_INTRO[profileLang] || VOICE_INTRO.en;
    speak(`${intro} ${vQuestions[0]}`, () => startListening(0));
  };

  // ── Delete + summary ───────────────────────────────────────────────────────

  const deleteEntry = async (entry: HistoryEntry) => {
    if (!confirm('Remove this entry?')) return;
    try {
      await axios.delete(`${API_BASE}/history?userId=${userId}&recordId=${encodeURIComponent(entry.recordId)}`);
      setEntries(prev => prev.filter(e => e.recordId !== entry.recordId));
      if (expandedId === entry.recordId) setExpandedId(null);
    } catch {}
  };

  const generateSummary = async () => {
    setSummaryLoading(true);
    setShowSummary(true);
    try {
      const { data } = await axios.post(
        `${API_BASE}/history/summary?userId=${userId}`,
        { userId, patientName: profile?.name || '', patientAge: profile?.age || '', knownConditions: profile?.conditions || [] }
      );
      setSummaryText(data.summary || 'No summary generated.');
    } catch {
      setSummaryText('Could not generate summary. Try again.');
    } finally {
      setSummaryLoading(false);
    }
  };

  const q = GUIDED_QUESTIONS[step];

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full">

      {/* Header */}
      <div className="px-4 pt-4 pb-3 flex items-center justify-between">
        <div>
          <h2 className="font-bold text-ink text-base">Medical History</h2>
          <p className="text-2xs text-ink-3 mt-0.5">{entries.length} health events recorded</p>
        </div>
        <button
          onClick={generateSummary}
          disabled={entries.length === 0}
          className="bg-primary/10 border border-primary/20 text-primary text-xs font-semibold px-3 py-2 rounded-lg disabled:opacity-40 flex items-center gap-1.5"
        >
          📋 Doctor Summary
        </button>
      </div>

      {/* Empty state */}
      {!loading && entries.length === 0 && (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6 text-center">
          <span className="text-5xl">🗂️</span>
          <p className="text-ink font-semibold">No history yet</p>
          <p className="text-ink-3 text-sm">Add your past health events — the AI will build a medical timeline for you and your doctor.</p>
          <div className="flex gap-2 mt-2">
            <button
              onClick={() => { setFormData({}); setStep(0); setVoiceMode(false); setShowAddModal(true); }}
              className="bg-surface-2 border border-line text-ink text-sm font-semibold px-4 py-2.5 rounded-xl"
            >
              ⌨️ Type
            </button>
            <button
              onClick={() => { setShowAddModal(true); startVoiceMode(); }}
              className="bg-primary text-white px-4 py-2.5 rounded-xl text-sm font-semibold"
            >
              🎙️ Voice Mode
            </button>
          </div>
        </div>
      )}

      {/* Timeline */}
      <div className="flex-1 overflow-y-auto px-4 pb-28 space-y-3">
        {loading && (
          <div className="space-y-3">
            {[1, 2, 3].map(i => <div key={i} className="bg-surface border border-line rounded-xl h-20 animate-pulse" />)}
          </div>
        )}

        {entries.map((entry, i) => {
          const expanded  = expandedId === entry.recordId;
          const yearLabel = entry.year || 'Unknown year';

          return (
            <motion.div
              key={entry.recordId}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              className="bg-surface border border-line rounded-xl overflow-hidden"
            >
              <button
                onClick={() => setExpandedId(expanded ? null : entry.recordId)}
                className="w-full p-3.5 text-left flex items-start gap-3"
              >
                <div className="flex flex-col items-center gap-1 flex-shrink-0 mt-0.5">
                  <div className="w-7 h-7 bg-primary/10 border border-primary/20 rounded-full flex items-center justify-center">
                    <span className="text-xs">🩺</span>
                  </div>
                  {i < entries.length - 1 && <div className="w-0.5 h-4 bg-line rounded" />}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-ink text-sm truncate capitalize">{entry.condition}</p>
                      <p className="text-2xs text-ink-3 mt-0.5">
                        {yearLabel}
                        {entry.doctorName && ` · Dr. ${entry.doctorName}`}
                        {entry.hospital   && ` · ${entry.hospital}`}
                      </p>
                    </div>
                    <span className="text-ink-3 text-sm flex-shrink-0">{expanded ? '▲' : '▼'}</span>
                  </div>

                  {entry.aiSummary && !expanded && (
                    <p className="text-xs text-ink-2 mt-1.5 line-clamp-2">{entry.aiSummary}</p>
                  )}
                </div>
              </button>

              <AnimatePresence>
                {expanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="border-t border-line px-4 py-3 space-y-2.5 overflow-hidden"
                  >
                    {entry.aiSummary && (
                      <div className="bg-primary/5 border border-primary/15 rounded-lg p-2.5">
                        <p className="text-2xs font-semibold text-primary mb-1">AI Summary</p>
                        <p className="text-xs text-ink-2">{entry.aiSummary}</p>
                      </div>
                    )}
                    {entry.notes && (
                      <div>
                        <p className="text-2xs font-semibold text-ink-3 mb-1">Your Notes</p>
                        <p className="text-xs text-ink-2">{entry.notes}</p>
                      </div>
                    )}
                    {entry.docUrl && (
                      <div className="flex items-center gap-2 bg-surface-2 border border-line rounded-lg px-3 py-2">
                        <span>📄</span>
                        <span className="text-xs text-ink-2 flex-1 truncate">Document uploaded</span>
                      </div>
                    )}
                    <button onClick={() => deleteEntry(entry)} className="text-2xs text-danger/70 mt-1">
                      Remove entry
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </div>

      {/* Floating add button */}
      {entries.length > 0 && (
        <div className="fixed bottom-20 right-4 z-20 flex flex-col gap-2 items-end">
          <button
            onClick={startVoiceMode}
            className="w-12 h-12 bg-success rounded-full shadow-float flex items-center justify-center text-white text-xl"
            title="Voice Mode"
          >
            🎙️
          </button>
          <button
            onClick={() => { setFormData({}); setStep(0); setVoiceMode(false); setShowAddModal(true); }}
            className="w-12 h-12 bg-primary rounded-full shadow-float flex items-center justify-center text-white text-xl"
          >
            +
          </button>
        </div>
      )}

      {/* ── Add Entry Modal ────────────────────────────────────────────────── */}
      <AnimatePresence>
        {showAddModal && (
          <motion.div
            className="fixed inset-0 z-50 flex items-end justify-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="absolute inset-0 bg-black/40" onClick={resetForm} />
            <motion.div
              className="relative w-full max-w-md bg-surface rounded-t-2xl p-5 pb-8 shadow-float"
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', stiffness: 350, damping: 30 }}
            >

              {/* Type / Voice toggle */}
              <div className="flex bg-surface-2 rounded-xl p-0.5 mb-4">
                <button
                  onClick={() => { stopVoice(); }}
                  className={`flex-1 py-2 rounded-[10px] text-xs font-semibold transition-all ${!voiceMode ? 'bg-surface text-ink shadow-sm' : 'text-ink-3'}`}
                >
                  ⌨️ Type
                </button>
                <button
                  onClick={startVoiceMode}
                  className={`flex-1 py-2 rounded-[10px] text-xs font-semibold transition-all ${voiceMode ? 'bg-surface text-ink shadow-sm' : 'text-ink-3'}`}
                >
                  🎙️ Voice
                </button>
              </div>

              {/* Progress dots */}
              <div className="flex gap-1.5 mb-4 justify-center">
                {GUIDED_QUESTIONS.map((_, i) => (
                  <div key={i} className={`h-1 rounded-full transition-all ${i <= step ? 'w-6 bg-primary' : 'w-2 bg-line'}`} />
                ))}
              </div>

              {/* ── Voice Mode UI ────────────────────────────────────────── */}
              {voiceMode ? (
                <div className="flex flex-col items-center gap-4 py-2 min-h-[180px] justify-center">

                  {voicePhase === 'speaking' && (
                    <>
                      <motion.div
                        className="w-16 h-16 rounded-full bg-primary/10 border-2 border-primary/30 flex items-center justify-center"
                        animate={{ scale: [1, 1.08, 1] }}
                        transition={{ repeat: Infinity, duration: 1.2 }}
                      >
                        <span className="text-3xl">🤖</span>
                      </motion.div>
                      <p className="text-2xs text-ink-3 font-medium uppercase tracking-wide">AI is speaking</p>
                      <p className="text-sm text-ink text-center px-2 leading-relaxed">{voiceCurrentQ}</p>
                    </>
                  )}

                  {voicePhase === 'listening' && (
                    <>
                      <motion.div
                        className="w-16 h-16 rounded-full bg-danger/10 border-2 border-danger/40 flex items-center justify-center"
                        animate={{ boxShadow: ['0 0 0 0 rgba(239,68,68,0.3)', '0 0 0 16px rgba(239,68,68,0)', '0 0 0 0 rgba(239,68,68,0)'] }}
                        transition={{ repeat: Infinity, duration: 1.5 }}
                      >
                        <span className="text-3xl">🎙️</span>
                      </motion.div>
                      <p className="text-2xs text-danger font-semibold uppercase tracking-wide">Listening… speak now</p>
                      {voiceTranscript && (
                        <p className="text-sm text-ink text-center px-4 italic opacity-80">"{voiceTranscript}"</p>
                      )}
                    </>
                  )}

                  {voicePhase === 'idle' && (
                    <>
                      <div className="w-16 h-16 rounded-full bg-surface-2 border border-line flex items-center justify-center">
                        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                      </div>
                      <p className="text-xs text-ink-3">Processing…</p>
                    </>
                  )}

                  <button
                    onClick={() => { stopVoice(); }}
                    className="mt-1 text-xs text-ink-3 border border-line rounded-lg px-4 py-2"
                  >
                    ✕ Stop — switch to typing
                  </button>
                </div>
              ) : (
                /* ── Typed form ──────────────────────────────────────────── */
                <>
                  <p className="text-xs text-ink-3 font-medium mb-1">
                    Question {step + 1} of {GUIDED_QUESTIONS.length}
                  </p>
                  <h3 className="font-semibold text-ink text-base mb-3">{q.label}</h3>

                  <textarea
                    autoFocus
                    rows={3}
                    className="w-full bg-surface-2 border border-line rounded-xl px-3 py-2.5 text-sm text-ink placeholder-ink-3 outline-none focus:border-primary resize-none"
                    placeholder={q.placeholder}
                    value={formData[q.key] || ''}
                    onChange={e => setFormData(prev => ({ ...prev, [q.key]: e.target.value }))}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleNext(); } }}
                  />

                  {step === GUIDED_QUESTIONS.length - 1 && (
                    <div className="mt-3">
                      <input
                        type="file"
                        ref={fileRef}
                        className="hidden"
                        accept="image/*,.pdf"
                        onChange={e => setDocFile(e.target.files?.[0] || null)}
                      />
                      <button
                        onClick={() => fileRef.current?.click()}
                        className="flex items-center gap-2 text-xs text-ink-2 border border-dashed border-line rounded-xl px-3 py-2.5 w-full"
                      >
                        <span>📎</span>
                        {docFile ? docFile.name : 'Upload prescription / lab report (optional)'}
                      </button>
                    </div>
                  )}

                  <div className="flex gap-2 mt-4">
                    {step > 0 && (
                      <button
                        onClick={() => setStep(s => s - 1)}
                        className="flex-1 border border-line text-ink-2 py-2.5 rounded-xl text-sm font-semibold"
                      >
                        Back
                      </button>
                    )}
                    <button
                      onClick={handleNext}
                      disabled={saving || (q.required && !formData[q.key]?.trim())}
                      className="flex-1 bg-primary text-white py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50"
                    >
                      {saving ? 'Saving…' : step === GUIDED_QUESTIONS.length - 1 ? '✓ Save Entry' : 'Next →'}
                    </button>
                  </div>

                  {!q.required && step > 0 && (
                    <button onClick={handleNext} className="w-full text-center text-xs text-ink-3 mt-2">
                      Skip this question
                    </button>
                  )}
                </>
              )}

            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Doctor Summary Modal ───────────────────────────────────────────── */}
      <AnimatePresence>
        {showSummary && (
          <motion.div
            className="fixed inset-0 z-50 flex items-end justify-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="absolute inset-0 bg-black/40" onClick={() => setShowSummary(false)} />
            <motion.div
              className="relative w-full max-w-md bg-surface rounded-t-2xl shadow-float flex flex-col"
              style={{ maxHeight: '80vh' }}
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', stiffness: 350, damping: 30 }}
            >
              <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-line flex-shrink-0">
                <div>
                  <h3 className="font-bold text-ink text-sm">Doctor Summary</h3>
                  <p className="text-2xs text-ink-3">AI-generated medical history</p>
                </div>
                <button onClick={() => setShowSummary(false)} className="text-ink-3 text-sm px-2">✕</button>
              </div>

              <div className="overflow-y-auto flex-1 p-4">
                {summaryLoading ? (
                  <div className="flex flex-col items-center gap-3 py-12">
                    <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                    <p className="text-xs text-ink-3">Generating clinical summary…</p>
                  </div>
                ) : (
                  <pre className="text-xs text-ink-2 whitespace-pre-wrap font-sans leading-relaxed">
                    {summaryText}
                  </pre>
                )}
              </div>

              {!summaryLoading && summaryText && (
                <div className="px-4 pb-6 pt-3 border-t border-line flex-shrink-0">
                  <button
                    onClick={() => navigator.clipboard?.writeText(summaryText)}
                    className="w-full bg-primary/10 border border-primary/20 text-primary text-sm font-semibold py-2.5 rounded-xl"
                  >
                    📋 Copy for Doctor
                  </button>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
