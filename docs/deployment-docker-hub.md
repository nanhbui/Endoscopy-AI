# Deployment — Docker Hub

Pull pre-built images, run on any host with NVIDIA GPU. No source clone required.

## Image registry

```
docker.io/ngocanh031004/endoscopy-backend:<tag>
docker.io/ngocanh031004/endoscopy-frontend:<tag>
```

Tags:
- `latest` — head of `main`
- `v0.1.0-revamp` and other `vX.Y.Z` — pinned releases (git tags)

## Prerequisites on target host

| | |
|---|---|
| OS | Ubuntu 22.04+ (any Linux with cgroups v2) |
| **GPU** | **NVIDIA, CUDA 11.8 compatible — REQUIRED. Backend does YOLO + StrongSORT ReID inference per frame; CPU-only will not work in real time. Tested on RTX 4080 SUPER (server4). Minimum recommended: RTX 3060 (8GB VRAM) for sub-100ms latency.** |
| VRAM | 6GB+ (YOLO ~2GB + StrongSORT ReID ~3GB; headroom for batching) |
| Drivers | `nvidia-smi` works on host (driver ≥ 525 for CUDA 11.8) |
| Toolkit | `nvidia-container-toolkit` installed (`sudo apt install nvidia-container-toolkit && sudo systemctl restart docker`) |
| Docker | 24+ with compose plugin |
| Disk | ~10GB for images + uploads volume |
| RAM | 16GB+ |

> **Không có GPU → BE crash hoặc chạy CPU 1-2 fps = không demo được.** Image base là `nvidia/cuda:11.8.0-cudnn8-runtime-ubuntu22.04` — bắt buộc host phải có NVIDIA driver + `nvidia-container-toolkit` cấu hình runtime. Verify trước khi pull:
> ```bash
> docker run --rm --gpus all nvidia/cuda:11.8.0-base-ubuntu22.04 nvidia-smi
> ```
> Phải thấy bảng GPU. Nếu lỗi → fix host setup trước.

## Quick start

```bash
# 1. Get the compose file (only file needed)
curl -O https://raw.githubusercontent.com/nanhbui/Endoscopy-AI/main/docker-compose.prod.yml

# 2. Prepare env files (placed in the same directory)
mkdir -p src/backend/api frontend
cat > src/backend/api/.env <<EOF
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
OLLAMA_MODEL=qwen2.5vl:7b
EOF
cat > frontend/.env.local <<EOF
NEXT_PUBLIC_API_BASE=https://your-public-url.example.com
EOF

# 3. Pull + run
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d

# 4. Verify
docker compose -f docker-compose.prod.yml ps
curl http://localhost:8001/health
curl -I http://localhost:3000/
```

## Public exposure (ngrok or custom domain)

See [deployment-ngrok.md](deployment-ngrok.md) — the BE/FE/Caddy/ngrok pipeline. Replace the local-native start scripts with `docker compose` lifecycle:

```bash
docker compose -f docker-compose.prod.yml up -d    # equivalent to start-stack.sh
docker compose -f docker-compose.prod.yml down     # equivalent to stop-stack.sh
docker compose -f docker-compose.prod.yml logs -f backend
```

Caddy + ngrok still run as host-level binaries pointing to `localhost:3000` (FE) and `localhost:8001` (BE).

## Pin a release

```bash
DH_USERNAME=nanhbui IMAGE_TAG=v0.1.0-revamp docker compose -f docker-compose.prod.yml up -d
```

Or `export` once:
```bash
export DH_USERNAME=nanhbui IMAGE_TAG=v0.1.0-revamp
docker compose -f docker-compose.prod.yml up -d
```

## Updating to a new release

```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d   # recreates containers with new image
```

Roll back with explicit tag:
```bash
IMAGE_TAG=v0.0.9 docker compose -f docker-compose.prod.yml up -d
```

## CI auto-build

`.github/workflows/docker-publish.yml` rebuilds + pushes both images on:
- Every push to `main` → tags `:latest`
- Every `vX.Y.Z` git tag → tags `:vX.Y.Z` + `:latest`
- Manual trigger via Actions UI (with custom `NEXT_PUBLIC_API_BASE` input)

### Required repo secrets

In GitHub repo Settings → Secrets and variables → Actions:

| Name | Value |
|---|---|
| `DOCKERHUB_USERNAME` | `ngocanh031004` |
| `DOCKERHUB_TOKEN` | Personal Access Token from https://hub.docker.com/settings/security (NOT password) |

### Release flow

```bash
# On any branch — bump version + tag
git tag v0.1.0-revamp
git push origin v0.1.0-revamp
# CI builds + pushes both images with both tags
```

## What's inside each image

**Backend (`endoscopy-backend`)** — `nvidia/cuda:11.8.0-cudnn8-runtime-ubuntu22.04` base + Python 3.10 + GStreamer + Ultralytics YOLO + StrongSORT (boxmot) + FastAPI + curated weights in `/app/models/`. Size ~6GB.

**Frontend (`endoscopy-frontend`)** — `node:20-alpine` runtime + Next.js 16 standalone build. `NEXT_PUBLIC_API_BASE` baked at build time (override via build-arg). Size ~200MB.

## Volume layout

| Volume | Mount | Purpose |
|---|---|---|
| `uploads` | `/app/data/uploads` | Uploaded videos persist across container restarts |
| `backend_logs` | `/app/src/backend/api/logs` | BE access + error logs |
| `frontend_logs` | `/app/logs` | FE next-server logs |

Bind-mount alternative (host directory):
```yaml
volumes:
  - ./uploads:/app/data/uploads
```

## Troubleshoot

| Symptom | Cause | Fix |
|---|---|---|
| Pull fails: `pull access denied` | Image is private | `docker login` first; verify username/token |
| BE starts but tracker fails | boxmot missing in image | Rebuild — `requirements.txt` should have `boxmot>=10.0.0` |
| `nvidia-smi` not found in container | Toolkit not installed on host | Install `nvidia-container-toolkit`; restart docker |
| WS connection refused | BE port not exposed publicly | Add reverse proxy (Caddy) + tunnel (ngrok) per `deployment-ngrok.md` |
| FE 404 on every page | Wrong `NEXT_PUBLIC_API_BASE` baked | Trigger workflow_dispatch with correct URL → new image |
| Models not found inside container | Old build before `models/` was included | Pull latest tag; verify `/app/models/` exists in container: `docker exec endoscopy-backend ls /app/models` |
