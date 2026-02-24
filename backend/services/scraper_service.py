import math
import time
import googlemaps
import pandas as pd
import os
from datetime import datetime
from typing import List, Dict, Any, Generator

LISTS_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "lists")

class GoogleMapsScraperService:
    def __init__(self, api_key: str):
        self.gmaps = googlemaps.Client(key=api_key)

    def generate_grid_points(self, center_lat: float, center_lng: float, radius_m: int, grid_step_m: int) -> List[tuple]:
        """
        Generates a grid of (lat, lng) points covering the given radius.
        """
        points = []
        lat_step_deg = grid_step_m / 111320.0
        num_steps = math.ceil(radius_m / grid_step_m)
        
        for i in range(-num_steps, num_steps + 1):
            for j in range(-num_steps, num_steps + 1):
                x_offset_m = i * grid_step_m
                y_offset_m = j * grid_step_m
                
                if math.sqrt(x_offset_m**2 + y_offset_m**2) <= radius_m:
                    point_lat = center_lat + (i * lat_step_deg)
                    lng_step_deg = grid_step_m / (111320.0 * math.cos(math.radians(point_lat)))
                    point_lng = center_lng + (j * lng_step_deg)
                    points.append((point_lat, point_lng))
                    
        return points

    def run_scraping(self, city: str, radius: int, keywords: List[str], list_name: str, grid_step_m: int = 500) -> Generator[Dict[str, Any], None, None]:
        """
        Runs the scraping process, deduplicates against the selected Excel list, and saves results.
        """
        try:
            filename = list_name if list_name.endswith('.xlsx') else f"{list_name}.xlsx"
            filepath = os.path.join(LISTS_DIR, filename)
            
            if not os.path.exists(filepath):
                yield {"type": "error", "message": f"ERRORE: La lista '{filename}' non esiste."}
                return
                
            yield {"type": "log", "message": f"Caricamento lista '{filename}' in corso..."}
            
            try:
                existing_df = pd.read_excel(filepath)
                # Ensure Place_ID column exists
                if 'Place_ID' not in existing_df.columns:
                    existing_df['Place_ID'] = ''
                
                # Get set of all existing Place IDs for O(1) lookup
                already_in_db_place_ids = set(existing_df['Place_ID'].dropna().astype(str))
                yield {"type": "log", "message": f"Lista caricata: trovati {len(already_in_db_place_ids)} contatti esistenti."}
            except Exception as e:
                yield {"type": "error", "message": f"Errore lettura lista: {str(e)}"}
                return

            yield {"type": "log", "message": f"Inizializzazione ricerca per la città: {city}"}
            geocode_result = self.gmaps.geocode(city)
            if not geocode_result:
                yield {"type": "error", "message": f"Impossibile trovare le coordinate per '{city}'"}
                return
            
            location = geocode_result[0]['geometry']['location']
            center_lat, center_lng = location['lat'], location['lng']
            yield {"type": "log", "message": f"Coordinate centrali trovate: {center_lat}, {center_lng}"}

            search_radius_m = int(grid_step_m * 1.5)
            
            if radius <= search_radius_m:
                grid_points = [(center_lat, center_lng)]
                search_radius_m = radius
            else:
                grid_points = self.generate_grid_points(center_lat, center_lng, radius, grid_step_m)
            
            yield {"type": "log", "message": f"Griglia generata: verranno effettuate ricerche su {len(grid_points)} punti all'interno dell'area."}

            # seen_place_ids is for this specific extraction run
            seen_place_ids = set()
            places_data = []
            duplicates_in_run = 0
            duplicates_in_db = 0
            
            total_grid_steps = len(keywords) * len(grid_points)
            current_grid_step = 0
            
            yield {"type": "progress", "subtype": "grid", "value": 0, "label": "Ricerca in griglia avviata..."}

            for keyword in keywords:
                yield {"type": "log", "message": f"--- Inizio estrazione per la keyword: '{keyword}' ---"}
                
                for point_idx, (lat, lng) in enumerate(grid_points):
                    if point_idx % 5 == 0 and point_idx > 0:
                        yield {"type": "log", "message": f"Avanzamento: punto di ricerca {point_idx}/{len(grid_points)}..."}
                        
                    next_page_token = None
                    pages_fetched = 0
                    
                    while pages_fetched < 3:
                        if next_page_token:
                            time.sleep(2)
                            places_result = self.gmaps.places_nearby(
                                location=(lat, lng), radius=search_radius_m, keyword=keyword, page_token=next_page_token
                            )
                        else:
                            places_result = self.gmaps.places_nearby(
                                location=(lat, lng), radius=search_radius_m, keyword=keyword
                            )

                        results = places_result.get('results', [])
                        
                        for place in results:
                            place_id = place.get('place_id')
                            # Check if valid AND not seen in this run AND not already in the Excel DB
                            if place_id:
                                if place_id in seen_place_ids:
                                    duplicates_in_run += 1
                                else:
                                    seen_place_ids.add(place_id)
                                    if place_id in already_in_db_place_ids:
                                        duplicates_in_db += 1
                                    else:
                                        places_data.append({
                                            'place_id': place_id,
                                            'keyword_source': keyword,
                                            'name': place.get('name', '')
                                        })
                                
                        next_page_token = places_result.get('next_page_token')
                        pages_fetched += 1
                        if not next_page_token:
                            break
                            
                    current_grid_step += 1
                    progress_pct = int((current_grid_step / total_grid_steps) * 100)
                    yield {"type": "progress", "subtype": "grid", "value": progress_pct, "label": f"Ricerca area ({current_grid_step}/{total_grid_steps}) - '{keyword}'"}

            yield {"type": "log", "message": f"Ricerca griglia completata. Trovate {len(places_data)} NUOVE attività da estrarre (ignorati {duplicates_in_run} duplicati in griglia e {duplicates_in_db} già nel DB)."}
            if len(places_data) == 0:
                yield {"type": "log", "message": "Nessuna nuova attività trovata. Nessun aggiornamento necessario."}
                yield {"type": "done", "data": existing_df.fillna('').to_dict(orient='records')}
                return
            
            yield {"type": "log", "message": "Recupero dei dettagli completi per le singole attività (questo richiederà tempo)..."}
            
            total_places = len(places_data)
            yield {"type": "progress", "subtype": "details", "value": 0, "label": "Estrazione dettagli avviata..."}
            
            final_results = []
            for i, p_data in enumerate(places_data):
                if i % 10 == 0:
                    yield {"type": "log", "message": f"Progresso dettagli: [{i}/{total_places}]"}
                
                try:
                    details_result = self.gmaps.place(
                        place_id=p_data['place_id'],
                        fields=['name', 'formatted_address']
                    )
                    details = details_result.get('result', {})
                    
                    extraction_time = datetime.now().strftime("%d/%m/%Y %H:%M:%S")
                    final_results.append({
                        'Place_ID': p_data['place_id'],
                        'Nome': details.get('name', p_data['name']),
                        'Indirizzo': details.get('formatted_address', ''),
                        'Telefono': details.get('formatted_phone_number', ''),
                        'Sito Web': details.get('website', ''),
                        'Rating': details.get('rating', ''),
                        'Categorie': ", ".join(details.get('types', [])),
                        'Keyword Ricerca': p_data['keyword_source'],
                        'Data Estrazione': extraction_time,
                        'Hide': False,
                        'Call': False
                    })
                except Exception as e:
                    yield {"type": "log", "message": f"[!] Errore estrazione dettagli per '{p_data['name']}': {str(e)}"}
                    
                progress_pct = int(((i + 1) / total_places) * 100)
                yield {"type": "progress", "subtype": "details", "value": progress_pct, "label": f"Recupero dett. ({i+1}/{total_places})"}
                    
            yield {"type": "log", "message": f"Estrazione dettagli completata. Salvataggio in '{filename}'..."}
            
            try:
                # Append new data to the existing dataframe
                new_df = pd.DataFrame(final_results)
                updated_df = pd.concat([existing_df, new_df], ignore_index=True)
                
                # Save to excel
                updated_df.to_excel(filepath, index=False, engine='openpyxl')
                
                yield {"type": "log", "message": f"SUCCESSO: Aggiunti {len(final_results)} nuovi lead alla lista."}
                
                # Return the updated full list to the frontend
                yield {"type": "done", "data": updated_df.fillna('').to_dict(orient='records')}
                
            except Exception as e:
                yield {"type": "error", "message": f"ERRORE salvataggio file Excel: {str(e)}"}

        except Exception as e:
            yield {"type": "error", "message": f"ERRORE CRITICO: {str(e)}"}
