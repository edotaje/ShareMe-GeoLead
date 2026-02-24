from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List
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
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ScrapeRequest(BaseModel):
    city: str
    radius: int
    keywords: List[str]
    list_name: str
    grid_step: int = 500

# In a real production app, we would use Celery/Redis for background jobs.
# For this script-to-app migration, Server-Sent Events (SSE) allows real-time execution & UI streaming.
@app.post("/api/scrape")
async def scrape_locations(request: ScrapeRequest):
    if not request.city or request.radius <= 0 or not request.keywords:
        raise HTTPException(status_code=400, detail="Missing or invalid parameters.")
    
    api_key = os.getenv("GOOGLE_MAPS_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="API key is missing from environment variables.")
    
    try:
        scraper = GoogleMapsScraperService(api_key=api_key)
        
        async def event_generator():
            for event in scraper.run_scraping(request.city, request.radius, request.keywords, request.list_name, request.grid_step):
                yield {"data": json.dumps(event)}
                
        return EventSourceResponse(event_generator())
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/download")
async def download_excel(data: list):
    try:
        df = pd.DataFrame(data)
        
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

@app.get("/health")
def read_health():
    return {"status": "ok"}
