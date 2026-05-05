# GastroEye Pipeline Analysis & Integration Plan

**Source**: `/home/nanhbui/Documents/DATN_ver0/sample_code/gastroeye/`
**Stack**: C++ + Qt + GStreamer + LibTorch
**Same model**: `best_train6.torchscript` (đúng model chúng ta đang dùng)

---

## 🎯 Tóm tắt 5 phát hiện then chốt

| # | Kỹ thuật | Tác động |
|---|----------|----------|
| 1 | **Activation matrix filter** (lesion × region) | Loại bỏ misclassification organ (gốc rễ vấn đề user complain) |
| 2 | **Region classifier** (model riêng) | Cung cấp ngữ cảnh giải phẫu thật, không đoán mò |
| 3 | **Per-class confidence threshold** `[0.65, 0.65, 0.9, 0.9, 0.65]` | Cancer high bar, viêm low bar — phù hợp y học |
| 4 | **Two-stage detection** (YOLO bbox → CLF head re-classify) | Tăng accuracy class label rõ rệt |
| 5 | **Uninformative frame skip** (Blur/Foam/Dark/Unknown) | Tự động bỏ qua frame không chẩn đoán được |

---

## 1. Kiến trúc 3 model (vs 1 model hiện tại)

### Sample sử dụng 3 model song song:

```
┌─────────────────────────────────────────────────────────────┐
│                    Frame nội soi                            │
└──────────────────┬──────────────────────────────┬───────────┘
                   ▼                              ▼
        ┌──────────────────────┐    ┌──────────────────────┐
        │  Region Classifier   │    │   Lesion Detector    │
        │  (MobileNetV3/Swin)  │    │   (YOLOv8 - same as  │
        │                      │    │    best_train6.pt)   │
        │  → 14 classes:       │    │                      │
        │  Unknown/Blur/Foam   │    │  → 5 lesion classes  │
        │  /Dark / 10 regions  │    │     + bbox + conf    │
        └────────────┬─────────┘    └──────────┬───────────┘
                     │                         │
                     ▼                         ▼
                ┌─────────────────────────────────┐
                │   Activation Matrix Filter      │
                │   (CSV: 5 × 14 bool table)      │
                │                                 │
                │   Drop nếu region không cho     │
                │   phép detect lesion class này  │
                └────────────┬────────────────────┘
                             ▼
                   ┌──────────────────────┐
                   │  NBI Generator       │ ← optional augment
                   │  (sub_mobile_resnet) │
                   └──────────────────────┘
```

### Models có sẵn trong `sample_code/gastroeye/models/`:

```
lesion_det/
├── 5Classes_Large/
│   ├── best_train6.torchscript   ← model chúng ta đang dùng
│   └── labels.txt
├── default/                       ← TWO-STAGE preset
│   ├── best.torchscript           (YOLO bbox proposer)
│   ├── clf_head_2.torchscript     (re-classifier head)
│   └── labels.txt
├── erosive_esophagitis/           ← organ-specific specialized models
├── hp_negative_gastritis/
├── hp_positive_gastritis/
├── esophageal_cancer/
├── gastric_cancer/
├── duodenal_ulcer/
├── legacy/
└── 5_classes_activation_rule.csv  ← KEY FILE

region_clf/
├── MBNet_Adam_Focal_5.torchscript  ← MobileNetV3 region classifier
├── res50_cbam.torchscript          ← ResNet50+CBAM (alternative)
├── Swin_Model_v3.torchscript       ← Swin transformer (heaviest, best acc)
├── labels.txt                      (14 regions)
├── uninformative_labels.txt        (4 noise: Unknown/Blur/Foam/Dark)
└── stomach_region_labels.txt       (10 anatomical regions)

nbi_gen/
└── sub_mobile_resnet_generator.torchscript  ← NBI augmentation
```

---

## 2. Activation Matrix — KEY INSIGHT

File: [`5_classes_activation_rule.csv`](sample_code/gastroeye/models/lesion_det/5_classes_activation_rule.csv)

