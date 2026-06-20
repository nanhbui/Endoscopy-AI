# Lệnh deploy server4 — cheatsheet

Public URL: **https://server4.tail145f3.ts.net**

**2 nơi chạy lệnh:**
- 💻 **[LOCAL]** = máy của bạn (nơi có code + `make`). Chỉ `make sync` chạy ở đây.
- 🖥️ **[SERVER]** = trên server4, tức **sau khi** `ssh emie@10.8.0.7`.

> ⚠️ **KHÔNG dùng `make be` / `npm run dev`** (dev mode → BE restart liên tục + chậm). Deploy luôn dùng `start-stack-prod.sh`.

---

## 1. Bật / restart cả stack (production)
🖥️ **[SERVER]**
```bash
ssh emie@10.8.0.7
bash ~/start-stack-prod.sh
```
→ Chạy nền, tắt máy/đóng SSH vẫn sống. Funnel tự sống sẵn.

## 2. Cập nhật code mới lên deploy (ĐỦ 3 BƯỚC)
💻 **[LOCAL]** — đẩy code:
```bash
make sync
```
🖥️ **[SERVER]** — build + restart:
```bash
ssh emie@10.8.0.7
source ~/.nvm/nvm.sh
cd ~/DATN_ver0/frontend && npm run build     # BẮT BUỘC nếu đổi frontend
bash ~/start-stack-prod.sh
```
> Quên `npm run build` = FE chạy bản cũ. `make sync` KHÔNG đụng `.env` server.

## 3. Restart riêng BE (sau khi sửa code backend)
🖥️ **[SERVER]**
```bash
pkill -9 -f "uvicorn endoscopy"; sleep 2
bash ~/start-stack-prod.sh
```

## 4. Xem log
🖥️ **[SERVER]**
```bash
tail -f ~/logs/be.log        # backend (detect, report, lỗi)
tail -f ~/logs/fe.log        # frontend
tail -f ~/logs/caddy.log     # reverse proxy

# theo dõi BE có restart không (khi upload/test):
tail -f ~/logs/be.log | grep -E "Started server process|Shutting down"
# → KHÔNG hiện thêm dòng = ổn định. Hiện lặp lại = đang restart.
```

## 5. Kiểm tra đang chạy ĐÚNG production
🖥️ **[SERVER]**
```bash
pgrep -fa "uvicorn endoscopy" | grep -- "--reload" && echo "DEV ✗ (sai)" || echo "PRODUCTION ✓"
ss -tln | grep -E ':(8001|3000|8080)'    # 3 cổng listening
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8001/health   # 200
```

## 6. Kiểm tra đĩa (hay đầy — đĩa dùng chung)
🖥️ **[SERVER]**
```bash
df -h /              # / hay đầy
df -h /mnt/disk2     # data app ở đây (DB + uploads)
```

## 7. Tắt stack
🖥️ **[SERVER]**
```bash
pkill -9 -f "uvicorn endoscopy"; pkill -f "next start"; pkill -f "next-server"; pkill caddy
```

---

## Ghi nhớ nhanh
| Cần gì | Nơi | Lệnh |
|---|---|---|
| Bật/restart deploy | 🖥️ SERVER | `bash ~/start-stack-prod.sh` |
| Đẩy code | 💻 LOCAL | `make sync` |
| Build FE (sau sync) | 🖥️ SERVER | `npm run build` |
| Xem lỗi BE | 🖥️ SERVER | `tail -f ~/logs/be.log` |
| DB + uploads | 🖥️ SERVER | `/mnt/disk2/emie/endoscopy/` |

**Quy trình update chuẩn:** 💻 `make sync` → 🖥️ `npm run build` → 🖥️ `bash ~/start-stack-prod.sh`
**Sau reboot server4:** 🖥️ `bash ~/start-stack-prod.sh` (funnel tự sống).
