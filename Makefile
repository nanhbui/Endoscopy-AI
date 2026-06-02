# ── Endoscopy AI — Makefile ───────────────────────────────────────────────────
#
# LOCAL targets (run on this machine):
#   make dev              — start BE + FE in parallel (dev mode)
#   make be / fe          — start backend / frontend only
#   make install          — install all deps (Python venv + Node modules)
#   make docker-up/down   — Docker Compose stack (GPU)
#   make lint / test      — lint & test
#   make env-check        — verify .env files exist
#   make clean            — remove build artifacts
#
# REMOTE / GPU SERVER targets (via VPN → ssh emie@10.8.0.7):
#   make vpn-status       — check VPN + GPU server reachability
#   make vpn-up           — connect VPN (nmcli, "bee15")
#   make vpn-down         — disconnect VPN
#   make ssh              — open SSH shell on GPU server
#   make gpu-status       — show nvidia-smi on GPU server
#   make remote-dev       — deploy & start stack on GPU server (Docker Compose)
#   make remote-down      — stop stack on GPU server
#   make remote-logs      — stream Docker logs from GPU server
#   make remote-install   — pip install -r requirements.txt on GPU server
#   make sync             — rsync local code → GPU server (excludes .venv, node_modules)
#
#   make help             — show this help

.PHONY: help dev be fe install install-py install-fe \
        docker-up docker-down docker-logs docker-build \
        lint test env-check env-init clean \
        vpn-status vpn-up vpn-down \
        ssh tunnel gpu-status remote-dev remote-down remote-logs remote-install sync

# ── Paths ─────────────────────────────────────────────────────────────────────
ROOT        := $(shell pwd)
VENV        := $(ROOT)/.venv
PYTHON      := $(VENV)/bin/python
PIP         := $(VENV)/bin/pip
UVICORN     := $(VENV)/bin/python -m uvicorn
BE_SRC      := $(ROOT)/src/backend/api
FE_SRC      := $(ROOT)/frontend

# ── Remote / VPN config ───────────────────────────────────────────────────────
VPN_NAME    := bee15
GPU_HOST    := 10.8.0.7
GPU_USER    := emie
REMOTE_DIR  := ~/DATN_ver0
SSH_OPTS    := -o ConnectTimeout=8 -o StrictHostKeyChecking=no
SSH         := ssh $(SSH_OPTS) $(GPU_USER)@$(GPU_HOST)

