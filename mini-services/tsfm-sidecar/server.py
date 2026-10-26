"""Timestral-5M inference sidecar — serves the REAL foundation-model arm.

Loads `mistralai/Timestral-5M` (5.2M params, patch 32, 21 quantile knots) via the
official `timestral` library and exposes the two endpoints the TSFM Lab's
`lib/tsfm-lab/sidecar.ts` client calls:

    GET  /health    -> { status, model, params, taus, supports_covariates, ... }
    POST /forecast  -> { taus: [21], quantiles: [[21] x H] }

Contract (mirrors lib/tsfm-lab/sidecar.ts, which is the caller of record):

    request  { target: (number|null)[T],
               pastCovariates: (number|null)[][T],   pastNames: string[],
               futureCovariates: (number|null)[][H]|null, futureNames: string[]|null,
               horizon: int }
    response { taus: number[21], quantiles: number[H][21] }   # sorted along τ

Routing:
  * pastNames rows whose name is categorical (`regime`) -> categorical_past_covariates
  * other pastNames rows                              -> past_covariates (context only)
  * futureNames rows are joined with their same-named past history row and passed
    as known_covariates over T+H (the library wants context+horizon for known channels)

Zero-shot only: the weights are never fine-tuned here. CPU is fine — the 5M model
loads in ~8 s cold and forecasts in ~100–150 ms.

Run:
    uv venv --python 3.12 && uv pip install -r requirements.txt
    HF_HOME=/path/to/hf/cache python server.py          # or: uvicorn server:app --port 3030

Env:
    TSFM_MODEL_ID   default mistralai/Timestral-5M
    TSFM_HOST       default 127.0.0.1
    TSFM_PORT       default 3030
    TSFM_MAX_CONTEXT  default 4096  (server-side cap; the lab sends 1024)
    HF_HOME         where the weights are cached
"""

from __future__ import annotations

import os
import threading
from typing import Any

import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

MODEL_ID = os.environ.get("TSFM_MODEL_ID", "mistralai/Timestral-5M")
HOST = os.environ.get("TSFM_HOST", "127.0.0.1")
PORT = int(os.environ.get("TSFM_PORT", "3030"))
MAX_CONTEXT = int(os.environ.get("TSFM_MAX_CONTEXT", "4096"))
MAX_HORIZON = 1024  # the model's own single-pass ceiling

# names routed to categorical_past_covariates (target-encoded by the library)
CATEGORICAL_NAMES = {"regime"}

app = FastAPI(title="tsfm-sidecar", version="1.0.0")

_forecaster: Any = None
_lock = threading.Lock()


def _load():
    global _forecaster
    if _forecaster is not None:
        return _forecaster
    with _lock:
        if _forecaster is not None:
            return _forecaster
        import torch  # noqa: F401  (imported here so --help stays fast)
        from timestral import TimestralForecaster

        # fp32 CPU: the 5M checkpoint is small enough that bf16/fp16 buys nothing
        _forecaster = TimestralForecaster.from_pretrained(MODEL_ID, device="cpu")
    return _forecaster


def _param_count(forecaster: Any) -> int | None:
    model = getattr(forecaster, "model", None)
    if model is not None and hasattr(model, "parameters"):
        try:
            return int(sum(p.numel() for p in model.parameters()))
        except Exception:
            return None
    return None


def _taus(forecaster: Any) -> list[float] | None:
    model = getattr(forecaster, "model", None)
    cfg = getattr(model, "config", None)
    knots = getattr(cfg, "quantile_knots", None)
    if knots:
        return [float(t) for t in knots]
    return None


def _as_array(rows: list[list[Any]] | None) -> np.ndarray | None:
    """Rows of numbers-or-null -> float32 ndarray (1, C, T) with NaN for nulls.

    The library asserts (B, C, T) on every covariate tensor.
    """
    if not rows:
        return None
    a = np.array(
        [[np.nan if v is None else float(v) for v in row] for row in rows],
        dtype=np.float32,
    )
    return a[None, :, :]  # (1, C, T)


