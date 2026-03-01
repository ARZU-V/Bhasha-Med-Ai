import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';
import 'leaflet/dist/leaflet.css';
import { API_BASE } from '../config';

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

type FilterType = 'all' | 'emergency' | 'clinic' | 'government';

const TYPE_COLORS: Record<string, string> = {
  hospital:   'bg-blue-50 text-blue-600 border border-blue-100',
  clinic:     'bg-emerald-50 text-emerald-600 border border-emerald-100',
  government: 'bg-amber-50 text-amber-600 border border-amber-100',
};

const TYPE_ICONS: Record<string, string> = {
  hospital: '🏥',
  clinic: '🩺',
  government: '🏛️',
};

export default function HospitalTab() {
  const [hospitals,      setHospitals]      = useState<Hospital[]>([]);
  const [loading,        setLoading]        = useState(false);
  const [locationError,  setLocationError]  = useState('');
  const [userLocation,   setUserLocation]   = useState<{ lat: number; lng: number } | null>(null);
  const [filter,         setFilter]         = useState<FilterType>('all');
  const [selectedHospital, setSelectedHospital] = useState<Hospital | null>(null);
  const [mapReady,       setMapReady]       = useState(false);
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMapRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);

  useEffect(() => {
    fetchNearbyHospitals();
  }, []);

  // Init map once when location is known
  useEffect(() => {
    if (userLocation && !leafletMapRef.current) {
      initMap();
    }
  }, [userLocation]);

  // Update markers whenever hospitals list changes (works on first load AND refresh)
  useEffect(() => {
    if (hospitals.length > 0) {
      refreshMarkers();
    }
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
        fetchHospitals(latitude, longitude);
      },
      () => {
        setLocationError('Could not get your location. Showing hospitals near Delhi.');
        setUserLocation({ lat: 28.6139, lng: 77.209 });
        fetchHospitals(28.6139, 77.209);
      },
      { timeout: 8000 }
    );
  };

  const fetchHospitals = async (lat: number, lng: number) => {
    try {
      const { data } = await axios.get(
        `${API_BASE}/hospitals/nearby?lat=${lat}&lng=${lng}&radius=10`
      );
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

    const map = L.map(mapRef.current).setView(
      [userLocation!.lat, userLocation!.lng], 13
    );

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
    }).addTo(map);

    // Blue dot for user location
    const userIcon = L.divIcon({
      html: '<div style="width:14px;height:14px;background:#0A84FF;border-radius:50%;border:3px solid white;box-shadow:0 0 0 3px rgba(10,132,255,0.3)"></div>',
      className: '',
      iconSize: [14, 14],
      iconAnchor: [7, 7],
    });
    L.marker([userLocation!.lat, userLocation!.lng], { icon: userIcon })
      .addTo(map)
      .bindPopup('You are here');

    leafletMapRef.current = map;
    setMapReady(true);
    // markers will be added by the hospitals useEffect
  };

  const refreshMarkers = async () => {
    if (!leafletMapRef.current) return;

    const L = await import('leaflet');

    // Clear old hospital markers
    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];

    hospitals.forEach(h => {
      const color = h.emergency ? '#FF3B30' : h.type === 'government' ? '#FF9F0A' : '#30D158';
      const icon = L.divIcon({
        html: `<div style="width:32px;height:32px;background:${color};border-radius:50%;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;font-size:14px">${TYPE_ICONS[h.type] || '🏥'}</div>`,
        className: '',
        iconSize: [32, 32],
        iconAnchor: [16, 16],
      });

      const marker = L.marker([h.lat, h.lng], { icon })
        .addTo(leafletMapRef.current)
        .bindPopup(`
          <div style="font-family:-apple-system,sans-serif;min-width:160px">
            <b style="font-size:13px">${h.name}</b><br/>
            <span style="font-size:11px;color:#666">${h.address}</span><br/>
            <span style="font-size:11px;color:#0A84FF;font-weight:600">${h.distance_km.toFixed(1)} km away</span>
            ${h.emergency ? '<br/><span style="font-size:11px;color:#FF3B30;font-weight:600">🚨 24/7 Emergency</span>' : ''}
          </div>
        `);

      markersRef.current.push(marker);
    });

    // Fit map to show all markers
    if (hospitals.length > 0 && userLocation) {
      const allCoords: [number, number][] = [
        [userLocation.lat, userLocation.lng],
        ...hospitals.slice(0, 10).map(h => [h.lat, h.lng] as [number, number]),
      ];
      leafletMapRef.current.fitBounds(allCoords, { padding: [30, 30], maxZoom: 14 });
    }
  };

  const flyToHospital = (hospital: Hospital) => {
    if (leafletMapRef.current) {
      leafletMapRef.current.flyTo([hospital.lat, hospital.lng], 16, { duration: 1.2 });
    }
    setSelectedHospital(hospital);
  };

  const filtered = hospitals.filter(h => {
    if (filter === 'all') return true;
    if (filter === 'emergency') return h.emergency;
    if (filter === 'clinic') return h.type === 'clinic';
    if (filter === 'government') return h.type === 'government';
    return true;
  });

  return (
    <div className="flex flex-col h-full">
      {/* Map Container */}
      <div className="relative" style={{ height: '260px' }}>
        <div ref={mapRef} className="w-full h-full bg-gray-100" />

        {/* Map loading overlay */}
        {!mapReady && (
          <div className="absolute inset-0 bg-surface-2 flex flex-col items-center justify-center gap-2">
            {loading ? (
              <>
                <div className="w-7 h-7 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                <p className="text-xs text-ink-3">Finding hospitals near you...</p>
              </>
            ) : (
              <>
                <span className="text-3xl">🗺️</span>
                <p className="text-xs text-ink-3">Loading map...</p>
              </>
            )}
          </div>
        )}

        {/* Refresh button */}
        <button
          onClick={fetchNearbyHospitals}
          className="absolute top-3 right-3 z-[500] bg-surface border border-line rounded-lg px-3 py-1.5 text-xs font-semibold text-ink-2 flex items-center gap-1.5 shadow-card"
        >
          <span>📍</span> Refresh
        </button>
      </div>

      {/* Location warning */}
      {locationError && (
        <div className="mx-4 mt-3 bg-warning/8 border border-warning/20 rounded-lg px-3 py-2.5 text-xs text-ink-2 flex items-start gap-2">
          <span className="mt-0.5">⚠️</span>
          <span>{locationError}</span>
        </div>
      )}

      {/* Filters */}
      <div className="px-4 py-3 flex gap-2 overflow-x-auto">
        {(['all', 'emergency', 'clinic', 'government'] as FilterType[]).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap border transition-all ${
              filter === f
                ? 'bg-primary text-white border-primary'
                : 'bg-surface text-ink-2 border-line'
            }`}>
            {f === 'emergency' ? '🚨 Emergency' :
             f === 'clinic'    ? '🩺 Clinic' :
             f === 'government'? '🏛️ Govt' : '🏥 All'}
          </button>
        ))}
        <span className="text-2xs text-ink-3 self-center whitespace-nowrap ml-1 font-medium">
          {filtered.length} found
        </span>
      </div>

      {/* Hospital List */}
      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-3">
        {loading && hospitals.length === 0 ? (
          <div className="space-y-2">
            {[1,2,3].map(i => <div key={i} className="bg-surface border border-line rounded-xl h-24 animate-pulse" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 space-y-2">
            <span className="text-3xl">🏥</span>
            <p className="text-ink-2 text-sm">No hospitals for this filter</p>
          </div>
        ) : (
          filtered.map((hospital, i) => (
            <motion.div key={i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
              onClick={() => flyToHospital(hospital)}
              className={`bg-surface rounded-xl p-3.5 cursor-pointer transition-all border ${
                selectedHospital?.name === hospital.name ? 'border-primary ring-1 ring-primary/20' : 'border-line'
              }`}>
              <div className="flex items-start gap-3">
                {/* Rank */}
                <div className="w-7 h-7 bg-surface-2 border border-line rounded-lg flex items-center justify-center text-xs font-bold text-ink-2 flex-shrink-0 mt-0.5">
                  {i + 1}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-ink text-sm truncate">{hospital.name}</p>
                      <p className="text-xs text-ink-3 mt-0.5 truncate">{hospital.address}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      <span className="text-xs font-bold text-primary">{hospital.distance_km.toFixed(1)} km</span>
                      {hospital.emergency && (
                        <span className="text-2xs bg-danger/8 text-danger border border-danger/15 px-1.5 py-0.5 rounded-full font-semibold whitespace-nowrap">
                          🚨 24/7
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 mt-2">
                    <span className={`text-2xs px-2 py-0.5 rounded-full font-semibold ${TYPE_COLORS[hospital.type] || 'bg-surface-2 text-ink-3 border border-line'}`}>
                      {TYPE_ICONS[hospital.type]} {hospital.type.charAt(0).toUpperCase() + hospital.type.slice(1)}
                    </span>
                    <div className="flex gap-1.5 ml-auto">
                      <a href={`https://www.google.com/maps/dir/?api=1&destination=${hospital.lat},${hospital.lng}`}
                        target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
                        className="bg-primary/8 border border-primary/20 text-primary px-2.5 py-1 rounded-lg text-2xs font-semibold flex items-center gap-1">
                        🗺️ Go
                      </a>
                      {hospital.phone && (
                        <a href={`tel:${hospital.phone}`} onClick={e => e.stopPropagation()}
                          className="bg-success/8 border border-success/20 text-success px-2.5 py-1 rounded-lg text-2xs font-semibold flex items-center gap-1">
                          📞 Call
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          ))
        )}
      </div>

      {/* Selected hospital quick action */}
      <AnimatePresence>
        {selectedHospital && (
          <motion.div
            initial={{ y: 72, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 72, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className="fixed bottom-20 left-1/2 -translate-x-1/2 w-full max-w-md px-4 z-30"
          >
            <div className="bg-ink rounded-xl p-3.5 flex items-center justify-between shadow-float">
              <div className="min-w-0">
                <p className="text-white font-semibold text-sm truncate">{selectedHospital.name}</p>
                <p className="text-ink-3 text-xs">{selectedHospital.distance_km.toFixed(1)} km · {selectedHospital.type}</p>
              </div>
              <div className="flex gap-2 flex-shrink-0 ml-3">
                <a
                  href={`https://www.google.com/maps/dir/?api=1&destination=${selectedHospital.lat},${selectedHospital.lng}`}
                  target="_blank" rel="noopener noreferrer"
                  className="bg-primary text-white px-3 py-1.5 rounded-lg text-xs font-semibold"
                >
                  Directions
                </a>
                <button onClick={() => setSelectedHospital(null)} className="text-ink-3 px-1.5 text-sm">✕</button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

