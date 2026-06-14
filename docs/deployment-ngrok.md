# Deployment — server4 qua ngrok

Public access cho BE+FE chạy trên server4 (sau NAT, không port-forward) qua 1 ngrok tunnel.

## URL public

```
https://ferris-smudgy-fondue.ngrok-free.dev
```

## Kiến trúc

```
Browser ─ https ─→ ngrok edge ─ tunnel ─→ server4:8080 (Caddy)
                                                │
                                                ├─ /ws/* /analytics/* /stream/*
                                                │  /upload* /library/* /sessions/*
                                                │  /session/* /health      → 127.0.0.1:8001 (BE uvicorn)
                                                │
                                                └─ * (HTML, JS, _next/...)  → 127.0.0.1:3000 (FE next start)
```

## Ports

| Port | Process | Bind |
|---|---|---|
| 8001 | BE uvicorn | 0.0.0.0 |
| 3000 | FE Next.js | 0.0.0.0 |
| 8080 | Caddy reverse proxy | :: (v4+v6) |
| 2019 | Caddy admin | 127.0.0.1 |
| 4040 | ngrok web UI | 127.0.0.1 |

## File quan trọng trên server4

```
~/Caddyfile                       # config reverse proxy (gitignore)
~/.config/ngrok/ngrok.yml         # authtoken ngrok (KHÔNG commit)
~/DATN_ver0/frontend/.env.local   # NEXT_PUBLIC_API_BASE=https://<ngrok-domain>
~/bin/ngrok ~/bin/caddy           # user binaries
~/.nvm/                           # Node 22+ qua nvm
```

## Khởi động (tmux 4 window)

```bash
ssh emie@10.8.0.7
tmux new -s stack -d
tmux send-keys -t stack:0 'cd ~/DATN_ver0 && make be' C-m
tmux new-window -t stack -n fe   -c ~/DATN_ver0/frontend
tmux send-keys  -t stack:fe   'npm start' C-m
tmux new-window -t stack -n caddy
tmux send-keys  -t stack:caddy 'caddy run --config ~/Caddyfile' C-m
tmux new-window -t stack -n ngrok
tmux send-keys  -t stack:ngrok 'ngrok http --url=https://ferris-smudgy-fondue.ngrok-free.dev 8080' C-m
tmux attach -t stack
```

Tmux nav: `Ctrl+B` rồi `0/1/2/3` chuyển window, `d` detach, `[` scroll log.

## Stop

```bash
tmux kill-session -t stack
# hoặc thủ công
pkill -f 'uvicorn endoscopy'; pkill -f next-server; pkill caddy; pkill ngrok
```

## Caddyfile

```caddy
:8080 {
    @backend path /ws/* /analytics/* /stream/* /upload* /library /library/* /sessions/* /session/* /pipeline/* /voice/* /health /health/* /config /config/* /system/* /memory/*
    reverse_proxy @backend 127.0.0.1:8001
    reverse_proxy 127.0.0.1:3000
}
```

**Lưu ý:** khi BE thêm endpoint mới, phải bổ sung vào `@backend path ...` rồi `caddy reload --config ~/Caddyfile`. Nếu endpoint không khớp pattern → request rơi vào FE Next.js → 404.

Reload không restart:

```bash
caddy reload --config ~/Caddyfile
```

## FE rebuild khi đổi BE URL

`NEXT_PUBLIC_API_BASE` bake vào client bundle tại build time. Đổi URL → rebuild:

```bash
cd ~/DATN_ver0/frontend
echo "NEXT_PUBLIC_API_BASE=https://<new-domain>" > .env.local
npm run build && npm start
```

## Verify

```bash
ss -tln | grep -E ':(8001|3000|8080)'                    # 3 LISTEN
curl -i http://localhost:8080/health                     # 200 từ BE qua Caddy
curl -I https://ferris-smudgy-fondue.ngrok-free.dev/     # 200 từ public
```
