import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';
import 'leaflet/dist/leaflet.css';
import { API_BASE, GOOGLE_MAPS_KEY } from '../config';

type Hospital = {
  name: string;
  address: string;
  distance_km: number;
  lat: number;
  lng: number;
  type: 'hospital' | 'clinic' | 'government';
  phone?: string;
  emergency: boolean;
};

type FilterType  = 'all' | 'emergency' | 'clinic' | 'government';
type SheetTab    = 'info' | 'howto' | 'questions';
type BookingPrefill = { doctorName: string; preferredTime: string; patientPhone: string; clinicPhone?: string };

const TYPE_COLORS: Record<string, string> = {
  hospital:   'bg-primary/8 text-primary border border-primary/20',
  clinic:     'bg-success/8 text-success border border-success/20',
  government: 'bg-amber-500/8 text-amber-600 border border-amber-500/20',
};

const TYPE_ICONS: Record<string, string> = {
  hospital: '🏥', clinic: '🩺', government: '🏛️',
};

// ── Visit prep helpers ────────────────────────────────────────────────────────

function getVisitQuestions(condition: string): string[] {
  const t = condition.toLowerCase();
  if (/diabet|sugar|glucose|hba1c/.test(t)) return [
    'What is my current HbA1c level — is it controlled?',
    'Do I need to adjust my insulin or medication dosage?',
    'Which foods should I strictly avoid?',
    'How often should I check blood sugar at home?',
    'Are there any diabetic complications I should watch for?',
  ];
  if (/heart|cardiac|chest|angina|cholesterol|bp|blood pressure|hypertension/.test(t)) return [
    'What is my blood pressure and cholesterol today?',
    'Do I need an ECG, echo, or stress test?',
    'Should I change my diet or exercise routine?',
    'Are my current medicines working as expected?',
    'What warning symptoms should I call you about immediately?',
  ];
  if (/knee|joint|bone|fracture|arthritis|ortho|back|spine/.test(t)) return [
    'Do I need an X-ray or MRI scan?',
    'What exercises will help my recovery?',
    'How long will recovery take?',
    'Should I avoid any activities or movements?',
    'Is surgery a possibility in my case?',
  ];
  if (/fever|viral|infection|cold|flu|cough|throat/.test(t)) return [
    'What is causing my fever or infection?',
    'Are all these medicines safe for me?',
    'When should I expect to feel better?',
    'Do I need any blood tests or cultures?',
    'Should I isolate from my family?',
  ];
  if (/skin|rash|allergy|eczema|psoriasis|derma/.test(t)) return [
    'What is causing this skin condition?',
    'Is this contagious to my family?',
    'Which cream or medicine should I apply?',
    'Should I avoid any foods or environments?',
    'When will it heal completely?',
  ];
  if (/kidney|renal|urine|protein|creatinine/.test(t)) return [
    'What do my creatinine and GFR levels mean?',
    'How much water should I drink per day?',
    'Which foods and medicines should I avoid?',
    'Do I need a dialysis consultation?',
    'How often should I get kidney function tests?',
  ];
  if (/thyroid|tsh|hypothyroid|hyperthyroid/.test(t)) return [
    'What is my current TSH level — is it controlled?',
    'Should my thyroid medication dose be changed?',
    'What symptoms indicate my thyroid is out of control?',
    'Can my thyroid medicine interact with other drugs?',
    'How often should I get a thyroid test?',
  ];
  return [
    'What exactly is my diagnosis?',
    'What treatment or medicines do you recommend?',
    'Are there side effects of the prescribed medicines?',
    'When should I come back for follow-up?',
    'What lifestyle changes will help my condition?',
  ];
}