def _health_payload(ok: bool, note: str | None = None) -> dict[str, Any]:
    payload: dict[str, Any] = {"status": "ok" if ok else "error", "model": MODEL_ID}
    if not ok:
        payload["note"] = note or "model not loaded"
        return payload
    f = _load()
    payload["params"] = _param_count(f)
    payload["taus"] = _taus(f)
    payload["supports_covariates"] = bool(getattr(f, "supports_covariates", False))
    payload["supports_known_covariates"] = bool(getattr(f, "supports_known_covariates", False))
    return payload


@app.get("/health")
def health() -> dict[str, Any]:
    try:
        return _health_payload(True)
    except Exception as e:  # model missing / weights absent / OOM
        return _health_payload(False, f"{type(e).__name__}: {e}")


class ForecastRequest(BaseModel):
    target: list[float | None] = Field(..., description="context values, length T")
    pastCovariates: list[list[float | None]] | None = None
    pastNames: list[str] | None = None
    futureCovariates: list[list[float | None]] | None = None
    futureNames: list[str] | None = None
    horizon: int = Field(..., ge=1, le=MAX_HORIZON)


@app.post("/forecast")
def forecast(req: ForecastRequest) -> dict[str, Any]:
    T = len(req.target)
    if T < 32:
        raise HTTPException(400, f"context too short: {T} steps (patch 32 needs >= 32)")
    if T > MAX_CONTEXT:
        raise HTTPException(400, f"context too long: {T} > {MAX_CONTEXT}")
    H = req.horizon

    f = _load()

    context = np.array([[req.target]], dtype=np.float32)  # (1, 1, T)

    # ---- split the past block: categorical vs numeric -------------------------
    past_names = req.pastNames or []
    past_rows = req.pastCovariates or []
    if len(past_names) != len(past_rows):
        raise HTTPException(400, "pastNames/pastCovariates length mismatch")

    num_past: list[list[float | None]] = []
    cat_past: list[list[float | None]] = []
    past_by_name: dict[str, list[float | None]] = {}
    for name, row in zip(past_names, past_rows):
        if len(row) != T:
            raise HTTPException(400, f"past row '{name}' has {len(row)} values, expected {T}")
        past_by_name[name] = row
        (cat_past if name in CATEGORICAL_NAMES else num_past).append(row)

    # ---- known-future channels: join history + horizon -----------------------
    fut_names = req.futureNames or []
    fut_rows = req.futureCovariates or []
    if len(fut_names) != len(fut_rows):
        raise HTTPException(400, "futureNames/futureCovariates length mismatch")

    known: list[list[float | None]] = []
    for name, row in zip(fut_names, fut_rows):
        if len(row) != H:
            raise HTTPException(400, f"future row '{name}' has {len(row)} values, expected {H}")
        hist = past_by_name.get(name)
        if hist is None:
            raise HTTPException(400, f"future row '{name}' has no matching past history row")
        known.append([*hist, *row])

    kwargs: dict[str, Any] = {
        "prediction_length": H,
        # log-price lanes need negative values; the harness handles monotonicity
        "clip_nonnegative": False,
    }
    arr = _as_array(num_past)
    if arr is not None:
        kwargs["past_covariates"] = arr  # (1, C_past, T)
    arr = _as_array(cat_past)
    if arr is not None:
        kwargs["categorical_past_covariates"] = arr  # (1, C_cat, T)
    arr = _as_array(known)
    if arr is not None:
        kwargs["known_covariates"] = arr  # (1, C_known, T + H)

    out = f.forecast(context=context, **kwargs)

    quantiles = out.quantiles[0, 0].float().cpu().numpy()  # (H, Q)
    taus = [float(t) for t in out.quantile_levels]
    return {"taus": taus, "quantiles": quantiles.tolist()}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=HOST, port=PORT)