# ── Colors ────────────────────────────────────────────────────────────────────
CYAN  := \033[0;36m
GREEN := \033[0;32m
YELLOW:= \033[1;33m
RED   := \033[0;31m
RESET := \033[0m

# ─────────────────────────────────────────────────────────────────────────────
help:
	@echo ""
	@echo "$(CYAN)Endoscopy AI — available targets$(RESET)"
	@echo ""
	@echo "$(YELLOW)── Local ─────────────────────────────────────$(RESET)"
	@echo "  $(GREEN)make dev$(RESET)              Start backend + frontend (dev mode, parallel)"
	@echo "  $(GREEN)make be$(RESET)               Start backend only"
	@echo "  $(GREEN)make fe$(RESET)               Start frontend only"
	@echo "  $(GREEN)make install$(RESET)          Install all deps (Python venv + Node modules)"
	@echo "  $(GREEN)make install-py$(RESET)       Install Python deps into .venv"
	@echo "  $(GREEN)make install-fe$(RESET)       Install Node modules (npm ci)"
	@echo "  $(GREEN)make docker-up$(RESET)        Build & start Docker Compose (GPU)"
	@echo "  $(GREEN)make docker-down$(RESET)      Stop Docker Compose stack"
	@echo "  $(GREEN)make docker-logs$(RESET)      Tail logs from all containers"
	@echo "  $(GREEN)make docker-build$(RESET)     Rebuild Docker images"
	@echo "  $(GREEN)make lint$(RESET)             Run ESLint on frontend"
	@echo "  $(GREEN)make test$(RESET)             Run all tests"
	@echo "  $(GREEN)make env-init$(RESET)         Copy configs/.env.example → BE + FE env files"
	@echo "  $(GREEN)make env-check$(RESET)        Verify .env files are in place"
	@echo "  $(GREEN)make clean$(RESET)            Remove build artifacts & caches"
	@echo ""
	@echo "$(YELLOW)── Remote GPU server (10.8.0.7 via VPN) ─────$(RESET)"
	@echo "  $(GREEN)make vpn-status$(RESET)       Check VPN + server reachability"
	@echo "  $(GREEN)make vpn-up$(RESET)           Connect VPN (\"$(VPN_NAME)\")"
	@echo "  $(GREEN)make vpn-down$(RESET)         Disconnect VPN"
	@echo "  $(GREEN)make ssh$(RESET)              Open interactive SSH shell"
	@echo "  $(GREEN)make tunnel$(RESET)           SSH tunnel port 8001 (bypass firewall)"
	@echo "  $(GREEN)make gpu-status$(RESET)       Run nvidia-smi on remote server"
	@echo "  $(GREEN)make sync$(RESET)             rsync local code → remote server"
	@echo "  $(GREEN)make remote-install$(RESET)   pip install on remote server"
	@echo "  $(GREEN)make remote-dev$(RESET)       Deploy & start stack on GPU server"
	@echo "  $(GREEN)make remote-down$(RESET)      Stop stack on GPU server"
	@echo "  $(GREEN)make remote-logs$(RESET)      Stream Docker logs from GPU server"
	@echo ""

# ─────────────────────────────────────────────────────────────────────────────
# Local — dev
# ─────────────────────────────────────────────────────────────────────────────
dev: env-check
	@echo "$(CYAN)Starting backend + frontend in dev mode…$(RESET)"
	@echo "$(YELLOW)  BE → http://localhost:8001$(RESET)"
	@echo "$(YELLOW)  FE → http://localhost:3000$(RESET)"
	@bash -c '\
		trap "kill 0" SIGINT SIGTERM EXIT; \
		cd $(BE_SRC) && $(UVICORN) endoscopy_ws_server:app --host 0.0.0.0 --port 8001 --reload & \
		cd $(FE_SRC) && npm run dev & \
		wait'

be: env-check
	@echo "$(CYAN)Starting backend (reload enabled)…$(RESET)"
	cd $(BE_SRC) && $(UVICORN) endoscopy_ws_server:app --host 0.0.0.0 --port 8001 --reload

fe:
	@echo "$(CYAN)Starting frontend (Next.js dev)…$(RESET)"
	cd $(FE_SRC) && npm run dev

# ─────────────────────────────────────────────────────────────────────────────
# Install
# ─────────────────────────────────────────────────────────────────────────────
install: install-py install-fe
	@echo "$(GREEN)All dependencies installed.$(RESET)"

install-py:
	@echo "$(CYAN)Installing Python dependencies into .venv…$(RESET)"
	@if [ ! -d "$(VENV)" ]; then python3 -m venv $(VENV); fi
	$(PIP) install --upgrade pip
	$(PIP) install -r $(ROOT)/requirements.txt

install-fe:
	@echo "$(CYAN)Installing Node modules…$(RESET)"
	cd $(FE_SRC) && npm ci

# ─────────────────────────────────────────────────────────────────────────────
# Docker (local GPU stack)
# ─────────────────────────────────────────────────────────────────────────────
docker-up: env-check
	@echo "$(CYAN)Building & starting Docker Compose stack (GPU)…$(RESET)"
	docker compose up --build -d
	@echo "$(GREEN)Stack is up — BE: http://localhost:8001  FE: http://localhost:3000$(RESET)"

docker-down:
	docker compose down

docker-logs:
	docker compose logs -f

docker-build:
	docker compose build

# ─────────────────────────────────────────────────────────────────────────────
# Quality
# ─────────────────────────────────────────────────────────────────────────────
lint:
	cd $(FE_SRC) && npm run lint

test:
	@echo "$(CYAN)Frontend tests…$(RESET)"
	cd $(FE_SRC) && npm test
	@echo "$(CYAN)Backend tests…$(RESET)"
	$(PYTHON) -m pytest $(ROOT)/tests -v

# ─────────────────────────────────────────────────────────────────────────────
# Env
# ─────────────────────────────────────────────────────────────────────────────

# Copy configs/.env.example → src/backend/api/.env and frontend/.env.local
# Skips files that already exist (safe to re-run).
env-init:
	@echo "$(CYAN)Initialising env files from configs/.env.example…$(RESET)"
	@if [ ! -f "$(BE_SRC)/.env" ]; then \
		cp $(ROOT)/configs/.env.example $(BE_SRC)/.env; \
		echo "  $(GREEN)created$(RESET) $(BE_SRC)/.env  ← fill in OPENAI_API_KEY"; \
	else \
		echo "  $(YELLOW)exists$(RESET)  $(BE_SRC)/.env  (skipped)"; \
	fi
	@if [ ! -f "$(FE_SRC)/.env.local" ]; then \
		cp $(ROOT)/configs/.env.example $(FE_SRC)/.env.local; \
		echo "  $(GREEN)created$(RESET) $(FE_SRC)/.env.local"; \
	else \
		echo "  $(YELLOW)exists$(RESET)  $(FE_SRC)/.env.local (skipped)"; \
	fi
	@echo "$(YELLOW)Edit the files above before running make dev or make remote-dev$(RESET)"

env-check:
	@missing=0; \
	if [ ! -f "$(BE_SRC)/.env" ]; then \
		echo "$(YELLOW)WARNING: $(BE_SRC)/.env not found. Run: make env-init$(RESET)"; \
		missing=1; \
	fi; \
	if [ ! -f "$(FE_SRC)/.env.local" ]; then \
		echo "$(YELLOW)WARNING: $(FE_SRC)/.env.local not found. Run: make env-init$(RESET)"; \
		missing=1; \
	fi; \
	if [ $$missing -eq 1 ]; then \
		echo "$(YELLOW)Env files missing — server may not start correctly.$(RESET)"; \
	fi

# ─────────────────────────────────────────────────────────────────────────────
# Clean
# ─────────────────────────────────────────────────────────────────────────────
clean:
	rm -rf $(FE_SRC)/.next $(FE_SRC)/node_modules/.cache
	find $(ROOT)/src -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
	find $(ROOT)/src -name "*.pyc" -delete 2>/dev/null || true
	@echo "$(GREEN)Clean done.$(RESET)"

# ─────────────────────────────────────────────────────────────────────────────
# VPN
# ─────────────────────────────────────────────────────────────────────────────
vpn-status:
	@echo "$(CYAN)── VPN status ────────────────────────────────$(RESET)"
	@if ip link show tun0 >/dev/null 2>&1; then \
		MY_IP=$$(ip addr show tun0 | grep 'inet ' | awk '{print $$2}'); \
		echo "$(GREEN)✔ VPN up — local VPN IP: $$MY_IP$(RESET)"; \
	else \
		echo "$(RED)✘ VPN down (tun0 not found)$(RESET)"; \
	fi
	@echo ""
	@echo "$(CYAN)── GPU server ($(GPU_HOST)) ──────────────────$(RESET)"
	@if ping -c 1 -W 3 $(GPU_HOST) >/dev/null 2>&1; then \
		RTT=$$(ping -c 1 -W 3 $(GPU_HOST) | grep -oP 'time=\K[0-9.]+'); \
		echo "$(GREEN)✔ Reachable — RTT: $${RTT}ms$(RESET)"; \
	else \
		echo "$(RED)✘ Not reachable — check VPN or server status$(RESET)"; \
	fi

vpn-up:
	@echo "$(CYAN)Connecting VPN \"$(VPN_NAME)\"…$(RESET)"
	@nmcli connection up "$(VPN_NAME)" && echo "$(GREEN)✔ VPN connected$(RESET)" || echo "$(RED)✘ VPN connection failed$(RESET)"
	@sleep 2
	@$(MAKE) --no-print-directory vpn-status

vpn-down:
	@echo "$(CYAN)Disconnecting VPN \"$(VPN_NAME)\"…$(RESET)"
	nmcli connection down "$(VPN_NAME)"
	@echo "$(GREEN)VPN disconnected$(RESET)"

# ─────────────────────────────────────────────────────────────────────────────
# Remote GPU server
# ─────────────────────────────────────────────────────────────────────────────

# Check VPN is up before any remote command
_require-vpn:
	@if ! ip link show tun0 >/dev/null 2>&1; then \
		echo "$(RED)✘ VPN is not connected. Run: make vpn-up$(RESET)"; \
		exit 1; \
	fi
	@if ! ping -c 1 -W 3 $(GPU_HOST) >/dev/null 2>&1; then \
		echo "$(RED)✘ GPU server $(GPU_HOST) not reachable. Check VPN or server.$(RESET)"; \
		exit 1; \
	fi

ssh: _require-vpn
	@echo "$(CYAN)Connecting to $(GPU_USER)@$(GPU_HOST)…$(RESET)"
	ssh $(SSH_OPTS) $(GPU_USER)@$(GPU_HOST)

tunnel: _require-vpn
	@echo "$(CYAN)SSH tunnel: localhost:8001 → $(GPU_HOST):8001$(RESET)"
	@echo "$(YELLOW)Keep this terminal open while using the app. Ctrl-C to stop.$(RESET)"
	ssh $(SSH_OPTS) -N -L 8001:localhost:8001 $(GPU_USER)@$(GPU_HOST)

gpu-status: _require-vpn
	@echo "$(CYAN)── GPU server: nvidia-smi ────────────────────$(RESET)"
	$(SSH) "nvidia-smi"
	@echo ""
	@echo "$(CYAN)── Disk usage ────────────────────────────────$(RESET)"
	$(SSH) "df -h ~"
	@echo ""
	@echo "$(CYAN)── Running Docker containers ─────────────────$(RESET)"
	$(SSH) "docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' 2>/dev/null || echo 'Docker not running or not installed'"

# rsync local repo to remote (excludes heavy/generated dirs)
# .env files are explicitly synced separately (excluded from broad sync for safety)
sync: _require-vpn
	@echo "$(CYAN)Syncing code to $(GPU_USER)@$(GPU_HOST):$(REMOTE_DIR) …$(RESET)"
	rsync -avz --progress --no-links \
		--exclude='.git' \
		--exclude='.venv' \
		--exclude='.claude' \
		--exclude='frontend/node_modules' \
		--exclude='frontend/.next' \
		--exclude='__pycache__' \
		--exclude='*.pyc' \
		--exclude='data/' \
		--exclude='sample_code/' \
		--exclude='models/' \
		--exclude='*.pt' \
		--exclude='*.onnx' \
		--exclude='*.trt' \
		--exclude='logs/' \
		--exclude='*.log' \
		$(ROOT)/ $(GPU_USER)@$(GPU_HOST):$(REMOTE_DIR)/
	@echo "$(CYAN)Syncing .env files…$(RESET)"
	@if [ -f "$(BE_SRC)/.env" ]; then \
		rsync -az $(BE_SRC)/.env $(GPU_USER)@$(GPU_HOST):$(REMOTE_DIR)/src/backend/api/.env; \
		echo "  $(GREEN)✔$(RESET) src/backend/api/.env"; \
	else \
		echo "  $(YELLOW)⚠ $(BE_SRC)/.env not found — run: make env-init$(RESET)"; \
	fi
	@if [ -f "$(FE_SRC)/.env.local" ]; then \
		rsync -az $(FE_SRC)/.env.local $(GPU_USER)@$(GPU_HOST):$(REMOTE_DIR)/frontend/.env.local; \
		echo "  $(GREEN)✔$(RESET) frontend/.env.local"; \
	fi
	@echo "$(GREEN)✔ Sync complete$(RESET)"

remote-install: _require-vpn
	@echo "$(CYAN)Installing Python deps on GPU server…$(RESET)"
	$(SSH) "cd $(REMOTE_DIR) && \
		[ ! -d .venv ] && python3 -m venv .venv || true && \
		.venv/bin/pip install --upgrade pip -q && \
		.venv/bin/pip install -r requirements.txt"
	@echo "$(GREEN)✔ Remote install done$(RESET)"

remote-dev: _require-vpn env-check
	@echo "$(CYAN)Deploying & starting stack on GPU server…$(RESET)"
	@echo "$(YELLOW)  Syncing code first…$(RESET)"
	@$(MAKE) --no-print-directory sync
	@echo "$(YELLOW)  Starting Docker Compose on server…$(RESET)"
	$(SSH) "cd $(REMOTE_DIR) && docker compose up --build -d"
	@echo "$(GREEN)✔ Remote stack is up$(RESET)"
	@echo "  BE → http://$(GPU_HOST):8001"
	@echo "  FE → http://$(GPU_HOST):3000"

remote-down: _require-vpn
	@echo "$(CYAN)Stopping stack on GPU server…$(RESET)"
	$(SSH) "cd $(REMOTE_DIR) && docker compose down 2>&1 | grep -v 'env file.*not found' || true"
	@echo "$(GREEN)✔ Remote stack stopped$(RESET)"

remote-logs: _require-vpn
	@echo "$(CYAN)Streaming logs from GPU server (Ctrl-C to stop)…$(RESET)"
	$(SSH) "cd $(REMOTE_DIR) && docker compose logs -f 2>&1 | grep -v 'env file.*not found' || true"

# ─────────────────────────────────────────────────────────────────────────────
# Remote ngrok stack (server4 native: BE + FE + Caddy + ngrok via ~/start-stack.sh)
# ─────────────────────────────────────────────────────────────────────────────
remote-stack-up: _require-vpn
	@echo "$(CYAN)Starting ngrok stack on $(GPU_HOST)…$(RESET)"
	$(SSH) 'bash ~/start-stack.sh'

remote-stack-down: _require-vpn
	@echo "$(CYAN)Stopping ngrok stack on $(GPU_HOST)…$(RESET)"
	$(SSH) 'bash ~/stop-stack.sh'

remote-stack-status: _require-vpn
	@echo "$(CYAN)Stack status on $(GPU_HOST):$(RESET)"
	@$(SSH) "ss -tln | grep -E ':(8001|3000|8080)' || echo '  ✗ no service listening'; echo; pgrep -fa 'uvicorn|next|caddy|ngrok' | head"

remote-log-be: _require-vpn
	$(SSH) 'tail -n 200 -f ~/logs/be.log'

remote-log-fe: _require-vpn
	$(SSH) 'tail -n 200 -f ~/logs/fe.log'

remote-log-caddy: _require-vpn
	$(SSH) 'tail -n 200 -f ~/logs/caddy.log'

remote-log-ngrok: _require-vpn
	$(SSH) 'tail -n 200 -f ~/logs/ngrok.log'

# ─────────────────────────────────────────────────────────────────────────────
# Auto-sync: watch local code → rsync to server4 on every change
# BE auto-reloads via uvicorn --reload; FE needs `npm run dev` for HMR
# ─────────────────────────────────────────────────────────────────────────────
sync-fast: _require-vpn
	@rsync -azq --no-links \
		--exclude='.git' --exclude='.venv' --exclude='.claude' \
		--exclude='node_modules' --exclude='.next' \
		--exclude='__pycache__' --exclude='*.pyc' --exclude='*.log' \
		$(ROOT)/src/ $(GPU_USER)@$(GPU_HOST):$(REMOTE_DIR)/src/
	@rsync -azq --no-links \
		--exclude='node_modules' --exclude='.next' --exclude='.claude' \
		$(ROOT)/frontend/ $(GPU_USER)@$(GPU_HOST):$(REMOTE_DIR)/frontend/

sync-watch: _require-vpn
	@which inotifywait > /dev/null || { echo "$(RED)Install inotify-tools: sudo apt install inotify-tools$(RESET)"; exit 1; }
	@echo "$(CYAN)Watching src/ + frontend/ — rsync on change. Ctrl-C to stop.$(RESET)"
	@$(MAKE) --no-print-directory sync-fast
	@while inotifywait -qq -r -e modify,create,delete,move \
		--exclude '(\.venv|node_modules|\.next|\.git|__pycache__|\.pyc$$|\.swp$$|\.log$$)' \
		$(ROOT)/src $(ROOT)/frontend; do \
		$(MAKE) --no-print-directory sync-fast && echo "$(GREEN)$$(date +%T) ✔ synced$(RESET)"; \
	done
