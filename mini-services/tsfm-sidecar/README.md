# tsfm-sidecar — Timestral-5M local inference

Serves the REAL zero-shot foundation-model arm of the TSFM Probabilistic Forecast Lab
(`app/dashboard/tsfm-lab`). The lab's client is `lib/tsfm-lab/sidecar.ts`, which calls
`TSFM_SIDECAR_URL` (default `http://127.0.0.1:3030`).

## Run

```bash
uv venv --python 3.12
uv pip install -r requirements.txt
export HF_HOME=/path/to/hf/cache          # where mistralai/Timestral-5M lives
python server.py                          # http://127.0.0.1:3030
```

Cold weight load ≈ 8 s; per-forecast ≈ 100–150 ms (CPU, `OMP_NUM_THREADS` defaults);
5.2M params / ~100 MB RSS. Forecast longer horizons block-by-block client-side — the
sidecar serves one forward pass per request (`horizon <= 1024`).

## Endpoints

| | |
|---|---|
| `GET /health` | `{status, model, params, taus, supports_covariates, supports_known_covariates}` |
| `POST /forecast` | body `{target[T], pastCovariates[][T], pastNames[], futureCovariates[][H]\|null, futureNames[]\|null, horizon}` → `{taus[21], quantiles[H][21]}` |

Covariate routing: `regime` → `categorical_past_covariates`; other past rows →
`past_covariates`; each `futureNames` row is joined with its same-named past history row
and sent as `known_covariates` over `T+H` (the library wants context+horizon for known
channels). `clip_nonnegative=False` because the price lane works in log units.

## Env

| var | default | meaning |
|---|---|---|
| `TSFM_MODEL_ID` | `mistralai/Timestral-5M` | swap to 28M–209M here — same contract |
| `TSFM_HOST` / `TSFM_PORT` | `127.0.0.1` / `3030` | bind address |
| `TSFM_MAX_CONTEXT` | `4096` | server-side context cap (the lab sends 1024) |
| `HF_HOME` | — | HuggingFace cache holding the weights |
