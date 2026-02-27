import { useState, useRef, useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, Circle, CircleMarker, Marker, Tooltip, useMapEvents, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
// Fix Leaflet default icon paths with Vite
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

function MapInvalidator({ trigger }) {
  const map = useMap();
  useEffect(() => {
    const t = setTimeout(() => map.invalidateSize(), 50);
    return () => clearTimeout(t);
  }, [trigger, map]);
  return null;
}

function MapClickHandler({ pickingMode, onPick }) {
  const map = useMapEvents({
    click(e) {
      if (pickingMode) onPick(e.latlng.lat, e.latlng.lng);
    },
  });
  useEffect(() => {
    const container = map.getContainer();
    container.style.cursor = pickingMode ? 'crosshair' : '';
    return () => { container.style.cursor = ''; };
  }, [pickingMode, map]);
  return null;
}

const KEYWORD_COLORS = [
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // violet
  '#06b6d4', // cyan
  '#ec4899', // pink
  '#84cc16', // lime
  '#a855f7', // purple
  '#14b8a6', // teal
  '#e11d48', // rose
];

function keywordColor(keyword) {
  const key = (keyword || '').trim().toLowerCase();
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) & 0xffffffff;
  }
  return KEYWORD_COLORS[Math.abs(hash) % KEYWORD_COLORS.length];
}

function generateGridPoints(centerLat, centerLng, radiusM, gridStepM) {
  const points = [];
  if (!radiusM || !gridStepM) return points;
  const latStepDeg = gridStepM / 111320.0;
  const numSteps = Math.ceil(radiusM / gridStepM);
  for (let i = -numSteps; i <= numSteps; i++) {
    for (let j = -numSteps; j <= numSteps; j++) {
      const xOff = i * gridStepM;
      const yOff = j * gridStepM;
      if (Math.sqrt(xOff * xOff + yOff * yOff) <= radiusM) {
        const lat = centerLat + (i * latStepDeg);
        const lngStep = gridStepM / (111320.0 * Math.cos(lat * Math.PI / 180));
        const lng = centerLng + (j * lngStep);
        points.push([lat, lng]);
      }
    }
  }
  return points;
}

