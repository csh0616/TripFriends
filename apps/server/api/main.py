from fastapi import FastAPI

from catalog import get_catalog

app = FastAPI(title="Tripfriends")


@app.get("/health")
def health() -> dict:
    return {"ok": True, "cards": len(get_catalog())}
