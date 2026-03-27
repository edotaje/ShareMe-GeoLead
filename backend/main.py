from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator
from typing import List, Optional
import asyncio
import os
import json
from sse_starlette.sse import EventSourceResponse
from services.scraper_service import GoogleMapsScraperService
import pandas as pd
from fastapi.responses import FileResponse, Response
import io
from dotenv import load_dotenv
from routers import lists

# Load env variables from parent directory if needed
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), '..', '.env'))

app = FastAPI(title="Google Maps Scraper API")

app.include_router(lists.router)

# Setup CORS for the Vite React frontend
_cors_origins = os.getenv(
    "CORS_ORIGINS",
    "http://localhost:5173,http://127.0.0.1:5173"
).split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ScrapeRequest(BaseModel):
    city: str = Field(min_length=1, max_length=200)
    radius: int = Field(gt=0, le=50000)
    keywords: List[str] = Field(min_length=1, max_length=10)
    list_name: str = Field(min_length=1, max_length=110)
    grid_step: int = Field(default=500, ge=50, le=10000)

    @field_validator("keywords")
    @classmethod
    def keywords_not_empty(cls, v: List[str]) -> List[str]:
        for kw in v:
            if not kw or len(kw) > 100:
                raise ValueError("Ogni keyword deve essere tra 1 e 100 caratteri.")
        return v


class DownloadRow(BaseModel):
    Place_ID: Optional[str] = ""
    Nome: Optional[str] = ""
    Indirizzo: Optional[str] = ""
    Telefono: Optional[str] = ""
    Sito_Web: Optional[str] = Field(default="", alias="Sito Web")
    Rating: Optional[str] = ""
    Categorie: Optional[str] = ""
    Keyword_Ricerca: Optional[str] = Field(default="", alias="Keyword Ricerca")
    Data_Estrazione: Optional[str] = Field(default="", alias="Data Estrazione")
    Hide: Optional[bool] = False
    Call: Optional[bool] = False
    Interested: Optional[bool] = False
    Note: Optional[str] = ""

    model_config = {"populate_by_name": True, "extra": "allow"}



# In a real production app, we would use Celery/Redis for background jobs.
# For this script-to-app migration, Server-Sent Events (SSE) allows real-time execution & UI streaming.
@app.post("/api/scrape")
async def scrape_locations(request: ScrapeRequest):
    if not request.city or request.radius <= 0 or not request.keywords:
        raise HTTPException(status_code=400, detail="Missing or invalid parameters.")

    api_key = os.getenv("GOOGLE_MAPS_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="API key is missing from environment variables.")

    scraper = GoogleMapsScraperService(api_key=api_key)

    async def event_generator():
        loop = asyncio.get_event_loop()
        queue: asyncio.Queue = asyncio.Queue()
        _SENTINEL = object()

        def _run_sync():
            try:
                for event in scraper.run_scraping(
                    request.city, request.radius, request.keywords,
                    request.list_name, request.grid_step
                ):
                    loop.call_soon_threadsafe(queue.put_nowait, event)
            except Exception as exc:
                loop.call_soon_threadsafe(
                    queue.put_nowait,
                    {"type": "error", "message": f"ERRORE CRITICO: {exc}"}
                )
            finally:
                loop.call_soon_threadsafe(queue.put_nowait, _SENTINEL)

        loop.run_in_executor(None, _run_sync)

        while True:
            event = await queue.get()
            if event is _SENTINEL:
                break
            yield {"data": json.dumps(event)}

    return EventSourceResponse(event_generator())

@app.post("/api/download")
async def download_excel(data: List[DownloadRow]):
    if len(data) > 50000:
        raise HTTPException(status_code=400, detail="Troppi dati: massimo 50.000 righe.")
    try:
        df = pd.DataFrame([row.model_dump(by_alias=True) for row in data])
        
        # Create an in-memory buffer
        buffer = io.BytesIO()
        with pd.ExcelWriter(buffer, engine='openpyxl') as writer:
            df.to_excel(writer, index=False)
        
        buffer.seek(0)
        
        headers = {
            'Content-Disposition': 'attachment; filename="risultati_scraper.xlsx"'
        }
        return Response(content=buffer.getvalue(), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers=headers)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate Excel: {str(e)}")

@app.get("/api/geocode")
async def geocode_location(q: str):
    api_key = os.getenv("GOOGLE_MAPS_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="API key mancante")
    import googlemaps
    gmaps = googlemaps.Client(key=api_key)
    result = gmaps.geocode(q)
    if not result:
        raise HTTPException(status_code=404, detail="Località non trovata")
    loc = result[0]['geometry']['location']
    return {"lat": loc['lat'], "lng": loc['lng']}

@app.get("/health")
def read_health():
    return {"status": "ok"}
