#!/bin/bash
# Script tự động deploy, chạy và thu thập output từ GPU server
# Tác giả: Assistant
# Mục đích: Tự động hóa toàn bộ quá trình và thu thập output

set -e  # Dừng script nếu có lỗi

echo "🚀 Bắt đầu quá trình deploy và chạy LLaVA fine-tuning..."

# Hàm hiển thị thanh tiến trình
show_progress() {
    local total=100
    local current=$1
    local percent=$((current * 100 / total))
    local bar=$(printf "%0.s#" $(seq 1 $percent))
    printf "\r[%-100s] %d%% " "$bar" "$percent"
}

# Kiểm tra kết nối đến GPU server
echo "🔍 Kiểm tra kết nối đến GPU server (10.8.0.7)..."
if ! ping -c 1 10.8.0.7 &> /dev/null; then
    echo "❌ Không thể kết nối đến GPU server. Vui lòng kiểm tra VPN và kết nối mạng."
    exit 1
fi
echo "✅ GPU server online"

# Gửi file code đã được chuẩn bị từ trước
echo "📤 Đang gửi code lên GPU server..."
scp /tmp/llava_finetune_static/llava_finetune.tar.gz emie@10.8.0.7:/home/emie/ > /dev/null 2>&1
echo "✅ Đã gửi file lên server"

# Giải nén và cài đặt trên server
echo "🔧 Đang cài đặt môi trường trên server..."
ssh emie@10.8.0.7 "mkdir -p /home/emie/llava_finetune" > /dev/null 2>&1
ssh emie@10.8.0.7 "cd /home/emie/llava_finetune && tar -xzf /home/emie/llava_finetune.tar.gz" > /dev/null 2>&1

# Cài đặt thư viện cần thiết trên server
echo "🔧 Đang cài đặt thư viện cần thiết..."
ssh emie@10.8.0.7 "cd /home/emie/llava_finetune && pip install -r requirements.txt" > /dev/null 2>&1

# Chạy fine-tuning trên GPU và thu thập output
echo "⚡ Đang chạy fine-tuning trên GPU server..."
echo "📊 Output từ quá trình training:"

# Chạy training và theo dõi output real-time
ssh emie@10.8.0.7 "cd /home/emie/llava_finetune && python scripts/train_llava_lora.py" 2>&1 | while read line; do
    echo "  $line"
done

echo "✅ Hoàn thành! Quá trình fine-tuning đã chạy trên GPU server."
echo "💡 Để theo dõi tiến trình: ssh emie@10.8.0.7 'watch -n 1 nvidia-smi'"