```csv
,Unknown,Blur,Foam,Dark,Hầu họng,Thực quản,Tâm vị,Thân vị,Phình vị,Hang vị,Bờ cong lớn,Bờ cong nhỏ,Hành tá tràng,Tá tràng
Viêm thực quản,    0,1,0,1,1,1,1,0,0,0,0,0,0,0
Viêm dạ dày,       0,1,0,1,0,0,0,1,1,1,1,1,0,0
Ung thư thực quản, 0,1,0,1,1,1,1,0,0,0,0,0,0,0
Ung thư dạ dày,    0,1,0,1,0,0,0,1,1,1,1,1,0,0
Loét HTT,          0,1,0,1,0,0,0,0,0,0,0,0,1,1
```

**Quy tắc giải phẫu:**
- `1` = cho phép, `0` = chặn
- Viêm/ung thư **dạ dày** → chỉ cho phép khi region classifier xác định là một trong 5 vùng dạ dày
- Viêm/ung thư **thực quản** → chỉ cho phép trong 3 vùng thực quản
- Loét **HTT** → chỉ cho phép trong tá tràng
- `Unknown` & `Foam` luôn = 0 → frame không xác định / nhiều bọt → drop hết
- `Blur` & `Dark` cố tình = 1 cho mọi class → không gate vì chất lượng frame, để model tự quyết

