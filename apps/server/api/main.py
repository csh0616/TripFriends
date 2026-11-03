from fastapi import FastAPI

app = FastAPI(title="Tripfriends")


@app.get("/health")
def health() -> dict:
    raise NotImplementedError
