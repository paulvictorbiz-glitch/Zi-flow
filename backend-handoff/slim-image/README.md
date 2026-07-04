# Slim CPU-only backend image (DRAFT — not yet applied)

Cuts `footagebrain-backend:latest` from **~10 GB → ~3 GB**. Two independent wins:

1. **CPU-only torch** (`requirements-hosting.txt` here) — the box has **no GPU**, yet the live
   image ships the full CUDA stack (`nvidia-*` 2.7 GB + CUDA-torch 1.2 GB + `triton` 691 MB ≈
   **4.6 GB**) pulled transitively by `sentence-transformers`. Pinning `torch==…+cpu` drops all of
   it. **Runtime behaviour is identical** — torch already runs on CPU today; we only stop shipping
   GPU libraries that can't execute.
2. **Multi-stage venv build** (`Dockerfile.hosting` here) — builds into `/opt/venv` in a builder
   stage, copies only the venv into a clean runtime stage. Removes ~3 GB of pip/build layer churn
   (the gap between the 10 GB image and its ~6.8 GB live filesystem).

## Why it's safe
- No GPU here, so nothing can hard-require CUDA — anything that did would already be crashing.
- Model weights are unchanged (they live on a host mount, not in the image) → **identical embeddings/transcripts**.
- `faster-whisper` uses CTranslate2 (its own CPU engine), not torch → untouched.

## Apply sequence (HUMAN-GATED — do NOT skip the rollback tag)
```bash
# 1. On the box, back up + drop in the two draft files:
cd /srv/footagebrain/footage-brain-test/backend
cp Dockerfile.hosting Dockerfile.hosting.bak.preslim
cp requirements-hosting.txt requirements-hosting.txt.bak.preslim
#   (scp the two files from backend-handoff/slim-image/ here)

# 2. Tag the current image as a rollback point (the box has NO versioned tags today):
docker tag footagebrain-backend:latest footagebrain-backend:preslim

# 3. Build the new image WITHOUT recreating the running container yet:
cd /srv/footagebrain/footage-brain-test/deploy/hetzner   # NEVER the stale root dir
docker compose build backend

# 4. Smoke-test the freshly built image in a throwaway container BEFORE promoting:
docker run --rm footagebrain-backend:latest python -c \
  "import torch,sentence_transformers,faster_whisper; print('torch', torch.__version__, 'cuda', torch.cuda.is_available())"
#   expect: torch <ver> cuda False   (and no import errors)

# 5. Only if step 4 passes — swap the live container + verify size dropped:
docker compose up -d --force-recreate backend
docker image ls | grep footagebrain-backend          # new :latest should be ~3 GB
curl -s -o /dev/null -w "%{http_code}\n" https://api.footagebrain.com/health   # 200

# ROLLBACK if anything is wrong:
docker tag footagebrain-backend:preslim footagebrain-backend:latest && docker compose up -d --force-recreate backend
```

## Expected first-build hiccup (the ~35% case)
If `torch==2.2.2+cpu` errors or `sentence-transformers` drags in torchvision, pin a matching pair
(`torch==2.2.2+cpu` + `torchvision==0.17.2+cpu`) and rebuild. This is caught at step 3/4 — the live
container is never exposed.