**Logic apply** ([lesion_detection_filter.cpp:78-82](sample_code/gastroeye/src/app/dnn/lesion_detection_filter.cpp#L78)):
```cpp
bool is_valid(const Detection &lesion_det, const Classification &region_clf) const {
    return activation_matrix_accessor[lesion_label_map_(lesion_det.label_id)]
                                     [region_label_map_(region_clf.label_id)];
}
```

→ **Ngắn gọn**: detection được giữ chỉ khi `matrix[lesion_class][predicted_region] == true`.

**Tác động trực tiếp đến vấn đề chúng ta đang gặp:**
- Frame là thực quản → region classifier output "Thực quản"
- Lesion detector nhả "Viêm dạ dày HP" 65% conf
- Matrix lookup: `Viêm dạ dày[Thực quản] = 0` → **DROP** ✓
- → Triệt tiêu hoàn toàn trường hợp esophagus → "Viêm dạ dày HP" misclassification

---

## 3. Per-class confidence threshold

[`configs.yaml`](sample_code/gastroeye/resources/configs.yaml):
```yaml
yolo_options:
  score_threshold: [ 0.65, 0.65, 0.9, 0.9, 0.65 ]
  #               viêm  viêm  ung   ung   loét
  #               TQ    DD    TQ    DD    HTT
  nms_threshold: 0.45
```

Logic ([yolo.cpp:314-324](sample_code/gastroeye/src/dnn/ultralytics/yolo.cpp#L314)):
```cpp
// class-wise conf threshold
detections.erase(std::remove_if(detections.begin(), detections.end(),
    [filter_thresholds](const auto &det) {
        return det.confidence < filter_thresholds[det.label_id];
    }), detections.end());
```

**Lý do y học:**
| Class | Threshold | Lý do |
|-------|-----------|-------|
| Viêm thực quản | 0.65 | Viêm thường rõ, FP chấp nhận được |
| Viêm dạ dày HP | 0.65 | HP diffuse, model tự tin được |
| **Ung thư thực quản** | **0.9** | **FP cancer = bệnh nhân lo lắng/biopsy oan** |
| **Ung thư dạ dày** | **0.9** | **Tương tự** |
| Loét HTT | 0.65 | Loét visible, rõ ràng |

→ Pipeline ta hiện dùng `0.5` global → cancer detection bị FP nhiều.

---

## 4. Two-stage detection (preset `Default`)

```yaml
- Default (2-Stage):
    model_filepath: ../models/lesion_det/default/best.torchscript
    clf_head_model_filepath: ../models/lesion_det/default/clf_head_2.torchscript
```

**Pipeline 2 stage** ([lesion_detection_inference_worker.cpp:84-150](sample_code/gastroeye/src/app/dnn/lesion_detection_inference_worker.cpp#L84)):

1. YOLO chạy với conf threshold thấp (0.65) → propose bbox candidates
2. Crop từng bbox → resize 224×224 → Normalize ImageNet
3. Feed crop vào `clf_head_2` (classifier nhỏ — ResNet/MobileNet) → re-classify class
4. Apply per-class threshold lần nữa trên class mới
5. → Detection có bbox (từ YOLO) + class chính xác hơn (từ CLF head)

**Lý do hoạt động:**
- YOLO end-to-end vừa localize vừa classify → phải compromise
- 2-stage: YOLO chỉ cần localize (dễ hơn), CLF head xem crop có ngữ cảnh gần → classify chính xác hơn
- Paper-grade approach (R-CNN style)

---

## 5. Region classifier specifics

[`region_classification_inference_worker.cpp`] — pipeline đơn giản:
- Input: full frame
- Resize 224×224 + ImageNet normalize
- Forward pass MobileNetV3
- Argmax → label index
- Map index → label name (1 trong 14)

**Models có sẵn (sắp xếp theo accuracy/cost):**
1. `MBNet_Adam_Focal_5.torchscript` — MobileNetV3 (lightweight, ~5ms/frame trên GPU)
2. `res50_cbam.torchscript` — ResNet50 + CBAM attention (medium, ~15ms)
3. `Swin_Model_v3.torchscript` — Swin Transformer (heavy, ~30ms, best acc)

---

## 6. Frame preprocessing chuẩn

[`yolo.cpp:260-269`](sample_code/gastroeye/src/dnn/ultralytics/yolo.cpp#L260):
```cpp
auto scaled_input = transforms::functional::letterbox(
    input, options_.input_shape(),       // 640×640
    options_.align_center(),             // center the image
    cv::Scalar(117, 117, 117));          // gray padding (NOT black!)

auto input_tensor = ...
input_tensor = input_tensor.to(device, dtype).div_(255);
return input_tensor.permute({2, 0, 1}).unsqueeze_(0);  // BCHW, batch=1
```

**Note:** padding = `(117, 117, 117)` (gray) — chuẩn của Ultralytics để không tạo edge giả.

---

## 7. Khuyến nghị áp dụng vào pipeline ta

### Phase 1: Quick wins (1-2 giờ, low risk)

#### 1.1. Per-class confidence threshold
File: [`pipeline_controller.py`]
```python
# Thay CONFIDENCE_THRESHOLD đơn lẻ bằng dict per-class:
CLASS_CONF_THRESHOLDS = {
    "Viêm thực quản":     float(_os.environ.get("CONF_TQ_VIEM", "0.65")),
    "Viêm dạ dày HP":     float(_os.environ.get("CONF_DD_HP",   "0.65")),
    "Ung thư thực quản":  float(_os.environ.get("CONF_TQ_UT",   "0.90")),  # cancer high bar
    "Ung thư dạ dày":     float(_os.environ.get("CONF_DD_UT",   "0.90")),
    "Loét hoành tá tràng":float(_os.environ.get("CONF_HTT",     "0.65")),
}
# Sau YOLO inference, drop detection nếu conf < CLASS_CONF_THRESHOLDS[label]
```

**Effect**: Giảm FP cancer ngay, không ảnh hưởng viêm/loét recall.

#### 1.2. Copy activation_rule.csv vào project

```bash
cp sample_code/gastroeye/models/lesion_det/5_classes_activation_rule.csv \
   models/activation_rule.csv
```

(Mới cần đến khi có region classifier — Phase 2)

### Phase 2: Region classifier integration (4-6 giờ)

#### 2.1. Load region classifier vào worker

```python
# Trong _pipeline_worker, sau khi load lesion model:
import torch
region_model = torch.jit.load(REGION_MODEL_PATH).eval().to(device)
with open(REGION_LABELS_PATH) as f:
    region_labels = [l.strip() for l in f if l.strip()]

def classify_region(frame_bgr):
    # Resize 224x224 + ImageNet normalize
    img = cv2.resize(frame_bgr, (224, 224))
    img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
    img = (img - [0.485, 0.456, 0.406]) / [0.229, 0.224, 0.225]
    tensor = torch.from_numpy(img).permute(2, 0, 1).unsqueeze(0).to(device, dtype)
    with torch.no_grad():
        out = region_model(tensor)
    return region_labels[out.argmax(1).item()]
```

#### 2.2. Activation matrix filter

```python
import csv as _csv
with open(ACTIVATION_RULE_PATH) as f:
    reader = list(_csv.reader(f))
header = reader[0][1:]   # 14 regions
rules = {}
for row in reader[1:]:
    lesion = row[0]
    rules[lesion] = {region: int(v) == 1 for region, v in zip(header, row[1:])}

def is_valid_detection(lesion_label, region_label):
    return rules.get(lesion_label, {}).get(region_label, False)
```

#### 2.3. Pipeline flow mới

```python
# Trong main loop, mỗi frame:
region = classify_region(frame_inf)
if region in UNINFORMATIVE_LABELS:  # Unknown/Blur/Foam/Dark
    frame_index += 1; continue          # skip non-diagnostic

results = lesion_model(frame_inf, ...)
for det in results.boxes:
    label = clean_label(model_names[det.cls])
    if not is_valid_detection(label, region):
        # log: "Suppressed {label} in {region} — anatomical mismatch"
        continue
    # ... tiếp tục pipeline cũ (tracker, dedup, send WS)
```

#### 2.4. Send region info qua WebSocket (replace location heuristic)

Trong [`ws-client.ts`]:
```typescript
export interface DetectionData {
  frame_index: number;
  timestamp_ms: number;
  region: string;     // ← real region từ classifier
  lesion: { ... };
  frame_b64?: string;
}
```

→ **Tự động khôi phục field "vị trí giải phẫu" mà ta vừa xóa**, nhưng lần này là REAL DATA (từ classifier model), không phải heuristic Y-axis.

### Phase 3: Two-stage detection (optional, 2-3 giờ)

Nếu Phase 1+2 chưa đủ accuracy:
1. Load `default/best.torchscript` (YOLO proposer) + `default/clf_head_2.torchscript` (re-classifier)
2. YOLO → bbox candidates
3. Crop bbox → resize 224×224 → ImageNet norm
4. Feed batch crops vào CLF head → predict class lại
5. Apply per-class conf threshold trên class mới

---

## 8. Đối chiếu pipeline hiện tại

| Aspect | Pipeline hiện tại | GastroEye | Ưu tiên áp dụng |
|--------|-------------------|-----------|-----------------|
| Conf threshold | `0.5` global | Per-class `[0.65, 0.65, 0.9, 0.9, 0.65]` | **HIGH** |
| Region context | Không có | Region classifier + activation matrix | **HIGH** |
| Frame quality skip | `_is_diagnostic_frame` heuristic | Region classifier output Unknown/Blur/Foam/Dark | MEDIUM |
| Detection localization | Single-stage YOLO | Two-stage (YOLO + CLF head) | MEDIUM |
| Vị trí giải phẫu | Heuristic Y-axis (đã xóa) | Real region classifier | **HIGH** (replace với real data) |
| Letterbox padding | Default Ultralytics | `(117, 117, 117)` gray | LOW (default đã OK) |
| Precision | FP32 default | FP32 (`torch.float32`) | ✓ Đã match |
| NMS threshold | Default 0.7 | 0.45 | LOW |
| NBI augmentation | Không có | NBI generator (optional) | LOW (nice-to-have) |

---

## 9. Kế hoạch thực hiện đề xuất

**Tuần 1**: Phase 1 (quick wins)
- [ ] Per-class confidence threshold (1h)
- [ ] Copy activation_rule.csv (5 phút)
- [ ] Test xem có giảm FP cancer không

**Tuần 1-2**: Phase 2 (region classifier — đáng làm nhất)
- [ ] Copy `MBNet_Adam_Focal_5.torchscript` + labels vào `models/`
- [ ] Implement `classify_region()` trong worker (1-2h)
- [ ] Implement activation matrix filter (1h)
- [ ] Add region info vào DetectionData payload (frontend type + UI)
- [ ] Test integration end-to-end

**Tuần 2-3**: Phase 3 (two-stage, optional)
- [ ] Eval Phase 1+2 accuracy trước
- [ ] Nếu chưa đủ → triển khai 2-stage

---

## 10. Câu hỏi chưa giải quyết

- Region classifier MobileNetV3 input size? (đoán 224×224 nhưng cần verify code C++)
- ImageNet mean/std normalize có đúng cho model này không, hay model dùng custom mean/std?
- TorchScript region model nhận tensor float32 trực tiếp, hay cần quantize?
- Activation matrix có nên cho `Blur=0, Dark=0` để siết chặt hơn (vs giữ `=1` như mặc định)?

→ Cần check trực tiếp `region_classification_inference_worker.cpp` để xác nhận preprocessing chính xác trước khi implement Python equivalent.
