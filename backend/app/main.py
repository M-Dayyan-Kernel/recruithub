from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.routes import jobs, candidates, shortlist, screening, interviews, settings

app = FastAPI(title="AI Recruitment POC", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:5175",
        "http://localhost:5176",
        "http://localhost:5177",
        "http://localhost:5178",
        "http://127.0.0.1:5173",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    return JSONResponse(
        status_code=500,
        content={"error": type(exc).__name__, "detail": str(exc)},
    )


@app.get("/health", tags=["health"])
async def health():
    return {"status": "ok", "version": "1.0.0"}


app.include_router(jobs.router, prefix="/api/jobs", tags=["jobs"])
app.include_router(candidates.router, prefix="/api", tags=["candidates"])
app.include_router(shortlist.router, prefix="/api", tags=["shortlist"])
app.include_router(screening.router, prefix="/api", tags=["screening"])
app.include_router(interviews.router, prefix="/api", tags=["interviews"])
app.include_router(settings.router, prefix="/api", tags=["settings"])