function getTransportOptions(distanceKm: number) {
  const opts: { icon: string; mode: string; time: string; cost: string; note: string }[] = [];
  if (distanceKm <= 1.5)
    opts.push({ icon: '🚶', mode: 'Walk', time: `${Math.round(distanceKm * 15)} min`, cost: 'Free', note: 'Recommended for short distances' });
  opts.push({ icon: '🛺', mode: 'Auto-rickshaw', time: `${Math.round(distanceKm * 4)} min`, cost: `₹${Math.round(distanceKm * 12 + 15)}–₹${Math.round(distanceKm * 18 + 25)}`, note: 'Quick & affordable' });
  opts.push({ icon: '🚕', mode: 'Ola / Uber', time: `${Math.round(distanceKm * 3 + 5)} min`, cost: `₹${Math.round(distanceKm * 10 + 30)}–₹${Math.round(distanceKm * 15 + 50)}`, note: 'Book from app' });
  if (distanceKm > 3)
    opts.push({ icon: '🚌', mode: 'City Bus', time: `${Math.round(distanceKm * 5 + 10)} min`, cost: '₹10–₹30', note: 'Cheapest option' });
  return opts;
}

const DOCS_CHECKLIST = [
  'Government ID (Aadhaar card)',
  'Previous prescriptions & medicines list',
  'Old test reports (blood test, X-ray, scan)',
  'Health / insurance card (if applicable)',
  'Emergency contact phone number',
  'Cash (₹500–₹1000 for initial fees)',
];

// ─────────────────────────────────────────────────────────────────────────────

