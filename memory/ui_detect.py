#!/usr/bin/env python3
"""
极简UI元素检测脚本 - 基于OmniParser的YOLO模型
依赖: ultralytics, rapidocr-onnxruntime, pillow, numpy
"""
import sys
from pathlib import Path
from ultralytics import YOLO
from PIL import Image, ImageDraw
import numpy as np

DEFAULT_MODEL = str(Path(__file__).resolve().parent.parent / 'temp' / 'weights' / 'icon_detect' / 'model.pt')

# 可选：使用rapidocr做OCR
try:
    from rapidocr_onnxruntime import RapidOCR
    ocr_engine = RapidOCR()
    HAS_OCR = True
except ImportError:
    HAS_OCR = False
    print("警告: rapidocr未安装，跳过OCR功能")

def detect_ui_elements(image_path, model_path=None, conf_threshold=0.25):
    model_path = model_path or DEFAULT_MODEL
    """检测UI元素并返回边界框"""
    # 加载模型
    model = YOLO(model_path)
    
    # 推理
    results = model(image_path, conf=conf_threshold, verbose=False)
    
    # 提取检测结果
    detections = []
    for result in results:
        boxes = result.boxes
        for box in boxes:
            x1, y1, x2, y2 = box.xyxy[0].cpu().numpy()
            conf = float(box.conf[0])
            cls = int(box.cls[0])
            detections.append({
                'bbox': [int(x1), int(y1), int(x2), int(y2)],
                'confidence': conf,
                'class': cls
            })
    
    return detections

def ocr_text(image_path):
    """OCR识别文本"""
    if not HAS_OCR:
        return []
    
    result, _ = ocr_engine(image_path)
    if not result:
        return []
    
    texts = []
    for item in result:
        bbox, text, conf = item
        texts.append({
            'text': text,
            'bbox': bbox,
            'confidence': conf
        })
    return texts

def visualize(image_path, detections, ocr_results=None, output_path=None):
    """可视化检测结果"""
    img = Image.open(image_path)
    draw = ImageDraw.Draw(img)
    
    # 画UI元素框（红色）
    for det in detections:
        x1, y1, x2, y2 = det['bbox']
        draw.rectangle([x1, y1, x2, y2], outline='red', width=2)
        draw.text((x1, y1-10), f"{det['confidence']:.2f}", fill='red')
    
    # 画OCR文本框（蓝色）
    if ocr_results:
        for ocr in ocr_results:
            bbox = ocr['bbox']
            points = [(bbox[i][0], bbox[i][1]) for i in range(4)]
            draw.polygon(points, outline='blue')
            draw.text((points[0][0], points[0][1]-10), ocr['text'][:10], fill='blue')
    
    if output_path:
        img.save(output_path)
    return img

def main():
    if len(sys.argv) < 2:
        print("用法: python ui_detect.py <图片路径> <模型路径> [输出路径]")
        print("示例: python ui_detect.py screenshot.png weights/icon_detect/model.pt output.png")
        sys.exit(1)
    
    image_path = sys.argv[1]
    model_path = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_MODEL
    output_path = sys.argv[3] if len(sys.argv) > 3 else "output.png"
    
    print(f"检测图片: {image_path}")
    print(f"使用模型: {model_path}")
    
    # UI元素检测
    print("\n[1/2] YOLO检测UI元素...")
    detections = detect_ui_elements(image_path, model_path)
    print(f"检测到 {len(detections)} 个UI元素")
    for i, det in enumerate(detections, 1):
        print(f"  {i}. bbox={det['bbox']}, conf={det['confidence']:.3f}")
    
    # OCR文本识别
    ocr_results = None
    if HAS_OCR:
        print("\n[2/2] OCR识别文本...")
        ocr_results = ocr_text(image_path)
        print(f"识别到 {len(ocr_results)} 个文本区域")
        for i, ocr in enumerate(ocr_results, 1):
            print(f"  {i}. text='{ocr['text']}', conf={ocr['confidence']:.3f}")
    
    # 可视化
    print(f"\n保存结果到: {output_path}")
    visualize(image_path, detections, ocr_results, output_path)
    
    # 输出JSON格式结果
    import json
    result = {
        'ui_elements': detections,
        'ocr_texts': ocr_results or []
    }
    json_path = output_path.replace('.png', '.json')
    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    print(f"JSON结果: {json_path}")

if __name__ == "__main__":
    main()