function App() {
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'dark');
  const [lists, setLists] = useState([]);
  const [selectedList, setSelectedList] = useState('');
  const [newListName, setNewListName] = useState('');

  const [city, setCity] = useState('');
  const [radius, setRadius] = useState('2000');
  const [gridStep, setGridStep] = useState('500');
  const [keywords, setKeywords] = useState('');

  const [isScraping, setIsScraping] = useState(false);
  const [progress, setProgress] = useState({ value: 0, label: '', subtype: '' });
  const [logs, setLogs] = useState([]);
  const [results, setResults] = useState([]);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [sortConfig, setSortConfig] = useState({ field: 'Data Estrazione', direction: 'desc' });
  const [contactedFilter, setContactedFilter] = useState('all');
  const [interestedFilter, setInterestedFilter] = useState('all');
  const [noteFilter, setNoteFilter] = useState('all');
  const [ricercaFilter, setRicercaFilter] = useState(new Set());
  const [showFilterDropdown, setShowFilterDropdown] = useState(false);
  const [nameSearch, setNameSearch] = useState('');
  const [previewCenter, setPreviewCenter] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [pastSearches, setPastSearches] = useState([]);
  const [pickingMode, setPickingMode] = useState(false);
  const [mapFullscreen, setMapFullscreen] = useState(false);
  const logsEndRef = useRef(null);
  const mapPanelRef = useRef(null);
  const dropdownRef = useRef(null);
  const filterDropdownRef = useRef(null);
  const kwContainerRef = useRef(null);
  const [showKwSuggestions, setShowKwSuggestions] = useState(false);

  const gridPoints = useMemo(() => {
    if (!previewCenter) return [];
    return generateGridPoints(previewCenter.lat, previewCenter.lng, parseInt(radius) || 0, parseInt(gridStep) || 500);
  }, [previewCenter, radius, gridStep]);

  const handlePreview = async () => {
    if (!city) return;
    const coordMatch = city.trim().match(/^(-?\d{1,3}(?:\.\d+)?)[,\s]+(-?\d{1,3}(?:\.\d+)?)$/);
    if (coordMatch) {
      setPreviewCenter({ lat: parseFloat(coordMatch[1]), lng: parseFloat(coordMatch[2]) });
      return;
    }
    setPreviewLoading(true);
    try {
      const res = await fetch(`http://localhost:8000/api/geocode?q=${encodeURIComponent(city)}`);
      if (!res.ok) throw new Error('Località non trovata');
      const data = await res.json();
      setPreviewCenter({ lat: data.lat, lng: data.lng });
    } catch (e) {
      alert('Impossibile geocodificare la località');
    } finally {
      setPreviewLoading(false);
    }
  };

  const handlePickLocation = (lat, lng) => {
    setCity(`${lat.toFixed(6)}, ${lng.toFixed(6)}`);
    setPreviewCenter({ lat, lng });
    setPickingMode(false);
  };

  const handleTogglePicking = () => {
    if (pickingMode) { setPickingMode(false); return; }
    // Open map at default Italy center if no location is set yet
    if (!previewCenter && pastSearches.length === 0) {
      setPreviewCenter({ lat: 41.9, lng: 12.5 });
    }
    setPickingMode(true);
  };

  const fetchLists = async () => {
    try {
      const resp = await fetch('http://localhost:8000/api/lists');
      const data = await resp.json();
      setLists(data);
      if (data.length > 0 && !selectedList) {
        setSelectedList(data[0]);
      }
    } catch (e) {
      console.error("Failed to fetch lists", e);
    }
  };

  const fetchListData = async (filename) => {
    if (!filename) return;
    try {
      const resp = await fetch(`http://localhost:8000/api/lists/${filename}`);
      if (resp.ok) {
        const data = await resp.json();
        setResults(data.data || []);
      }
    } catch (e) {
      console.error("Failed to fetch list data", e);
    }
  };

  const fetchSearchHistory = async (filename) => {
    if (!filename) { setPastSearches([]); return; }
    try {
      const resp = await fetch(`http://localhost:8000/api/lists/${filename}/searches`);
      if (resp.ok) {
        const data = await resp.json();
        setPastSearches(data);
      } else {
        setPastSearches([]);
      }
    } catch (e) {
      setPastSearches([]);
    }
  };

  useEffect(() => {
    fetchLists();
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    fetchListData(selectedList);
    fetchSearchHistory(selectedList);
  }, [selectedList]);

  useEffect(() => {
    // Auto-scroll logs
    logsEndRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [logs]);

  useEffect(() => {
    if (!pickingMode) return;
    const cancelOnEsc = (e) => { if (e.key === 'Escape') setPickingMode(false); };
    const cancelOnOutsideClick = (e) => {
      if (mapPanelRef.current && !mapPanelRef.current.contains(e.target)) {
        setPickingMode(false);
      }
    };
    document.addEventListener('keydown', cancelOnEsc);
    document.addEventListener('mousedown', cancelOnOutsideClick);
    return () => {
      document.removeEventListener('keydown', cancelOnEsc);
      document.removeEventListener('mousedown', cancelOnOutsideClick);
    };
  }, [pickingMode]);

  useEffect(() => {
    // Close dropdown on outside click
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setShowDropdown(false);
      }
      if (filterDropdownRef.current && !filterDropdownRef.current.contains(event.target)) {
        setShowFilterDropdown(false);
      }
      if (kwContainerRef.current && !kwContainerRef.current.contains(event.target)) {
        setShowKwSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const handleCreateList = async (e) => {
    e.preventDefault();
    if (!newListName) return;

    try {
      const resp = await fetch('http://localhost:8000/api/lists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newListName })
      });

      const data = await resp.json();
      if (resp.ok) {
        setNewListName('');
        await fetchLists();
        setSelectedList(data.filename);
      } else {
        alert(data.detail || "Errore nella creazione della lista");
      }
    } catch (e) {
      alert("Errore di rete");
    }
  };

  const handleDeleteList = async () => {
    if (!selectedList) return;

    const confirm1 = window.confirm(`Sei sicuro di voler eliminare la lista '${selectedList}'?`);
    if (!confirm1) return;

    const confirm2 = window.confirm(`ATTENZIONE: L'eliminazione è irreversibile e cancellerà definitivamente il file e tutti i lead estratti. Procedere?`);
    if (!confirm2) return;

    try {
      const resp = await fetch(`http://localhost:8000/api/lists/${selectedList}`, {
        method: 'DELETE',
      });

      const data = await resp.json();
      if (resp.ok) {
        setResults([]);
        setSelectedList('');
        await fetchLists();
        alert(data.message);
      } else {
        alert(data.detail || "Errore durante l'eliminazione");
      }
    } catch (e) {
      alert("Errore di rete durante l'eliminazione");
    }
  };

  const toggleRowAction = async (placeId, action, currentValue) => {
    if (!selectedList || !placeId) return;

    const newValue = !currentValue;

    // Optimistically update the UI to feel snappy
    setResults(prevResults =>
      prevResults.map(r => {
        if (r.Place_ID !== placeId) return r;
        const colName = action === 'hide' ? 'Hide' : action === 'call' ? 'Call' : 'Interested';
        return { ...r, [colName]: newValue };
      })
    );

    try {
      const resp = await fetch(`http://localhost:8000/api/lists/${selectedList}/row`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          place_id: placeId,
          action: action,
          value: newValue
        })
      });

      if (!resp.ok) {
        const errorData = await resp.json();
        console.error("Failed to update row", errorData);
        // Revert on error
        setResults(prevResults =>
          prevResults.map(r => {
            if (r.Place_ID !== placeId) return r;
            const colName = action === 'hide' ? 'Hide' : action === 'call' ? 'Call' : 'Interested';
            return { ...r, [colName]: currentValue };
          })
        );
      }
    } catch (e) {
      console.error("Network error updating row", e);
      // Revert on error
      setResults(prevResults =>
        prevResults.map(r => {
          if (r.Place_ID !== placeId) return r;
          const colName = action === 'hide' ? 'Hide' : action === 'call' ? 'Call' : 'Interested';
          return { ...r, [colName]: currentValue };
        })
      );
    }
  };

  const handleSort = (field) => {
    setSortConfig(prev =>
      prev.field === field
        ? { field, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
        : { field, direction: field === 'Data Estrazione' ? 'desc' : 'asc' }
    );
  };

  const saveNote = async (placeId, note) => {
    if (!selectedList || !placeId) return;
    try {
      await fetch(`http://localhost:8000/api/lists/${selectedList}/note`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ place_id: placeId, note })
      });
    } catch (e) {
      console.error("Network error saving note", e);
    }
  };

  const handleScrape = async (e) => {
    e.preventDefault();
    if (!city || !radius || !keywords || !selectedList) {
      alert("Tutti i campi (incluso il Database List) sono obbligatori!");
      return;
    }

    setIsScraping(true);
    setProgress({ value: 0, label: 'Inizializzazione request...', subtype: '' });
    setLogs([`Inizio richiesta al server per ${city}...`]);
    // Do not clear setResults([]) here so the user keeps seeing the current list while extracting

    try {
      const response = await fetch('http://localhost:8000/api/scrape', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          city: city,
          radius: parseInt(radius),
          grid_step: parseInt(gridStep) || 500,
          keywords: keywords.split(',').map((k) => k.trim()).filter(k => k),
          list_name: selectedList
        }),
      });

      if (!response.ok) {
        throw new Error('Errore di comunicazione col backend.');
      }

      // Read Server-Sent Events (SSE) from response stream
      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // SSE standard uses \r\n\r\n or \n\n to separate event blocks
        const events = buffer.split(/\r?\n\r?\n/);

        // L'ultimo elemento è un evento incompleto o una stringa vuota, lo teniamo nel buffer
        buffer = events.pop() || '';

        for (const eventBlock of events) {
          if (!eventBlock.trim()) continue;

          const lines = eventBlock.split(/\r?\n/);
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const dataStr = line.substring(6);
              if (dataStr) {
                try {
                  const parsed = JSON.parse(dataStr);

                  if (parsed.type === "log" || parsed.type === "error") {
                    setLogs((prev) => [...prev, `${new Date().toLocaleTimeString()} - ${parsed.message}`]);
                  } else if (parsed.type === "progress") {
                    setProgress({ value: parsed.value, label: parsed.label, subtype: parsed.subtype });
                  } else if (parsed.type === "done") {
                    setResults(parsed.data);
                    setIsScraping(false);
                    setProgress({ value: 100, label: 'Completato!', subtype: 'done' });
                    setPreviewCenter(null);
                    fetchSearchHistory(selectedList);
                  }
                } catch (err) {
                  console.error("Parse Error:", err, dataStr);
                }
              }
            }
          }
        }
      }

    } catch (error) {
      setLogs((prev) => [...prev, `[ERRORE DI RETE]: ${error.message}`]);
      setIsScraping(false);
    }
  };

  const downloadExcel = async () => {
    if (!selectedList) return;

    setLogs((prev) => [...prev, 'Richiesta download Excel in corso...']);

    try {
      const resp = await fetch(`http://localhost:8000/api/lists/${encodeURIComponent(selectedList)}/download`);

      if (!resp.ok) {
        throw new Error('Errore durante il download dal server.');
      }

      const blob = await resp.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = selectedList; // Scarica col nome originale della lista (*.xlsx)
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      setLogs((prev) => [...prev, 'Download completato con successo.']);
    } catch (e) {
      setLogs((prev) => [...prev, `[ERRORE DOWNLOAD]: ${e.message}`]);
    }
  };

  const parseDate = (dString) => {
    if (!dString) return 0;
    try {
      const parts = dString.split(' ');
      if (parts.length < 2) return 0;
      const dateParts = parts[0].split('/');
      if (dateParts.length < 3) return 0;
      return new Date(`${dateParts[2]}-${dateParts[1]}-${dateParts[0]}T${parts[1]}`).getTime();
    } catch (e) {
      return 0;
    }
  };

  // Extract unique keywords for the filter dropdown
  const uniqueKeywords = [...new Set(results.map(r => r['Keyword Ricerca']).filter(k => k))].sort();

  const displayedResults = [...results]
    .filter(r => (showHidden ? r.Hide : !r.Hide))
    .filter(r => !nameSearch || (r.Nome || '').toLowerCase().includes(nameSearch.toLowerCase()))
    .filter(r => {
      if (contactedFilter === 'contacted') return r.Call;
      if (contactedFilter === 'not_contacted') return !r.Call;
      return true;
    })
    .filter(r => {
      if (interestedFilter === 'interested') return r.Interested;
      if (interestedFilter === 'not_interested') return !r.Interested;
      return true;
    })
    .filter(r => {
      if (noteFilter === 'with_note') return r.Note && r.Note.trim() !== '';
      if (noteFilter === 'without_note') return !r.Note || r.Note.trim() === '';
      return true;
    })
    .filter(r => {
      if (ricercaFilter.size > 0) return ricercaFilter.has(r['Keyword Ricerca']);
      return true;
    })
    .sort((a, b) => {
      const { field, direction } = sortConfig;
      let aVal, bVal;
      if (field === 'Data Estrazione') {
        aVal = parseDate(a['Data Estrazione']);
        bVal = parseDate(b['Data Estrazione']);
      } else {
        aVal = (a[field] || '').toString().toLowerCase();
        bVal = (b[field] || '').toString().toLowerCase();
      }
      if (aVal < bVal) return direction === 'asc' ? -1 : 1;
      if (aVal > bVal) return direction === 'asc' ? 1 : -1;
      return 0;
    });

  return (
    <div className="h-screen overflow-hidden grid grid-cols-1 md:grid-cols-12 gap-6 p-6 dark:bg-[#0B0F19] bg-slate-100 transition-colors">

      {/* Sidebar - Configuration Input Form */}
      <div className="col-span-1 md:col-span-4 lg:col-span-3 h-full overflow-hidden flex flex-col">
        <div className="dark:bg-slate-900 bg-slate-50 border dark:border-slate-800 border-slate-200 rounded-xl p-6 shadow-sm flex-1 flex flex-col overflow-y-auto custom-scrollbar">
          <div className="flex justify-between items-center mb-6 shrink-0">
            <div className="flex items-center gap-3">
              <img src="/icon.webp" alt="Share Me Icon" className="w-8 h-8 object-contain" />
              <h1 className="text-2xl font-bold dark:text-white text-slate-900 tracking-tight">
                GeoLead
              </h1>
            </div>
            <button
              type="button"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              className="p-2 rounded-lg border dark:border-slate-700 border-slate-300 dark:text-slate-400 text-slate-600 hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors bg-white dark:bg-slate-800 shadow-sm"
              title="Cambia tema (Chiaro/Scuro)"
            >
              {theme === 'dark' ? (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"></path></svg>
              ) : (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"></path></svg>
              )}
            </button>
          </div>

          <div className="mb-6 p-4 dark:bg-slate-950/50 bg-slate-100/50 rounded-lg border dark:border-slate-800 border-slate-200">
            <h3 className="text-sm font-semibold dark:text-slate-300 text-slate-700 mb-3 flex items-center gap-2">
              <svg className="w-4 h-4 dark:text-slate-400 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
              </svg>
              Lista contatti
            </h3>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium dark:text-slate-400 text-slate-600 mb-1">Seleziona Lista Esistente</label>
                <select
                  value={selectedList}
                  onChange={(e) => setSelectedList(e.target.value)}
                  className="w-full dark:bg-slate-900 bg-slate-50 border dark:border-slate-700 border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-slate-500 focus:border-slate-500 transition-colors dark:text-slate-200 text-slate-800"
                >
                  <option value="" disabled>-- Seleziona o crea --</option>
                  {lists.map(list => (
                    <option key={list} value={list}>{list.replace(/\.xlsx$/, '')}</option>
                  ))}
                </select>
              </div>

              <div className="pt-2 border-t dark:border-slate-800/50 border-slate-300/50">
                <label className="block text-xs font-medium dark:text-slate-400 text-slate-600 mb-1">Oppure Crea Nuova Lista</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newListName}
                    onChange={(e) => setNewListName(e.target.value)}
                    placeholder="Es: Ristoranti Roma"
                    className="flex-1 dark:bg-slate-900 bg-slate-50 border dark:border-slate-700 border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-slate-500 focus:border-slate-500 dark:text-slate-200 text-slate-800"
                  />
                  <button
                    type="button"
                    onClick={handleCreateList}
                    disabled={!newListName}
                    className="px-3 py-1.5 dark:bg-slate-800 bg-slate-100 dark:hover:bg-slate-700 hover:bg-slate-200 disabled:opacity-50 dark:text-slate-200 text-slate-800 text-sm rounded-lg border dark:border-slate-700 border-slate-300 transition-colors"
                  >
                    Crea
                  </button>
                </div>
              </div>
            </div>
          </div>

          <form onSubmit={handleScrape} className="space-y-4 flex-1 flex flex-col">
            <div className="space-y-4 flex-1 overflow-y-auto pr-2 custom-scrollbar">
              <div>
                <label className="block text-sm font-medium dark:text-slate-400 text-slate-600 mb-1">Città, Zona o Coordinate</label>
                <div className="flex gap-1">
                  <input
                    type="text"
                    className="flex-1 dark:bg-slate-950 bg-white border dark:border-slate-700 border-slate-300 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-slate-500 focus:border-slate-500 transition-colors"
                    placeholder="Es: Navigli Milano, 45.4654,9.1866"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={handleTogglePicking}
                    title={pickingMode ? 'Annulla selezione (Esc)' : 'Seleziona centro sulla mappa'}
                    className={`px-2.5 py-2.5 flex items-center justify-center rounded-lg border transition-all ${pickingMode
                      ? 'bg-blue-500 border-blue-500 text-white shadow-lg scale-105'
                      : 'dark:bg-slate-950 bg-white dark:border-slate-700 border-slate-300 dark:text-slate-300 text-slate-600 hover:border-blue-400 hover:text-blue-400'
                      }`}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium dark:text-slate-400 text-slate-600 mb-1">Raggio (Metri)</label>
                <input
                  type="number"
                  className="w-full dark:bg-slate-950 bg-white border dark:border-slate-700 border-slate-300 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-slate-500 focus:border-slate-500 transition-colors"
                  placeholder="Es: 5000"
                  value={radius}
                  onChange={(e) => setRadius(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-sm font-medium dark:text-slate-400 text-slate-600 mb-1">Passo Griglia (Metri)</label>
                <input
                  type="number"
                  className="w-full dark:bg-slate-950 bg-white border dark:border-slate-700 border-slate-300 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-slate-500 focus:border-slate-500 transition-colors"
                  placeholder="Es: 500"
                  value={gridStep}
                  onChange={(e) => setGridStep(e.target.value)}
                />
                <p className="text-xs text-slate-500 mt-1">Più basso = più preciso, più chiamate API</p>
              </div>

              <div ref={kwContainerRef} className="relative">
                <label className="block text-sm font-medium dark:text-slate-400 text-slate-600 mb-1">Keywords</label>
                <input
                  type="text"
                  className="w-full dark:bg-slate-950 bg-white border dark:border-slate-700 border-slate-300 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-slate-500 focus:border-slate-500 transition-colors"
                  placeholder="Ristorante, pizzeria, bar..."
                  value={keywords}
                  onChange={(e) => { setKeywords(e.target.value); setShowKwSuggestions(true); }}
                  onFocus={() => setShowKwSuggestions(true)}
                />
                <p className="text-xs text-slate-500 mt-1">Separate da virgola</p>
                {(() => {
                  // Build pool of known keywords from past searches + current results
                  const pool = new Set();
                  uniqueKeywords.forEach(k => pool.add(k));
                  pastSearches.forEach(s => {
                    if (s.Keywords) s.Keywords.split(',').map(k => k.trim()).filter(k => k).forEach(k => pool.add(k));
                  });
                  if (pool.size === 0 || !showKwSuggestions) return null;

                  // Last token being typed (after last comma)
                  const parts = keywords.split(',');
                  const lastToken = parts[parts.length - 1].trim().toLowerCase();
                  // Already added keywords (all except last token)
                  const alreadyAdded = new Set(parts.slice(0, -1).map(k => k.trim().toLowerCase()).filter(k => k));

                  const suggestions = [...pool].sort().filter(kw => {
                    const lc = kw.toLowerCase();
                    return !alreadyAdded.has(lc) && (lastToken === '' || lc.includes(lastToken));
                  });

                  if (suggestions.length === 0) return null;

                  const rect = kwContainerRef.current?.getBoundingClientRect();
                  return (
                    <div
                      style={rect ? { position: 'fixed', top: rect.bottom + 4, left: rect.left, width: rect.width, zIndex: 9999 } : {}}
                      className="dark:bg-slate-800 bg-white border dark:border-slate-700 border-slate-200 rounded-lg shadow-xl overflow-hidden"
                    >
                      <div className="p-2 flex flex-wrap gap-1.5 max-h-36 overflow-y-auto">
                        {suggestions.map((kw, idx) => {
                          const kColor = keywordColor(kw);
                          return (
                            <button
                              key={idx}
                              type="button"
                              onMouseDown={(e) => {
                                e.preventDefault();
                                // Replace last token with the chosen keyword
                                const p = keywords.split(',');
                                p[p.length - 1] = p.length > 1 ? ' ' + kw : kw;
                                setKeywords(p.join(','));
                                setShowKwSuggestions(false);
                              }}
                              style={{ background: `${kColor}22`, border: `1px solid ${kColor}60`, color: kColor }}
                              className="px-2.5 py-1 rounded text-xs font-medium transition-opacity hover:opacity-80"
                            >
                              {kw}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>

            <div className="pt-4 shrink-0 mt-auto flex gap-2">
              <button
                type="submit"
                disabled={isScraping}
                className={`flex-1 py-3 px-4 rounded-lg text-sm font-medium transition-all ${isScraping ? 'dark:bg-slate-800 bg-slate-100 text-slate-500 cursor-not-allowed border dark:border-slate-700/50 border-slate-300/50' : 'dark:bg-slate-700 bg-slate-200 dark:text-white text-slate-800 dark:hover:bg-slate-600 hover:bg-slate-300 border dark:border-slate-600 border-slate-300 shadow-sm'
                  }`}
              >
                {isScraping ? (
                  <span className="flex items-center justify-center">
                    <svg className="animate-spin -ml-1 mr-3 h-5 w-5 dark:text-slate-400 text-slate-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Estrazione In Corso...
                  </span>
                ) : 'Avvia Estrazione'}
              </button>
              <button
                type="button"
                onClick={handlePreview}
                disabled={!city || previewLoading}
                title="Anteprima Area"
                className="flex items-center justify-center w-12 rounded-lg border dark:bg-slate-900 bg-slate-50 dark:border-slate-700 border-slate-300 dark:text-slate-300 text-slate-600 dark:hover:bg-slate-800 hover:bg-slate-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
              >
                {previewLoading ? (
                  <svg className="animate-spin w-5 h-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                ) : (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                  </svg>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="col-span-1 md:col-span-8 lg:col-span-9 flex flex-col gap-6 h-full overflow-hidden">

        {/* Top row: Terminal + Map side by side */}
        <div className={`flex gap-6 ${mapFullscreen ? 'flex-1' : 'md:h-[320px]'}`}>

          {/* Terminal Log View */}
          <div className={`flex-1 dark:bg-slate-900 bg-slate-50 border dark:border-slate-800 border-slate-200 rounded-xl p-4 shadow-sm overflow-hidden flex-col ${mapFullscreen ? 'hidden' : 'flex'}`}>
            <div className="flex items-center justify-between mb-3 border-b dark:border-slate-800 border-slate-200 pb-2">
              <div className="flex gap-2 items-center">
                <span className="text-xs font-mono dark:text-slate-400 text-slate-600 ml-3">Algoritmo di Estrazione</span>
              </div>
              {isScraping && <span className="flex h-3 w-3"><span className="animate-ping absolute inline-flex h-3 w-3 rounded-full bg-green-400 opacity-75"></span><span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span></span>}
            </div>
            <div className="flex-1 overflow-y-auto font-mono text-xs dark:text-white text-slate-900 leading-relaxed pr-2 custom-scrollbar">
              {logs.length === 0 ? (
                <span className="text-slate-600">Inserisci i dati e avvia per vedere l'algoritmo qui.</span>
              ) : (
                logs.map((log, i) => (
                  <div key={i} className="mb-1 dark:hover:bg-slate-800/50 hover:bg-slate-200/50 px-1 py-0.5 rounded break-words">
                    {log}
                  </div>
                ))
              )}
              <div ref={logsEndRef} />
            </div>
          </div>

          {/* Map preview panel — separate bento box */}
          <div ref={mapPanelRef} className={`hidden md:flex flex-col dark:bg-slate-900 bg-slate-50 border dark:border-slate-800 border-slate-200 rounded-xl shadow-sm overflow-hidden ${mapFullscreen ? 'flex-1' : 'w-[38%]'}`}>
            <div className="flex items-center justify-between px-4 py-2.5 border-b dark:border-slate-800 border-slate-200 shrink-0">
              <span className="text-xs font-mono dark:text-slate-400 text-slate-600">Mappa</span>
              <div className="flex items-center gap-2">
                {previewCenter && (
                  <span className="text-xs dark:text-slate-500 text-slate-400">
                    {previewCenter.lat.toFixed(4)}, {previewCenter.lng.toFixed(4)}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setMapFullscreen(f => !f)}
                  title={mapFullscreen ? 'Riduci mappa' : 'Espandi mappa'}
                  className="p-1 rounded dark:text-slate-500 text-slate-400 dark:hover:text-slate-200 hover:text-slate-700 transition-colors"
                >
                  {mapFullscreen ? (
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 9L4 4m0 0h5m-5 0v5M15 9l5-5m0 0h-5m5 0v5M9 15l-5 5m0 0h5m-5 0v-5M15 15l5 5m0 0h-5m5 0v-5" />
                    </svg>
                  ) : (
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5M20 8V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5M20 16v4m0 0h-4m4 0l-5-5" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
            <div className="relative flex-1">
              {(previewCenter || pastSearches.length > 0) ? (() => {
                const lastSearch = pastSearches[pastSearches.length - 1];
                const mapCenter = previewCenter
                  ? [previewCenter.lat, previewCenter.lng]
                  : [lastSearch.Lat, lastSearch.Lng];
                const mapKey = previewCenter
                  ? `${previewCenter.lat},${previewCenter.lng}`
                  : `past-${lastSearch.Lat},${lastSearch.Lng}`;
                return (
                  <>
                    <MapContainer
                      key={mapKey}
                      center={mapCenter}
                      zoom={13}
                      style={{ height: '100%', width: '100%' }}
                      zoomControl={false}
                    >
                      <MapClickHandler pickingMode={pickingMode} onPick={handlePickLocation} />
                      <MapInvalidator trigger={mapFullscreen} />
                      <TileLayer
                        key={theme}
                        url={theme === 'dark'
                          ? 'https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png'
                          : 'https://tiles.stadiamaps.com/tiles/alidade_smooth/{z}/{x}/{y}{r}.png'}
                        attribution='© Stadia Maps © OpenStreetMap'
                      />
                      {/* Cerchi ricerche precedenti */}
                      {pastSearches.map((s, i) => {
                        const color = keywordColor(s.Keywords);
                        return (
                          <Circle
                            key={`past-${i}`}
                            center={[s.Lat, s.Lng]}
                            radius={s.Raggio}
                            pathOptions={{ color, fillColor: color, fillOpacity: 0.08, dashArray: '6 4', weight: 2 }}
                          >
                            <Tooltip sticky>
                              <div style={{ fontSize: 12, lineHeight: 1.5 }}>
                                <strong>{s.Keywords}</strong><br />
                                {s.Data} · r={s.Raggio}m
                              </div>
                            </Tooltip>
                          </Circle>
                        );
                      })}
                      {/* Cerchio + griglia anteprima corrente */}
                      {previewCenter && (
                        <>
                          <Circle
                            center={[previewCenter.lat, previewCenter.lng]}
                            radius={parseInt(radius) || 0}
                            pathOptions={{ color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 0.08 }}
                          />
                          {gridPoints.map(([lat, lng], i) => (
                            <CircleMarker
                              key={i}
                              center={[lat, lng]}
                              radius={3}
                              pathOptions={{ color: '#f97316', fillColor: '#f97316', fillOpacity: 0.6, weight: 1 }}
                            />
                          ))}
                          <Marker position={[previewCenter.lat, previewCenter.lng]} />
                        </>
                      )}
                    </MapContainer>
                    {/* Legenda keyword */}
                    {pastSearches.length > 0 && (() => {
                      const seen = new Set();
                      const uniqueEntries = pastSearches.filter(s => {
                        if (seen.has(s.Keywords)) return false;
                        seen.add(s.Keywords);
                        return true;
                      });
                      return (
                        <div className="absolute top-2 left-2 bg-black/70 text-white text-xs rounded z-[1000] pointer-events-none max-h-[60%] overflow-y-auto">
                          {uniqueEntries.map((s, i) => (
                            <div key={i} className="flex items-center gap-1.5 px-2 py-1">
                              <span style={{ width: 10, height: 10, borderRadius: 2, background: keywordColor(s.Keywords), flexShrink: 0, display: 'inline-block', border: `1.5px solid ${keywordColor(s.Keywords)}` }} />
                              <span className="truncate max-w-[120px]">{s.Keywords}</span>
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                    {/* Picking mode hint */}
                    {pickingMode && (
                      <div className="absolute top-2 left-1/2 -translate-x-1/2 bg-blue-600/90 text-white text-xs px-3 py-1.5 rounded-full z-[1000] pointer-events-none whitespace-nowrap shadow-lg">
                        Clicca sulla mappa per posizionare il centro · Esc per annullare
                      </div>
                    )}
                  </>
                );
              })() : (
                <div className="h-full flex flex-col items-center justify-center dark:text-slate-500 text-slate-400 text-sm gap-1">
                  <span className="text-3xl">🗺</span>
                  <span>Clicca "Anteprima Area"</span>
                  <span>per visualizzare la zona</span>
                </div>
              )}
            </div>
            {/* Map footer */}
            <div className="shrink-0 border-t dark:border-slate-800 border-slate-200 px-3 py-1.5 flex justify-between items-center">
              <span className="text-xs dark:text-slate-500 text-slate-400">
                {pastSearches.length} zona{pastSearches.length !== 1 ? 'e' : ''} cercata{pastSearches.length !== 1 ? 'e' : ''}
              </span>
              {previewCenter && (
                <span className="text-xs dark:text-slate-500 text-slate-400">
                  {gridPoints.length} punti · ~{gridPoints.length * 3} chiamate API
                </span>
              )}
            </div>
          </div>

        </div>

        {/* Progress Bar Container */}
        {!mapFullscreen && (isScraping || progress.value > 0) && (
          <div className="dark:bg-slate-900 bg-slate-50 border dark:border-slate-800 border-slate-200 rounded-xl p-5 shadow-sm w-full">
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm font-medium dark:text-slate-300 text-slate-700">
                {progress.label || 'Caricamento...'}
              </span>
              <span className="text-sm font-bold dark:text-slate-200 text-slate-800">{progress.value}%</span>
            </div>
            <div className="w-full dark:bg-slate-800 bg-slate-100 rounded-full h-2 max-w-full overflow-hidden">
              <div
                className={`h-2 rounded-full transition-all duration-500 ease-out bg-white`}
                style={{ width: `${Math.max(0, Math.min(100, progress.value))}%` }}
              >
              </div>
            </div>
          </div>
        )}

        {/* Results Preview & Action Area */}
        <div className={`transition-all duration-300 ease-in-out flex-col ${mapFullscreen ? 'hidden' : 'flex'} ${isFullscreen
          ? "fixed inset-0 z-[9999] dark:bg-slate-900 bg-slate-50 p-6 overflow-hidden w-full h-full"
          : "dark:bg-slate-900 bg-slate-50 border dark:border-slate-800 border-slate-200 rounded-xl p-6 shadow-sm flex-1 relative min-h-0"
          }`}>
          <div className="flex justify-between items-center mb-6 shrink-0">
            <div>
              <h2 className="text-xl font-bold dark:text-slate-200 text-slate-800">
                {selectedList ? selectedList.replace(/\.xlsx$/, '') : 'Nessuna Lista'}
                {results.length > 0 && (
                  <span className="text-xs ml-2 dark:bg-slate-800 bg-slate-100 dark:text-slate-300 text-slate-700 py-1 px-2 rounded-full border dark:border-slate-700 border-slate-300">
                    {showHidden ? `${results.filter(r => r.Hide).length} Nascosti` : `${results.filter(r => !r.Hide).length} Visibili`}
                  </span>
                )}
              </h2>
              {isScraping && <p className="text-xs dark:text-slate-400 text-slate-600 mt-1 animate-pulse">Estrazione in corso, i nuovi dati appariranno qui...</p>}
            </div>

            <div className="flex gap-3 items-center">
              {/* Name Search */}
              {results.length > 0 && (
                <div className="relative flex items-center">
                  <svg className="w-4 h-4 text-slate-500 absolute left-2.5 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
                  </svg>
                  <input
                    type="text"
                    value={nameSearch}
                    onChange={(e) => setNameSearch(e.target.value)}
                    placeholder="Cerca per nome..."
                    className="dark:bg-slate-800 bg-slate-100 border dark:border-slate-700 border-slate-300 rounded-lg pl-8 pr-8 py-2 text-sm dark:text-slate-200 text-slate-800 placeholder-slate-500 focus:outline-none focus:border-slate-500 w-44 transition-all focus:w-56"
                  />
                  {nameSearch && (
                    <button
                      onClick={() => setNameSearch('')}
                      className="absolute right-2 text-slate-500 dark:hover:text-slate-300 hover:text-slate-700 transition-colors"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path>
                      </svg>
                    </button>
                  )}
                </div>
              )}

              {/* Filter Dropdown */}
              {(selectedList || results.length > 0) && (
                <div className="relative" ref={filterDropdownRef}>
                  <button
                    onClick={() => setShowFilterDropdown(!showFilterDropdown)}
                    className={`p-2 rounded-lg transition-all border flex items-center justify-center ${contactedFilter !== 'all' || noteFilter !== 'all' || ricercaFilter.size > 0 || interestedFilter !== 'all' ? 'dark:bg-slate-600 bg-slate-300 dark:text-white text-slate-900 border-slate-500' : 'dark:bg-slate-800 bg-slate-100 dark:hover:bg-slate-700 hover:bg-slate-200 dark:text-slate-300 text-slate-700 dark:border-slate-700 border-slate-300'}`}
                    title="Filtri Avanzati"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"></path>
                    </svg>
                  </button>

                  {showFilterDropdown && (
                    <div className="absolute right-0 mt-2 dark:bg-slate-900 bg-slate-50 border dark:border-slate-700/80 border-slate-300/80 rounded-xl shadow-2xl z-20 text-sm w-[480px]">
                      {/* Header */}
                      <div className="flex items-center justify-between px-4 py-3 border-b dark:border-slate-800 border-slate-200">
                        <span className="text-xs font-semibold dark:text-slate-400 text-slate-600 uppercase tracking-wider">Filtri Avanzati</span>
                        {(contactedFilter !== 'all' || interestedFilter !== 'all' || noteFilter !== 'all' || ricercaFilter.size > 0) && (
                          <button
                            onClick={() => { setContactedFilter('all'); setInterestedFilter('all'); setNoteFilter('all'); setRicercaFilter(new Set()); }}
                            className="text-xs text-slate-500 dark:hover:text-slate-300 hover:text-slate-700 transition-colors"
                          >
                            Azzera tutto
                          </button>
                        )}
                      </div>

                      <div className="p-4 space-y-4">
                        {/* Riga 1: Contatto + Interesse + Note affiancati */}
                        <div className="flex gap-5">
                          {/* Stato Contatto */}
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">Contatto</div>
                            <div className="flex flex-col gap-1">
                              {[
                                { value: 'all', label: 'Tutti', color: 'slate' },
                                { value: 'contacted', label: 'Contattati', color: 'emerald' },
                                { value: 'not_contacted', label: 'Non Contattati', color: 'slate' },
                              ].map(opt => (
                                <label key={opt.value} onClick={() => setContactedFilter(opt.value)} className="flex items-center gap-2 p-1 rounded cursor-pointer group">
                                  <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${contactedFilter === opt.value ? (opt.color === 'emerald' ? 'bg-emerald-500 border-emerald-500' : 'bg-slate-500 border-slate-500') : 'dark:border-slate-600 border-slate-300 dark:bg-slate-800 bg-white group-hover:border-slate-400'}`}>
                                    {contactedFilter === opt.value && <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" /></svg>}
                                  </div>
                                  <span className={`text-xs transition-colors ${contactedFilter === opt.value ? (opt.color === 'emerald' ? 'text-emerald-400' : 'dark:text-slate-200 text-slate-800') : 'dark:text-slate-400 text-slate-600 dark:group-hover:text-slate-300 group-hover:text-slate-700'}`}>{opt.label}</span>
                                </label>
                              ))}
                            </div>
                          </div>

                          {/* Interesse */}
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">Interesse</div>
                            <div className="flex flex-col gap-1">
                              {[
                                { value: 'all', label: 'Tutti', color: 'slate' },
                                { value: 'interested', label: 'Interessati', color: 'blue' },
                                { value: 'not_interested', label: 'Non Interessati', color: 'slate' },
                              ].map(opt => (
                                <label key={opt.value} onClick={() => setInterestedFilter(opt.value)} className="flex items-center gap-2 p-1 rounded cursor-pointer group">
                                  <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${interestedFilter === opt.value ? (opt.color === 'blue' ? 'bg-blue-500 border-blue-500' : 'bg-slate-500 border-slate-500') : 'dark:border-slate-600 border-slate-300 dark:bg-slate-800 bg-white group-hover:border-slate-400'}`}>
                                    {interestedFilter === opt.value && <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" /></svg>}
                                  </div>
                                  <span className={`text-xs transition-colors ${interestedFilter === opt.value ? (opt.color === 'blue' ? 'text-blue-400' : 'dark:text-slate-200 text-slate-800') : 'dark:text-slate-400 text-slate-600 dark:group-hover:text-slate-300 group-hover:text-slate-700'}`}>{opt.label}</span>
                                </label>
                              ))}
                            </div>
                          </div>

                          {/* Note */}
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">Note</div>
                            <div className="flex flex-col gap-1">
                              {[
                                { value: 'all', label: 'Tutte' },
                                { value: 'with_note', label: 'Con Note' },
                                { value: 'without_note', label: 'Senza Note' },
                              ].map(opt => (
                                <label key={opt.value} onClick={() => setNoteFilter(opt.value)} className="flex items-center gap-2 p-1 rounded cursor-pointer group">
                                  <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${noteFilter === opt.value ? 'bg-slate-500 border-slate-500' : 'dark:border-slate-600 border-slate-300 dark:bg-slate-800 bg-white group-hover:border-slate-400'}`}>
                                    {noteFilter === opt.value && <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" /></svg>}
                                  </div>
                                  <span className={`text-xs transition-colors ${noteFilter === opt.value ? 'dark:text-slate-200 text-slate-800' : 'dark:text-slate-400 text-slate-600 dark:group-hover:text-slate-300 group-hover:text-slate-700'}`}>{opt.label}</span>
                                </label>
                              ))}
                            </div>
                          </div>
                        </div>

                        {/* Riga 2: Keyword/Ricerca sotto */}
                        {uniqueKeywords.length > 0 && (
                          <div className="border-t dark:border-slate-800 border-slate-200 pt-4">
                            <div className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">Ricerca</div>
                            <div className="flex gap-1.5 flex-wrap">
                              <button onClick={() => setRicercaFilter(new Set())}
                                className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${ricercaFilter.size === 0 ? 'dark:bg-slate-600 bg-slate-300 dark:text-white text-slate-900 border-slate-500' : 'dark:bg-slate-800 bg-slate-100 dark:text-slate-400 text-slate-600 dark:border-slate-700 border-slate-300 dark:hover:bg-slate-700 hover:bg-slate-200 dark:hover:text-slate-200 hover:text-slate-800'}`}>
                                Tutte
                              </button>
                              {uniqueKeywords.map((kw, idx) => {
                                const kColor = keywordColor(kw);
                                const isActive = ricercaFilter.has(kw);
                                return (
                                  <button
                                    key={idx}
                                    onClick={() => setRicercaFilter(prev => {
                                      const next = new Set(prev);
                                      if (next.has(kw)) next.delete(kw);
                                      else next.add(kw);
                                      return next;
                                    })}
                                    style={isActive
                                      ? { background: `${kColor}22`, border: `1px solid ${kColor}60`, color: kColor }
                                      : {}}
                                    className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors max-w-[200px] truncate ${isActive ? '' : 'dark:bg-slate-800 bg-slate-100 dark:text-slate-400 text-slate-600 dark:border-slate-700 border-slate-300 dark:hover:bg-slate-700 hover:bg-slate-200 dark:hover:text-slate-200 hover:text-slate-800'}`}
                                    title={kw}
                                  >
                                    {kw}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Expand/Compress Toggle Button */}
              <button
                type="button"
                onClick={() => setIsFullscreen(!isFullscreen)}
                className="dark:bg-slate-800 bg-slate-100 dark:hover:bg-slate-700 hover:bg-slate-200 dark:text-slate-300 text-slate-700 p-2 rounded-lg transition-all border dark:border-slate-700 border-slate-300 flex items-center justify-center"
                title={isFullscreen ? "Riduci a finestra" : "Espandi a tutto schermo"}
              >
                {isFullscreen ? (
                  <svg className="w-5 h-5 dark:text-slate-400 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 14h6m0 0v6m0-6l-7 7m17-11h-6m0 0V4m0 6l7-7m-7 17v-6m0 0h6m-6 0l7 7M4 10h6m0 0V4m0 6l-7-7"></path></svg>
                ) : (
                  <svg className="w-5 h-5 dark:text-slate-400 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"></path></svg>
                )}
              </button>

              {/* Advanced Actions Dropdown */}
              {(selectedList || results.length > 0) && (
                <div className="relative" ref={dropdownRef}>
                  <button
                    onClick={() => setShowDropdown(!showDropdown)}
                    className="dark:bg-slate-800 bg-slate-100 dark:hover:bg-slate-700 hover:bg-slate-200 dark:text-slate-300 text-slate-700 p-2 rounded-lg transition-all border dark:border-slate-700 border-slate-300 flex items-center justify-center"
                    title="Altre Azioni"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z"></path></svg>
                  </button>

                  {showDropdown && (
                    <div className="absolute right-0 mt-2 w-48 dark:bg-slate-800 bg-slate-100 border dark:border-slate-700 border-slate-300 rounded-lg shadow-xl z-10 overflow-hidden text-sm">
                      {results.length > 0 && (
                        <button
                          onClick={() => { setShowDropdown(false); downloadExcel(); }}
                          className="w-full text-left px-4 py-3 dark:text-slate-200 text-slate-800 dark:hover:bg-slate-700 hover:bg-slate-200 transition-colors flex items-center gap-2 border-b dark:border-slate-700/50 border-slate-300/50"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                          Scarica Lista
                        </button>
                      )}

                      {results.length > 0 && (
                        <button
                          onClick={() => { setShowDropdown(false); setShowHidden(!showHidden); }}
                          className="w-full text-left px-4 py-3 dark:text-slate-200 text-slate-800 dark:hover:bg-slate-700 hover:bg-slate-200 transition-colors flex items-center gap-2 border-b dark:border-slate-700/50 border-slate-300/50"
                        >
                          {showHidden ? (
                            <>
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path></svg>
                              Torna ai Visibili
                            </>
                          ) : (
                            <>
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"></path></svg>
                              Mostra Nascosti
                            </>
                          )}
                        </button>
                      )}

                      {selectedList && (
                        <button
                          onClick={() => { setShowDropdown(false); handleDeleteList(); }}
                          className="w-full text-left px-4 py-3 text-red-400 hover:bg-red-500/10 hover:text-red-300 transition-colors flex items-center gap-2"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                          Elimina Lista
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className={`results-table-shell flex-1 border dark:border-slate-800 border-slate-200 rounded-lg overflow-x-auto overflow-y-auto w-full custom-scrollbar transition-all duration-300`}>
            {results.length === 0 ? (
              <div className="w-full h-full flex items-center justify-center text-slate-500 text-sm italic min-h-[8rem]">
                {isScraping ? "In attesa dei primi risultati..." : "La lista attualmente selezionata è vuota. Avvia un'estrazione per popolarla."}
              </div>
            ) : displayedResults.length === 0 ? (
              <div className="w-full h-full flex items-center justify-center text-slate-500 text-sm italic min-h-[8rem]">
                {showHidden ? "Non ci sono lead nascosti in questa lista." : "Tutti i lead di questa lista sono nascosti."}
              </div>
            ) : (
              <table className="results-table w-full text-sm dark:text-slate-400 text-slate-600 whitespace-nowrap">
                <thead className="text-xs dark:text-slate-300 text-slate-700 uppercase dark:bg-slate-800/50 bg-slate-200/50 sticky top-0 text-center">
                  <tr>
                    <th
                      className="px-6 py-3 font-medium text-left cursor-pointer select-none dark:hover:text-white hover:text-slate-900 transition-colors group"
                      onClick={() => handleSort('Nome')}
                    >
                      <span className="flex items-center gap-1">
                        Nome
                        <span className="text-slate-500 dark:group-hover:text-slate-400 group-hover:text-slate-600 transition-colors">
                          {sortConfig.field === 'Nome' ? (
                            sortConfig.direction === 'asc' ? (
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 15l7-7 7 7"></path></svg>
                            ) : (
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                            )
                          ) : (
                            <svg className="w-4 h-4 opacity-0 group-hover:opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 9l4-4 4 4m0 6l-4 4-4-4"></path></svg>
                          )}
                        </span>
                      </span>
                    </th>
                    <th className="px-6 py-3 font-medium text-center w-[120px]">Azioni</th>
                    <th className="px-6 py-3 font-medium text-left">Indirizzo</th>
                    <th
                      className="px-6 py-3 font-medium text-center cursor-pointer select-none dark:hover:text-white hover:text-slate-900 transition-colors group"
                      onClick={() => handleSort('Data Estrazione')}
                    >
                      <span className="flex items-center justify-center gap-1">
                        Data Estrazione
                        <span className="text-slate-500 dark:group-hover:text-slate-400 group-hover:text-slate-600 transition-colors">
                          {sortConfig.field === 'Data Estrazione' ? (
                            sortConfig.direction === 'asc' ? (
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 15l7-7 7 7"></path></svg>
                            ) : (
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                            )
                          ) : (
                            <svg className="w-4 h-4 opacity-0 group-hover:opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 9l4-4 4 4m0 6l-4 4-4-4"></path></svg>
                          )}
                        </span>
                      </span>
                    </th>
                    <th className="px-6 py-3 font-medium text-center">Ricerca</th>
                    <th className="px-6 py-3 font-medium text-left">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedResults.map((r, i) => (
                    <tr key={i} className={`border-b dark:border-slate-800 border-slate-200 dark:hover:bg-slate-800 hover:bg-slate-100/80 transition-colors ${r.Call ? 'dark:bg-slate-900 bg-slate-50/40 text-slate-500' : 'dark:bg-slate-900 bg-slate-50 dark:text-slate-400 text-slate-600'}`}>
                      <td className="px-6 py-4 font-medium max-w-[200px] truncate text-left">
                        <div className="flex items-center gap-2">
                          <span className={`${r.Call ? 'text-slate-500 line-through' : 'dark:text-slate-200 text-slate-800'} truncate block`} title={r.Nome}>{r.Nome}</span>
                          {r.Call && (
                            <span className="bg-emerald-500/20 text-emerald-400 text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap border border-emerald-500/30 shrink-0">
                              Contattato
                            </span>
                          )}
                          {r.Interested && (
                            <span className="bg-blue-500/20 text-blue-400 text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap border border-blue-500/30 shrink-0">
                              Interessato
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <div className="flex items-center justify-center gap-2">
                          {/* Call Toolbar Action */}
                          <button
                            onClick={() => toggleRowAction(r.Place_ID, 'call', r.Call)}
                            className={`p-1.5 rounded transition-all ${r.Call
                              ? 'text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20'
                              : 'dark:text-slate-400 text-slate-600 dark:hover:text-white hover:text-slate-900 dark:hover:bg-slate-700 hover:bg-slate-200'
                              }`}
                            title={r.Call ? "Rimuovi da contattati" : "Segna come contattato"}
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path>
                            </svg>
                          </button>
                          {/* Interested Toolbar Action */}
                          <button
                            onClick={() => toggleRowAction(r.Place_ID, 'interested', r.Interested)}
                            className={`p-1.5 rounded transition-all ${r.Interested
                              ? 'text-blue-400 bg-blue-500/10 hover:bg-blue-500/20'
                              : 'dark:text-slate-400 text-slate-600 dark:hover:text-white hover:text-slate-900 dark:hover:bg-slate-700 hover:bg-slate-200'
                              }`}
                            title={r.Interested ? "Rimuovi da interessati" : "Segna come interessato"}
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"></path>
                            </svg>
                          </button>
                          {/* Hide Toolbar Action */}
                          <button
                            onClick={() => toggleRowAction(r.Place_ID, 'hide', r.Hide)}
                            className={`p-1.5 rounded transition-all ${showHidden
                              ? 'text-blue-400 dark:hover:text-white hover:text-slate-900 hover:bg-blue-500/10'
                              : 'dark:text-slate-400 text-slate-600 hover:text-red-400 hover:bg-red-500/10'
                              }`}
                            title={showHidden ? "Ripristina nei visibili" : "Nascondi Lead"}
                          >
                            {showHidden ? (
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path>
                              </svg>
                            ) : (
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"></path>
                              </svg>
                            )}
                          </button>
                          {/* Google Maps Action */}
                          <a
                            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(r.Nome + ' ' + r.Indirizzo)}${r.Place_ID ? `&query_place_id=${r.Place_ID}` : ''}`}
                            target="_blank"
                            rel="noreferrer"
                            className="p-1.5 rounded transition-all dark:text-slate-400 text-slate-600 dark:hover:text-white hover:text-slate-900 dark:hover:bg-slate-700 hover:bg-slate-200 inline-flex items-center justify-center"
                            title="Apri su Google Maps"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"></path>
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"></path>
                            </svg>
                          </a>
                        </div>
                      </td>
                      <td className="px-6 py-4 max-w-[200px] truncate text-left" title={r.Indirizzo}>{r.Indirizzo}</td>
                      <td className="px-6 py-4 text-xs font-mono dark:text-slate-400 text-slate-600 text-center">
                        {r['Data Estrazione'] || '-'}
                      </td>
                      <td className="px-6 py-4 text-xs text-center">
                        {r['Keyword Ricerca'] ? (() => {
                          const kColor = keywordColor(r['Keyword Ricerca']);
                          return (
                            <span
                              style={r.Call
                                ? { background: `${kColor}18`, border: `1px solid ${kColor}40`, color: `${kColor}80` }
                                : { background: `${kColor}22`, border: `1px solid ${kColor}60`, color: kColor }
                              }
                              className="py-1 px-2 rounded font-medium"
                            >
                              {r['Keyword Ricerca']}
                            </span>
                          );
                        })() : <span className="text-slate-500">-</span>}
                      </td>
                      <td className="px-3 py-2">
                        <textarea
                          value={r.Note || ''}
                          onChange={(e) => {
                            const val = e.target.value;
                            setResults(prev => prev.map(row => row.Place_ID === r.Place_ID ? { ...row, Note: val } : row));
                          }}
                          onBlur={(e) => saveNote(r.Place_ID, e.target.value)}
                          rows={2}
                          className="w-full min-w-[160px] dark:bg-slate-800 bg-slate-100 border dark:border-slate-700 border-slate-300 rounded px-2 py-1 text-xs dark:text-slate-300 text-slate-700 resize-none focus:outline-none focus:border-slate-500 placeholder-slate-600"
                          placeholder="Aggiungi nota..."
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
