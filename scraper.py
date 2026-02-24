import os
import time
import threading
import googlemaps
import pandas as pd
import customtkinter as ctk
from dotenv import load_dotenv
import tkinter as tk
from tkinter import messagebox, filedialog
from datetime import datetime

# Carica le variabili di ambiente dal file .env
load_dotenv()

class GoogleMapsScraperApp(ctk.CTk):
    def __init__(self):
        super().__init__()

        self.title("Google Maps Scraper")
        self.geometry("600x650")
        
        # Configurazione grid
        self.grid_columnconfigure(1, weight=1)
        
        # 1. API Key Section
        self.api_label = ctk.CTkLabel(self, text="Google Maps API Key:", font=("Arial", 14, "bold"))
        self.api_label.grid(row=0, column=0, padx=20, pady=(20, 5), sticky="w")
        
        api_key = os.getenv("GOOGLE_MAPS_API_KEY", "")
        self.api_entry = ctk.CTkEntry(self, placeholder_text="Inserisci la tua API Key")
        self.api_entry.grid(row=0, column=1, padx=20, pady=(20, 5), sticky="ew")
        if api_key and api_key != "inserisci_qui_la_tua_api_key_di_google_cloud":
            self.api_entry.insert(0, api_key)

        # 2. Input Section
        self.city_label = ctk.CTkLabel(self, text="Città:", font=("Arial", 14, "bold"))
        self.city_label.grid(row=1, column=0, padx=20, pady=10, sticky="w")
        self.city_entry = ctk.CTkEntry(self, placeholder_text="Es: Milano")
        self.city_entry.grid(row=1, column=1, padx=20, pady=10, sticky="ew")

        self.radius_label = ctk.CTkLabel(self, text="Raggio (metri):", font=("Arial", 14, "bold"))
        self.radius_label.grid(row=2, column=0, padx=20, pady=10, sticky="w")
        self.radius_entry = ctk.CTkEntry(self, placeholder_text="Es: 5000")
        self.radius_entry.grid(row=2, column=1, padx=20, pady=10, sticky="ew")

        self.keywords_label = ctk.CTkLabel(self, text="Keyword (separate da virgola):", font=("Arial", 14, "bold"))
        self.keywords_label.grid(row=3, column=0, padx=20, pady=10, sticky="w")
        self.keywords_entry = ctk.CTkEntry(self, placeholder_text="Es: ristorante, pizzeria, bar")
        self.keywords_entry.grid(row=3, column=1, padx=20, pady=10, sticky="ew")
        
        # 3. Output Section
        self.output_label = ctk.CTkLabel(self, text="Salvataggio File:", font=("Arial", 14, "bold"))
        self.output_label.grid(row=4, column=0, padx=20, pady=10, sticky="w")
        
        self.output_frame = ctk.CTkFrame(self, fg_color="transparent")
        self.output_frame.grid(row=4, column=1, padx=20, pady=10, sticky="ew")
        self.output_frame.grid_columnconfigure(0, weight=1)
        
        self.output_entry = ctk.CTkEntry(self.output_frame)
        self.output_entry.grid(row=0, column=0, sticky="ew")
        default_filename = f"risultati_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
        self.output_entry.insert(0, os.path.join(os.getcwd(), default_filename))
        
        self.browse_button = ctk.CTkButton(self.output_frame, text="Scegli", width=80, command=self.browse_file)
        self.browse_button.grid(row=0, column=1, padx=(10, 0))

        # 4. Action Button
        self.scrape_button = ctk.CTkButton(self, text="Avvia Estrazione", command=self.start_scraping_thread, height=40, font=("Arial", 16, "bold"))
        self.scrape_button.grid(row=5, column=0, columnspan=2, padx=20, pady=(30, 10), sticky="ew")

        # 5. Log Console
        self.console_label = ctk.CTkLabel(self, text="Log Output:", font=("Arial", 14, "bold"))
        self.console_label.grid(row=6, column=0, padx=20, pady=(10, 0), sticky="w")
        self.console = ctk.CTkTextbox(self, height=150, state="disabled")
        self.console.grid(row=7, column=0, columnspan=2, padx=20, pady=(5, 20), sticky="nsew")
        self.grid_rowconfigure(7, weight=1)

    def log(self, message):
        """Aggiunge un messaggio alla console della GUI in modo thread-safe"""
        def update_console():
            self.console.configure(state="normal")
            self.console.insert("end", f"{datetime.now().strftime('%H:%M:%S')} - {message}\n")
            self.console.see("end")
            self.console.configure(state="disabled")
        self.after(0, update_console)

    def browse_file(self):
        filename = filedialog.asksaveasfilename(
            defaultextension=".xlsx",
            filetypes=[("Excel files", "*.xlsx")],
            initialdir=os.getcwd(),
            initialfile=f"risultati_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
        )
        if filename:
            self.output_entry.delete(0, 'end')
            self.output_entry.insert(0, filename)

    def start_scraping_thread(self):
        # Disabilita il bottone durante l'estrazione
        self.scrape_button.configure(state="disabled", text="Estrazione in corso...")
        
        # Raccogli i parametri
        api_key = self.api_entry.get().strip()
        city = self.city_entry.get().strip()
        radius = self.radius_entry.get().strip()
        keywords_str = self.keywords_entry.get().strip()
        output_file = self.output_entry.get().strip()

        if not all([api_key, city, radius, keywords_str, output_file]):
            messagebox.showerror("Errore", "Tutti i campi sono obbligatori!")
            self.scrape_button.configure(state="normal", text="Avvia Estrazione")
            return

        try:
            radius = int(radius)
        except ValueError:
            messagebox.showerror("Errore", "Il raggio deve essere un numero intero (in metri)!")
            self.scrape_button.configure(state="normal", text="Avvia Estrazione")
            return

        keywords = [k.strip() for k in keywords_str.split(",") if k.strip()]

        # Avvia in un thread separato per non bloccare la GUI
        thread = threading.Thread(target=self.run_scraping, args=(api_key, city, radius, keywords, output_file))
        thread.daemon = True
        thread.start()

    def generate_grid_points(self, center_lat, center_lng, radius_m, grid_step_m):
        """
        Generates a grid of (lat, lng) points covering the given radius.
        """
        import math
        
        points = []
        # Approximate meters per degree: lat is ~111.32 km/deg, lng depends on lat.
        lat_step_deg = grid_step_m / 111320.0
        
        # Bounding box limits (square enclosing the circle)
        num_steps = math.ceil(radius_m / grid_step_m)
        
        for i in range(-num_steps, num_steps + 1):
            for j in range(-num_steps, num_steps + 1):
                # Calculate distance constraint from center to corner of grid square
                x_offset_m = i * grid_step_m
                y_offset_m = j * grid_step_m
                
                # Check if this point is within the main circle
                if math.sqrt(x_offset_m**2 + y_offset_m**2) <= radius_m:
                    point_lat = center_lat + (i * lat_step_deg)
                    # Adjust lng offset based on the specific latitude (cosine correction)
                    lng_step_deg = grid_step_m / (111320.0 * math.cos(math.radians(point_lat)))
                    point_lng = center_lng + (j * lng_step_deg)
                    points.append((point_lat, point_lng))
                    
        return points

    def run_scraping(self, api_key, city, radius, keywords, output_file):
        import math
        try:
            self.log("Inizializzazione client Google Maps...")
            gmaps = googlemaps.Client(key=api_key)

            # 1. Trova le coordinate della città
            self.log(f"Ricerca coordinate per la città: {city}")
            geocode_result = gmaps.geocode(city)
            if not geocode_result:
                self.log(f"Errore: Impossibile trovare le coordinate per '{city}'")
                return
            
            location = geocode_result[0]['geometry']['location']
            center_lat, center_lng = location['lat'], location['lng']
            self.log(f"Coordinate centrali trovate: {center_lat}, {center_lng}")

            # 2. Genera griglia di ricerca
            # Usiamo un raggio di ricerca (step) di 500m per bilanciare richieste e copertura.
            # Raggio di sovrapposizione leggermente maggiore per non perdere risultati.
            grid_step_m = 500
            search_radius_m = int(grid_step_m * 1.5) 
            
            if radius <= search_radius_m:
                # Se il raggio richiesto è molto piccolo, facciamo solo una ricerca centrale
                grid_points = [(center_lat, center_lng)]
                search_radius_m = radius
            else:
                grid_points = self.generate_grid_points(center_lat, center_lng, radius, grid_step_m)
            
            self.log(f"Griglia generata: verranno effettuate ricerche su {len(grid_points)} punti all'interno dell'area (Raggio estrazione per punto: {search_radius_m}m).")

            seen_place_ids = set()
            places_data = []

            # 3. Ricerca incrociata (Keyword -> Punti Griglia)
            for keyword in keywords:
                self.log(f"\n--- Inizio estrazione per la keyword: '{keyword}' ---")
                
                for point_idx, (lat, lng) in enumerate(grid_points):
                    if point_idx % 5 == 0 and point_idx > 0:
                        self.log(f"  Avanzamento: punto di ricerca {point_idx}/{len(grid_points)}...")
                        
                    next_page_token = None
                    pages_fetched = 0
                    
                    while pages_fetched < 3: # Massimo 3 pagine (60 risultati) PER PUNTO
                        if next_page_token:
                            time.sleep(2) # Pausa obbligatoria per Google API paginazione
                            places_result = gmaps.places_nearby(
                                location=(lat, lng),
                                radius=search_radius_m,
                                keyword=keyword,
                                page_token=next_page_token
                            )
                        else:
                            places_result = gmaps.places_nearby(
                                location=(lat, lng),
                                radius=search_radius_m,
                                keyword=keyword
                            )

                        results = places_result.get('results', [])
                        
                        # ESTRAZIONE Place ID E DEDUPLICAZIONE
                        for place in results:
                            place_id = place.get('place_id')
                            name = place.get('name', '')
                            
                            if place_id and place_id not in seen_place_ids:
                                seen_place_ids.add(place_id)
                                places_data.append({
                                    'place_id': place_id,
                                    'keyword_source': keyword,
                                    'name': name
                                })
                                
                        next_page_token = places_result.get('next_page_token')
                        pages_fetched += 1
                        
                        if not next_page_token:
                            break # Fine pagine per questo punto per questa keyword

            self.log(f"\nRicerca griglia completata. Trovate {len(places_data)} attività uniche in totale.")
            if len(places_data) == 0:
                self.log("Nessun risultato trovato. Estrazione completata.")
                self.after(0, lambda: self.scrape_button.configure(state="normal", text="Avvia Estrazione"))
                return
            
            # 4. Recupera Dettagli
            self.log("Recupero dei dettagli per i singoli posti (questo richiederà tempo in proporzione al numero di risultati)...")
            
            final_results = []
            for i, p_data in enumerate(places_data):
                place_id = p_data['place_id']
                if i % 10 == 0:
                    self.log(f"  Progresso dettagli: [{i}/{len(places_data)}]")
                
                try:
                    details_result = gmaps.place(
                        place_id=place_id,
                        fields=['name', 'formatted_address', 'formatted_phone_number', 'website', 'rating', 'type']
                    )
                    details = details_result.get('result', {})
                    
                    final_results.append({
                        'Nome': details.get('name', p_data['name']),
                        'Indirizzo': details.get('formatted_address', ''),
                        'Telefono': details.get('formatted_phone_number', ''),
                        'Sito Web': details.get('website', ''),
                        'Rating': details.get('rating', ''),
                        'Categorie': ", ".join(details.get('types', [])),
                        'Keyword Ricerca': p_data['keyword_source']
                    })
                except Exception as e:
                    self.log(f"  [!] Errore su '{p_data['name']}': {str(e)}")
                    
            # 5. Salvataggio
            self.log("\nCreazione del file Excel...")
            df = pd.DataFrame(final_results)
            df.to_excel(output_file, index=False)
            self.log(f"Salvataggio completato: {output_file}")
            
            messagebox.showinfo("Successo", f"Estrazione completata!\nSalvati {len(final_results)} risultati su Excel.\nHai aggirato il limite di 60 risultati!")

        except Exception as e:
            self.log(f"ERRORE CRITICO: {str(e)}")
            messagebox.showerror("Errore", f"Si è verificato un errore:\n{str(e)}")
            
        finally:
            self.after(0, lambda: self.scrape_button.configure(state="normal", text="Avvia Estrazione"))

if __name__ == "__main__":
    app = GoogleMapsScraperApp()
    app.mainloop()