export default function HospitalTab({
  onNavigate,
  symptomCondition,
  onConditionUsed,
}: {
  onNavigate?: (tab: string, data?: BookingPrefill) => void;
  symptomCondition?: string;
  onConditionUsed?: () => void;
}) {
  const [hospitals,        setHospitals]        = useState<Hospital[]>([]);
  const [loading,          setLoading]          = useState(false);
  const [locationError,    setLocationError]    = useState('');
  const [userLocation,     setUserLocation]     = useState<{ lat: number; lng: number } | null>(null);
  const [filter,           setFilter]           = useState<FilterType>('all');
  const [searchQuery,      setSearchQuery]      = useState('');
  const [selectedHospital, setSelectedHospital] = useState<Hospital | null>(null);
  const [sheetTab,         setSheetTab]         = useState<SheetTab>('info');
  const [lookupPhone,      setLookupPhone]      = useState('');
  const [lookupLoading,    setLookupLoading]    = useState(false);
  const [mapReady,         setMapReady]         = useState(false);
  const [specialtyBanner,  setSpecialtyBanner]  = useState('');
  const [questionsCopied,  setQuestionsCopied]  = useState(false);
  const [checkedDocs,      setCheckedDocs]      = useState<boolean[]>(new Array(DOCS_CHECKLIST.length).fill(false));

  const mapRef        = useRef<HTMLDivElement>(null);
  const leafletMapRef = useRef<any>(null);
  const markersRef    = useRef<any[]>([]);

  useEffect(() => { fetchNearbyHospitals(); }, []);

  useEffect(() => {
    if (symptomCondition && userLocation) {
      fetchHospitals(userLocation.lat, userLocation.lng, symptomCondition);
      setSpecialtyBanner(symptomCondition);
      onConditionUsed?.();
    } else if (symptomCondition) {
      setSpecialtyBanner(symptomCondition);
    }
  }, [symptomCondition]);

  useEffect(() => {
    if (userLocation && !leafletMapRef.current) initMap();
  }, [userLocation]);

  useEffect(() => {
    if (hospitals.length > 0) refreshMarkers();
  }, [hospitals]);

  const fetchNearbyHospitals = () => {
    setLoading(true);
    setLocationError('');
    if (!navigator.geolocation) {
      setLocationError('Geolocation not supported. Showing hospitals near Delhi.');
      fetchHospitals(28.6139, 77.209);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      pos => {
        const { latitude, longitude } = pos.coords;
        setUserLocation({ lat: latitude, lng: longitude });
        fetchHospitals(latitude, longitude, symptomCondition || undefined);
        if (symptomCondition) onConditionUsed?.();
      },
      () => {
        setLocationError('Could not get your location. Showing hospitals near Delhi.');
        setUserLocation({ lat: 28.6139, lng: 77.209 });
        fetchHospitals(28.6139, 77.209, symptomCondition || undefined);
        if (symptomCondition) onConditionUsed?.();
      },
      { timeout: 8000 }
    );
  };

  const fetchHospitals = async (lat: number, lng: number, condition?: string) => {
    try {
      const cp = condition ? `&condition=${encodeURIComponent(condition)}` : '';
      const { data } = await axios.get(`${API_BASE}/hospitals/nearby?lat=${lat}&lng=${lng}&radius=10${cp}`);
      if (data.specialty) setSpecialtyBanner(data.specialty);
      setHospitals(data.hospitals || []);
    } catch (err: any) {
      const isCors = err?.message?.includes('Network Error') || err?.code === 'ERR_NETWORK';
      setLocationError(
        isCors
          ? 'API blocked by CORS — enable Lambda Proxy Integration in API Gateway.'
          : 'Could not load nearby hospitals. Check your connection and try again.'
      );
      setHospitals([]);
    } finally {
      setLoading(false);
    }
  };

  const initMap = async () => {
    if (!mapRef.current || leafletMapRef.current) return;
    const L = await import('leaflet');
    delete (L.Icon.Default.prototype as any)._getIconUrl;
    L.Icon.Default.mergeOptions({
      iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
      iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
      shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
    });
    const map = L.map(mapRef.current).setView([userLocation!.lat, userLocation!.lng], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
    }).addTo(map);
    const userIcon = L.divIcon({
      html: '<div style="width:14px;height:14px;background:#0A84FF;border-radius:50%;border:3px solid white;box-shadow:0 0 0 3px rgba(10,132,255,0.3)"></div>',
      className: '', iconSize: [14, 14], iconAnchor: [7, 7],
    });
    L.marker([userLocation!.lat, userLocation!.lng], { icon: userIcon }).addTo(map).bindPopup('You are here');
    leafletMapRef.current = map;
    setMapReady(true);
  };

  const refreshMarkers = async () => {
    if (!leafletMapRef.current) return;
    const L = await import('leaflet');
    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];
    hospitals.forEach(h => {
      const color = h.emergency ? '#FF3B30' : h.type === 'government' ? '#FF9F0A' : '#30D158';
      const icon = L.divIcon({
        html: `<div style="width:32px;height:32px;background:${color};border-radius:50%;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;font-size:14px">${TYPE_ICONS[h.type] || '🏥'}</div>`,
        className: '', iconSize: [32, 32], iconAnchor: [16, 16],
      });
      const marker = L.marker([h.lat, h.lng], { icon })
        .addTo(leafletMapRef.current)
        .bindPopup(`<div style="font-family:-apple-system,sans-serif;min-width:160px"><b style="font-size:13px">${h.name}</b><br/><span style="font-size:11px;color:#666">${h.address}</span><br/><span style="font-size:11px;color:#0A84FF;font-weight:600">${h.distance_km.toFixed(1)} km away</span>${h.emergency ? '<br/><span style="font-size:11px;color:#FF3B30;font-weight:600">🚨 24/7 Emergency</span>' : ''}</div>`);
      markersRef.current.push(marker);
    });
    if (hospitals.length > 0 && userLocation) {
      const allCoords: [number, number][] = [
        [userLocation.lat, userLocation.lng],
        ...hospitals.slice(0, 10).map(h => [h.lat, h.lng] as [number, number]),
      ];
      leafletMapRef.current.fitBounds(allCoords, { padding: [30, 30], maxZoom: 14 });
    }
  };

  const lookupHospitalPhone = async (hospital: Hospital) => {
    setLookupLoading(true);
    setLookupPhone('');
    try {
      if (!GOOGLE_MAPS_KEY || GOOGLE_MAPS_KEY === 'YOUR_API_KEY_2_HERE') {
        setLookupPhone('not-found'); return;
      }
      const searchPlaces = async (query: string, radius: number) => {
        const r = await fetch(
          `https://places.googleapis.com/v1/places:searchText?key=${GOOGLE_MAPS_KEY}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Goog-FieldMask': 'places.nationalPhoneNumber,places.internationalPhoneNumber' },
            body: JSON.stringify({ textQuery: query, locationBias: { circle: { center: { latitude: hospital.lat, longitude: hospital.lng }, radius } }, maxResultCount: 3 }),
          }
        );
        const data = await r.json();
        const place = data.places?.find((p: any) => p.nationalPhoneNumber || p.internationalPhoneNumber);
        return place?.nationalPhoneNumber || place?.internationalPhoneNumber || '';
      };
      let phone = await searchPlaces(hospital.name, 1000);
      if (!phone) phone = await searchPlaces(`${hospital.name} hospital`, 5000);
      if (!phone) {
        const shortName = hospital.name.split(' ').slice(0, 2).join(' ');
        phone = await searchPlaces(shortName + ' hospital', 5000);
      }
      if (phone) {
        setLookupPhone(phone);
        setHospitals(prev => prev.map(h => h.name === hospital.name ? { ...h, phone } : h));
        setSelectedHospital(prev => prev?.name === hospital.name ? { ...prev, phone } : prev);
      } else {
        setLookupPhone('not-found');
      }
    } catch { setLookupPhone('not-found'); }
    finally { setLookupLoading(false); }
  };

  const openHospital = (hospital: Hospital) => {
    if (leafletMapRef.current) {
      leafletMapRef.current.flyTo([hospital.lat, hospital.lng], 16, { duration: 1.2 });
    }
    setSelectedHospital(hospital);
    setSheetTab('info');
    setLookupPhone('');
    setCheckedDocs(new Array(DOCS_CHECKLIST.length).fill(false));
    setQuestionsCopied(false);
  };

  const filtered = hospitals
    .filter(h => {
      if (filter === 'emergency') return h.emergency;
      if (filter === 'clinic')    return h.type === 'clinic';
      if (filter === 'government')return h.type === 'government';
      return true;
    })
    .filter(h => !searchQuery || h.name.toLowerCase().includes(searchQuery.toLowerCase()) || h.address.toLowerCase().includes(searchQuery.toLowerCase()));

  const resolvedPhone = selectedHospital?.phone || (lookupPhone !== 'not-found' ? lookupPhone : '');

  return (
    <div className="flex flex-col h-full">

      {/* ── Map ── */}
      <div className="relative" style={{ height: '240px' }}>
        <div ref={mapRef} className="w-full h-full bg-surface-2" />
        {!mapReady && (
          <div className="absolute inset-0 bg-surface-2 flex flex-col items-center justify-center gap-2">
            {loading ? (
              <>
                <div className="w-7 h-7 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                <p className="text-xs text-ink-3">Finding hospitals near you...</p>
              </>
            ) : (
              <><span className="text-3xl">🗺️</span><p className="text-xs text-ink-3">Loading map...</p></>
            )}
          </div>
        )}
        <button onClick={fetchNearbyHospitals}
          className="absolute top-3 right-3 z-[500] bg-surface border border-line rounded-lg px-3 py-1.5 text-xs font-semibold text-ink-2 flex items-center gap-1.5 shadow-card">
          <span>📍</span> Refresh
        </button>
      </div>

      {/* ── Location warning ── */}
      {locationError && (
        <div className="mx-4 mt-3 bg-warning/8 border border-warning/20 rounded-lg px-3 py-2.5 text-xs text-ink-2 flex items-start gap-2">
          <span className="mt-0.5">⚠️</span><span>{locationError}</span>
        </div>
      )}

      {/* ── Specialty banner ── */}
      {specialtyBanner && (
        <div className="mx-4 mt-3 bg-primary/8 border border-primary/20 rounded-lg px-3 py-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span>🎯</span>
            <p className="text-xs text-ink-2">Showing <span className="font-semibold text-primary">{specialtyBanner}</span> specialists</p>
          </div>
          <button onClick={() => { setSpecialtyBanner(''); fetchNearbyHospitals(); }} className="text-ink-3 text-xs ml-2">✕</button>
        </div>
      )}

      {/* ── Search bar ── */}
      <div className="px-4 pt-3 pb-1">
        <div className="flex items-center gap-2 bg-surface-2 border border-line rounded-xl px-3 py-2.5">
          <span className="text-sm">🔍</span>
          <input
            type="text"
            placeholder="Search hospitals or area..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-3"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="text-ink-3 text-xs">✕</button>
          )}
        </div>
      </div>

      {/* ── Filters ── */}
      <div className="px-4 py-2 flex gap-2 overflow-x-auto">
        {(['all', 'emergency', 'clinic', 'government'] as FilterType[]).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap border transition-all ${
              filter === f ? 'bg-primary text-white border-primary' : 'bg-surface text-ink-2 border-line'
            }`}>
            {f === 'emergency' ? '🚨 Emergency' : f === 'clinic' ? '🩺 Clinic' : f === 'government' ? '🏛️ Govt' : '🏥 All'}
          </button>
        ))}
        <span className="text-2xs text-ink-3 self-center whitespace-nowrap ml-1 font-medium">{filtered.length} found</span>
      </div>

      {/* ── Hospital List ── */}
      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-2.5">
        {loading && hospitals.length === 0 ? (
          <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="bg-surface border border-line rounded-xl h-24 animate-pulse" />)}</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 space-y-2">
            <span className="text-3xl">🏥</span>
            <p className="text-ink-2 text-sm">{searchQuery ? 'No hospitals match your search' : 'No hospitals for this filter'}</p>
          </div>
        ) : (
          filtered.map((hospital, i) => (
            <motion.div key={i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
              onClick={() => openHospital(hospital)}
              className={`bg-surface rounded-xl p-3.5 cursor-pointer transition-all border ${
                selectedHospital?.name === hospital.name ? 'border-primary ring-1 ring-primary/20' : 'border-line'
              }`}>
              <div className="flex items-start gap-3">
                <div className="w-7 h-7 bg-surface-2 border border-line rounded-lg flex items-center justify-center text-xs font-bold text-ink-2 flex-shrink-0 mt-0.5">{i + 1}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <p className="font-semibold text-ink text-sm truncate">{hospital.name}</p>
                        {i === 0 && <span className="text-2xs bg-success/10 text-success border border-success/20 px-1.5 py-0.5 rounded-full font-semibold flex-shrink-0">Best Match</span>}
                      </div>
                      <p className="text-xs text-ink-3 mt-0.5 truncate">{hospital.address}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      <span className="text-xs font-bold text-primary">{hospital.distance_km.toFixed(1)} km</span>
                      {hospital.emergency && (
                        <span className="text-2xs bg-danger/8 text-danger border border-danger/15 px-1.5 py-0.5 rounded-full font-semibold whitespace-nowrap">🚨 24/7</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    <span className={`text-2xs px-2 py-0.5 rounded-full font-semibold ${TYPE_COLORS[hospital.type] || 'bg-surface-2 text-ink-3 border border-line'}`}>
                      {TYPE_ICONS[hospital.type]} {hospital.type.charAt(0).toUpperCase() + hospital.type.slice(1)}
                    </span>
                    <span className="text-2xs text-ink-3 ml-auto">Tap for visit guide →</span>
                  </div>
                </div>
              </div>
            </motion.div>
          ))
        )}
      </div>

      {/* ── Visit Prep Bottom Sheet ── */}
      <AnimatePresence>
        {selectedHospital && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setSelectedHospital(null)}
              className="fixed inset-0 bg-black/30 z-20"
            />

            {/* Sheet */}
            <motion.div
              initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md bg-surface rounded-t-3xl shadow-2xl z-30"
              style={{ maxHeight: '72vh' }}
            >
              <div className="overflow-y-auto" style={{ maxHeight: '72vh' }}>

                {/* Drag handle */}
                <div className="flex justify-center pt-2.5 pb-1">
                  <div className="w-10 h-1 bg-line rounded-full" />
                </div>

                {/* Header */}
                <div className="px-4 pb-3 flex items-start justify-between">
                  <div className="min-w-0 pr-2">
                    <p className="font-bold text-ink text-base leading-tight">{selectedHospital.name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-ink-3">{selectedHospital.distance_km.toFixed(1)} km away</span>
                      <span className="text-2xs text-ink-3">·</span>
                      <span className={`text-2xs px-1.5 py-0.5 rounded-full font-semibold ${TYPE_COLORS[selectedHospital.type]}`}>
                        {TYPE_ICONS[selectedHospital.type]} {selectedHospital.type}
                      </span>
                      {selectedHospital.emergency && <span className="text-2xs bg-danger/8 text-danger border border-danger/15 px-1.5 py-0.5 rounded-full font-semibold">🚨 24/7</span>}
                    </div>
                  </div>
                  <button onClick={() => setSelectedHospital(null)} className="text-ink-3 p-1 flex-shrink-0">
                    <span className="text-lg leading-none">×</span>
                  </button>
                </div>

                {/* Tab bar */}
                <div className="flex border-b border-line px-4">
                  {(['info', 'howto', 'questions'] as SheetTab[]).map((tab, i) => (
                    <button key={tab} onClick={() => setSheetTab(tab)}
                      className={`flex-1 py-2.5 text-xs font-semibold border-b-2 transition-all ${
                        sheetTab === tab ? 'border-primary text-primary' : 'border-transparent text-ink-3'
                      }`}>
                      {i === 0 ? '📍 Info' : i === 1 ? '🗺️ How to Go' : '❓ Ask Doctor'}
                    </button>
                  ))}
                </div>

                {/* Tab content */}
                <div className="px-4 pt-4 pb-8">

                  {/* ── Info tab ── */}
                  {sheetTab === 'info' && (
                    <div className="space-y-3">
                      <div className="bg-surface-2 border border-line rounded-xl p-3 space-y-2 text-sm">
                        <div className="flex items-start gap-2">
                          <span className="mt-0.5">📍</span>
                          <p className="text-ink-2 leading-relaxed">{selectedHospital.address}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span>📏</span>
                          <p className="text-ink-2">{selectedHospital.distance_km.toFixed(1)} km from your location</p>
                        </div>
                        {selectedHospital.emergency && (
                          <div className="flex items-center gap-2">
                            <span>🚨</span>
                            <p className="text-danger font-semibold text-xs">24/7 Emergency services available</p>
                          </div>
                        )}
                      </div>

                      <div className="flex flex-col gap-2">
                        {/* Phone */}
                        {resolvedPhone ? (
                          <a href={`tel:${resolvedPhone}`}
                            className="w-full bg-success text-white py-3.5 rounded-xl font-semibold text-sm flex items-center justify-center gap-2">
                            📞 Call {resolvedPhone}
                          </a>
                        ) : lookupPhone === 'not-found' ? (
                          <div className="w-full bg-surface-2 border border-line py-3 rounded-xl text-xs text-ink-3 text-center">Phone number not available</div>
                        ) : (
                          <button onClick={() => lookupHospitalPhone(selectedHospital)} disabled={lookupLoading}
                            className="w-full bg-success/10 border border-success/20 text-success py-3.5 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-60">
                            {lookupLoading ? '⏳ Finding number...' : '📞 Find Phone Number'}
                          </button>
                        )}

                        {/* Directions */}
                        <a href={`https://www.google.com/maps/dir/?api=1&destination=${selectedHospital.lat},${selectedHospital.lng}`}
                          target="_blank" rel="noopener noreferrer"
                          className="w-full bg-primary text-white py-3.5 rounded-xl font-semibold text-sm flex items-center justify-center gap-2">
                          🗺️ Get Directions
                        </a>

                        {/* Book Appointment */}
                        {onNavigate && (
                          <button onClick={() => {
                            const phone = resolvedPhone;
                            onNavigate('appointments', { doctorName: selectedHospital.name, clinicPhone: phone, preferredTime: '', patientPhone: '' });
                          }}
                            className="w-full bg-violet-500/10 border border-violet-500/20 text-violet-600 py-3.5 rounded-xl font-semibold text-sm flex items-center justify-center gap-2">
                            📅 Book Appointment
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {/* ── How to Go tab ── */}
                  {sheetTab === 'howto' && (
                    <div className="space-y-4">
                      {/* Transport options */}
                      <div>
                        <p className="text-xs font-semibold text-ink-3 uppercase tracking-wider mb-2.5">Transport Options</p>
                        <div className="space-y-2">
                          {getTransportOptions(selectedHospital.distance_km).map((opt, i) => (
                            <div key={i} className="bg-surface-2 border border-line rounded-xl px-3.5 py-3 flex items-center gap-3">
                              <div className="w-9 h-9 bg-surface border border-line rounded-xl flex items-center justify-center text-xl flex-shrink-0">
                                {opt.icon}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-baseline justify-between gap-2">
                                  <p className="text-sm font-semibold text-ink">{opt.mode}</p>
                                  <p className="text-xs font-bold text-primary">{opt.cost}</p>
                                </div>
                                <div className="flex items-center gap-2 mt-0.5">
                                  <span className="text-xs text-ink-3">⏱ {opt.time}</span>
                                  {opt.note && <span className="text-2xs text-success">{opt.note}</span>}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Directions button */}
                      <a href={`https://www.google.com/maps/dir/?api=1&destination=${selectedHospital.lat},${selectedHospital.lng}`}
                        target="_blank" rel="noopener noreferrer"
                        className="w-full bg-primary text-white py-3.5 rounded-xl font-semibold text-sm flex items-center justify-center gap-2">
                        📍 Open in Google Maps
                      </a>

                      {/* Documents checklist */}
                      <div>
                        <p className="text-xs font-semibold text-ink-3 uppercase tracking-wider mb-2.5">What to Bring</p>
                        <div className="bg-surface-2 border border-line rounded-xl overflow-hidden">
                          {DOCS_CHECKLIST.map((doc, i) => (
                            <button key={i}
                              onClick={() => setCheckedDocs(prev => { const n = [...prev]; n[i] = !n[i]; return n; })}
                              className={`w-full flex items-center gap-3 px-3.5 py-2.5 transition-all text-left ${i < DOCS_CHECKLIST.length - 1 ? 'border-b border-line' : ''}`}>
                              <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-all ${
                                checkedDocs[i] ? 'bg-success border-success' : 'border-line bg-surface'
                              }`}>
                                {checkedDocs[i] && <span className="text-white text-xs leading-none">✓</span>}
                              </div>
                              <span className={`text-sm ${checkedDocs[i] ? 'text-ink-3 line-through' : 'text-ink-2'}`}>{doc}</span>
                            </button>
                          ))}
                        </div>
                        <p className="text-2xs text-ink-3 mt-2 text-center">
                          {checkedDocs.filter(Boolean).length} of {DOCS_CHECKLIST.length} items packed
                        </p>
                      </div>
                    </div>
                  )}

                  {/* ── Questions tab ── */}
                  {sheetTab === 'questions' && (
                    <div className="space-y-4">
                      <div className="bg-primary/8 border border-primary/20 rounded-xl px-3.5 py-3">
                        <p className="text-xs text-ink-2 leading-relaxed">
                          These questions are tailored based on{specialtyBanner ? ` <strong>${specialtyBanner}</strong>` : ' your visit'}. Ask these when you meet the doctor.
                        </p>
                      </div>

                      <div className="space-y-2">
                        {getVisitQuestions(specialtyBanner || selectedHospital.name).map((q, i) => (
                          <div key={i} className="bg-surface-2 border border-line rounded-xl px-3.5 py-3 flex items-start gap-3">
                            <div className="w-6 h-6 bg-primary/10 rounded-full flex items-center justify-center text-xs font-bold text-primary flex-shrink-0 mt-0.5">{i + 1}</div>
                            <p className="text-sm text-ink-2 leading-relaxed">{q}</p>
                          </div>
                        ))}
                      </div>

                      <button
                        onClick={() => {
                          const questions = getVisitQuestions(specialtyBanner || selectedHospital.name);
                          const text = questions.map((q, i) => `${i + 1}. ${q}`).join('\n');
                          navigator.clipboard.writeText(`Questions to ask at ${selectedHospital.name}:\n\n${text}`).then(() => {
                            setQuestionsCopied(true);
                            setTimeout(() => setQuestionsCopied(false), 2000);
                          });
                        }}
                        className="w-full bg-surface-2 border border-line py-3.5 rounded-xl font-semibold text-sm text-ink-2 flex items-center justify-center gap-2">
                        {questionsCopied ? '✓ Copied to clipboard!' : '📋 Copy All Questions'}
                      </button>

                      <div className="bg-amber-500/8 border border-amber-500/20 rounded-xl px-3.5 py-3">
                        <p className="text-xs text-amber-700 leading-relaxed">
                          💡 <strong>Tip:</strong> Show these questions on your phone screen to the doctor — they'll appreciate a prepared patient!
                        </p>
                      </div>
                    </div>
                  )}

                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
