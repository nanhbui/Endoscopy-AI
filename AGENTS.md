<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan at:
specs/004-chatbot-llm-enhancement/plan.md
<!-- SPECKIT END -->

## Deployment — server4 qua ngrok

Public URL: **https://ferris-smudgy-fondue.ngrok-free.dev**

Stack: BE (uvicorn :8001) + FE (next dev :3000) + Caddy reverse proxy (:8080) + ngrok tunnel. Chạy native trên server4 (`emie@10.8.0.7`), không docker. Full doc: [docs/deployment-ngrok.md](docs/deployment-ngrok.md).

### Lifecycle (chạy từ laptop, cần VPN)

```bash
make remote-stack-up         # start all 4 services
make remote-stack-down       # stop all
make remote-stack-status     # ports + processes đang chạy
```

Tương đương SSH thủ công: `~/start-stack.sh` / `~/stop-stack.sh` trên server4.

### Lấy log khi có lỗi (không cần biết tmux/SSH)

Log file ở `~/logs/{be,fe,caddy,ngrok}.log` trên server4. Stream từ laptop:

```bash
make remote-log-be       # uvicorn stdout + traceback
make remote-log-fe       # next dev / HMR errors
make remote-log-caddy    # reverse proxy
make remote-log-ngrok    # tunnel status
```

Ctrl-C để dừng tail. SSH thủ công: `ssh emie@10.8.0.7 'tail -f ~/logs/be.log'`.

### Reload dynamic — sửa local → tự push → tự reload server

1 lệnh, chạy ở terminal riêng trên laptop:

```bash
make sync-watch
```

Vòng đời:
- `inotifywait` watch `src/` + `frontend/` ở laptop
- Mỗi save → `rsync` đẩy diff sang server4 (~100ms)
- BE: `uvicorn --reload` auto-detect `.py` change → reload trong 1-2s
- FE: `next dev` HMR auto-detect `.tsx`/`.ts` → patch component, giữ state

Yêu cầu một lần: `sudo apt install inotify-tools` trên laptop.

Không cần sync-watch cho mọi việc — sửa nhanh có thể `make sync-fast` 1 nhát.

### Troubleshoot nhanh

| Triệu chứng | Lệnh check | Fix thường gặp |
|---|---|---|
| Public URL 502 | `make remote-stack-status` | Service nào trống → `make remote-log-<svc>` đọc lỗi |
| FE không reload sau khi sync | `make remote-log-fe` | Restart FE: `make remote-stack-down && make remote-stack-up` |
| `make sync-watch` chạy nhưng không sync | Test 1 nhát: `make sync-fast` | VPN xuống → `make vpn-up` |
| BE reload fail (Python syntax) | `make remote-log-be` | Đọc traceback, sửa file local, save → auto re-sync |
| ngrok đổi URL hoặc auth fail | `make remote-log-ngrok` | Domain đã hard-code; auth issue: re-add token trên server4 |

### Đổi BE URL → phải rebuild FE

`NEXT_PUBLIC_API_BASE` bake vào client bundle. Nếu ngrok domain đổi:

```bash
# trên laptop
echo "NEXT_PUBLIC_API_BASE=https://<new>.ngrok-free.dev" > frontend/.env.local
make sync-fast
ssh emie@10.8.0.7 'cd ~/DATN_ver0/frontend && npm run build && bash ~/start-stack.sh'
```
