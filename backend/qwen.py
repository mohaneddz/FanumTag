import os
import io
import base64
import time
import threading
import concurrent.futures
from typing import Dict, List, Tuple, Optional, Any
from flask import Flask, request, jsonify
from PIL import Image
import cv2
import numpy as np
from llama_cpp import Llama
from llama_cpp.llama_chat_format import Qwen25VLChatHandler
import easyocr
import logging
from pathlib import Path
import pymupdf as fitz  # Ensure PyMuPDF is used, not frontend/fitz
import tempfile

# --- Constants ---
QWEN_MODEL_PATH = os.path.join(os.path.dirname(__file__), "models", "QWEN", "Qwen2-VL-2B-Instruct-IQ2_M.gguf")
MMPROJ_MODEL_PATH = os.path.join(os.path.dirname(__file__), "models", "QWEN", "mmproj-Qwen2-VL-2B-Instruct-f16.gguf")

# Supported file types
SUPPORTED_IMAGE_TYPES = {'.jpg', '.jpeg', '.png', '.bmp', '.tiff', '.webp', '.gif'}
SUPPORTED_VIDEO_TYPES = {'.mp4', '.avi', '.mov', '.mkv', '.wmv', '.flv', '.webm'}
SUPPORTED_DOCUMENT_TYPES = {'.pdf', '.doc', '.docx', '.txt'}

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# --- Flask App ---
app = Flask(__name__)
app.config['DEBUG'] = False
app.config['TESTING'] = False
app.config['MAX_CONTENT_LENGTH'] = 100 * 1024 * 1024  # 100MB max file size

# Global instances
model = None
ocr_reader = None
model_lock = threading.Lock()
ocr_lock = threading.Lock()

class Timer:
    """Context manager for timing operations"""
    def __init__(self, name: str):
        self.name = name
        self.start_time = None
        self.end_time = None
        
    def __enter__(self):
        self.start_time = time.time()
        logger.info(f"Starting {self.name}")
        return self
        
    def __exit__(self, *args):
        self.end_time = time.time()
        duration = self.end_time - self.start_time
        logger.info(f"Completed {self.name} in {duration:.3f} seconds")
        
    @property
    def duration(self) -> float:
        if self.end_time and self.start_time:
            return self.end_time - self.start_time
        return 0.0

def check_gpu_availability() -> Tuple[bool, str]:
    """Check if CUDA/GPU is available and return detailed info"""
    try:
        import subprocess
        result = subprocess.run(['nvidia-smi', '--query-gpu=name,memory.total,utilization.gpu', '--format=csv,noheader,nounits'], 
                              capture_output=True, text=True, timeout=10)
        if result.returncode == 0:
            gpu_info = result.stdout.strip().split('\n')[0] if result.stdout.strip() else "Unknown GPU"
            logger.info(f"NVIDIA GPU detected: {gpu_info}")
            return True, gpu_info
        else:
            logger.warning("nvidia-smi failed, GPU may not be available")
            return False, "No GPU detected"
    except (FileNotFoundError, subprocess.TimeoutExpired):
        logger.warning("nvidia-smi not found or timeout, assuming no GPU available")
        return False, "No GPU detected"

def load_model():
    """Load the Qwen2-VL model with optimal GPU configuration"""
    global model
    if model is None:
        with model_lock:
            if model is None:  # Double-check pattern
                with Timer("Model Loading") as timer:
                    gpu_available, gpu_info = check_gpu_availability()
                    
                    try:
                        chat_handler = Qwen25VLChatHandler(
                            clip_model_path=MMPROJ_MODEL_PATH,
                            verbose=False
                        )
                        
                        model_params = {
                            "model_path": QWEN_MODEL_PATH,
                            "chat_handler": chat_handler,
                            "n_ctx": 32768,
                            "verbose": False,
                            "seed": 42,
                            "use_mmap": True,
                            "use_mlock": True,
                        }
                        
                        if gpu_available:
                            model_params.update({
                                "n_gpu_layers": -1,
                                "main_gpu": 0,
                                "offload_kqv": True,
                                "n_batch": 512,
                                "n_ubatch": 128,
                            })
                            logger.info(f"GPU Configuration: {gpu_info}")
                        else:
                            model_params.update({
                                "n_threads": os.cpu_count(),
                                "n_batch": 128,
                            })
                            logger.info("CPU-only configuration")
                        
                        model = Llama(**model_params)
                        logger.info(f"Model loaded successfully ({'GPU' if gpu_available else 'CPU'} mode) in {timer.duration:.3f}s")
                        
                    except Exception as e:
                        logger.error(f"Error loading model: {e}")
                        raise e
    return model

def load_ocr_reader():
    """Load EasyOCR reader with GPU support"""
    global ocr_reader
    if ocr_reader is None:
        with ocr_lock:
            if ocr_reader is None:  # Double-check pattern
                with Timer("OCR Reader Loading") as timer:
                    try:
                        # Check if CUDA is available for EasyOCR
                        import torch
                        gpu_available = torch.cuda.is_available()
                        device = 'cuda' if gpu_available else 'cpu'
                        
                        logger.info(f"Loading EasyOCR with device: {device}")
                        ocr_reader = easyocr.Reader(['ar', 'en'], gpu=gpu_available)
                        logger.info(f"EasyOCR loaded ({'GPU' if gpu_available else 'CPU'} mode) in {timer.duration:.3f}s")
                        
                    except Exception as e:
                        logger.error(f"Error loading OCR reader: {e}")
                        # Fallback to CPU
                        ocr_reader = easyocr.Reader(['ar', 'en'], gpu=False)
                        logger.info("EasyOCR loaded in CPU fallback mode")
    return ocr_reader

def image_to_base64(image: Image.Image) -> str:
    """Convert PIL Image to base64 string with optimization"""
    with Timer("Image to Base64 Conversion"):
        max_size = (896, 896)
        if image.size[0] > max_size[0] or image.size[1] > max_size[1]:
            image.thumbnail(max_size, Image.Resampling.LANCZOS)
            logger.info(f"Image resized to: {image.size}")
        
        if image.mode != 'RGB':
            image = image.convert('RGB')
        
        buffered = io.BytesIO()
        image.save(buffered, format="JPEG", quality=95, optimize=True)
        img_str = base64.b64encode(buffered.getvalue()).decode()
        return f"data:image/jpeg;base64,{img_str}"

def extract_keywords_and_describe(image: Image.Image, custom_prompt: str = None) -> Dict[str, Any]:
    """Generate keywords for filename and detailed description using Qwen2-VL"""
    with Timer("Qwen2-VL Processing") as timer:
        try:
            llm = load_model()
            image_data = image_to_base64(image)
            
            # First prompt for keywords
            keyword_prompt = ("Extract 3-5 TOP keywords from this image that would be suitable for a filename. "
                            "Output only the keywords separated by underscores, no other text. "
                            "Use English words only, be concise and descriptive.")
            
            # Second prompt for description
            desc_prompt = custom_prompt or "Describe this image in detail, including objects, colors, scene, and any text visible."
            
            # Process keywords
            messages_keywords = [{
                "role": "user",
                "content": [
                    {"type": "text", "text": keyword_prompt},
                    {"type": "image_url", "image_url": {"url": image_data}}
                ]
            }]
            
            logger.info("GPU Status: Generating keywords with Qwen2-VL on GPU" if check_gpu_availability()[0] else "CPU Status: Generating keywords with Qwen2-VL on CPU")
            
            keywords_response = llm.create_chat_completion(
                messages=messages_keywords,
                max_tokens=50,
                temperature=0.3,
                top_p=0.8,
                stop=["<|im_end|>", "<|endoftext|>", "\n"]
            )
            
            keywords = keywords_response['choices'][0]['message']['content'].strip()
            
            # Process description
            messages_desc = [{
                "role": "user",
                "content": [
                    {"type": "text", "text": desc_prompt},
                    {"type": "image_url", "image_url": {"url": image_data}}
                ]
            }]
            
            desc_response = llm.create_chat_completion(
                messages=messages_desc,
                max_tokens=1024,
                temperature=0.4,
                top_p=0.85,
                repeat_penalty=1.05,
                stop=["<|im_end|>", "<|endoftext|>", "\n\n\n"]
            )
            
            description = desc_response['choices'][0]['message']['content'].strip()
            
            return {
                'keywords': keywords,
                'description': description,
                'processing_time': timer.duration,
                'gpu_used': check_gpu_availability()[0]
            }
            
        except Exception as e:
            logger.error(f"Error in Qwen processing: {e}")
            raise e

def extract_text_ocr(image: Image.Image) -> Dict[str, Any]:
    """Extract text using EasyOCR"""
    with Timer("EasyOCR Processing") as timer:
        try:
            reader = load_ocr_reader()
            img_array = np.array(image)
            
            logger.info("GPU Status: Processing OCR with EasyOCR on GPU" if hasattr(reader, 'device') and 'cuda' in str(reader.device) else "CPU Status: Processing OCR with EasyOCR on CPU")
            
            result = reader.readtext(img_array)
            
            # Extract text and confidence scores
            extracted_text = []
            for item in result:
                bbox, text, confidence = item
                extracted_text.append({
                    'text': text,
                    'confidence': confidence,
                    'bbox': bbox
                })
            
            # Combine all text
            full_text = "\n".join([item['text'] for item in extracted_text])
            
            return {
                'text': full_text,
                'detailed_results': extracted_text,
                'processing_time': timer.duration,
                'gpu_used': hasattr(reader, 'device') and 'cuda' in str(reader.device)
            }
            
        except Exception as e:
            logger.error(f"Error in OCR processing: {e}")
            raise e

def extract_video_frames(video_path: str, num_frames: int = 4) -> List[Image.Image]:
    """Extract frames from video for processing"""
    with Timer(f"Video Frame Extraction ({num_frames} frames)"):
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            raise ValueError("Could not open video file")
        
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        frame_indices = np.linspace(0, total_frames - 1, num_frames, dtype=int)
        
        frames = []
        for idx in frame_indices:
            cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
            ret, frame = cap.read()
            if ret:
                # Convert BGR to RGB
                frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                pil_image = Image.fromarray(frame_rgb)
                frames.append(pil_image)
        
        cap.release()
        logger.info(f"Extracted {len(frames)} frames from video")
        return frames

def process_pdf_document(file_path: str) -> List[Image.Image]:
    """Convert PDF pages to images for processing"""
    with Timer("PDF to Images Conversion"):
        doc = fitz.open(file_path)
        images = []
        
        for page_num in range(len(doc)):
            page = doc.load_page(page_num)
            mat = fitz.Matrix(2.0, 2.0)  # High resolution
            pix = page.get_pixmap(matrix=mat)
            img_data = pix.tobytes("ppm")
            img = Image.open(io.BytesIO(img_data))
            images.append(img)
        
        doc.close()
        logger.info(f"Converted {len(images)} PDF pages to images")
        return images

def parallel_process_image(image: Image.Image, custom_prompt: str = None) -> Dict[str, Any]:
    """Process image with both Qwen and OCR in parallel"""
    total_timer = Timer("Total Parallel Processing")
    total_timer.__enter__()
    
    try:
        # Use ThreadPoolExecutor for parallel processing
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            # Submit both tasks
            qwen_future = executor.submit(extract_keywords_and_describe, image, custom_prompt)
            ocr_future = executor.submit(extract_text_ocr, image)
            
            # Wait for both to complete
            qwen_result = qwen_future.result()
            ocr_result = ocr_future.result()
        
        total_timer.__exit__(None, None, None)
        
        # Combine results
        return {
            'keywords': qwen_result['keywords'],
            'description': qwen_result['description'],
            'ocr_text': ocr_result['text'],
            'ocr_details': ocr_result['detailed_results'],
            'processing_times': {
                'qwen_processing': qwen_result['processing_time'],
                'ocr_processing': ocr_result['processing_time'],
                'total_processing': total_timer.duration
            },
            'gpu_usage': {
                'qwen_gpu': qwen_result['gpu_used'],
                'ocr_gpu': ocr_result['gpu_used']
            },
            'status': 'success'
        }
        
    except Exception as e:
        total_timer.__exit__(None, None, None)
        logger.error(f"Error in parallel processing: {e}")
        raise e

def get_file_type(filename: str) -> Tuple[str, str]:
    """Determine file type and category"""
    file_ext = Path(filename).suffix.lower()
    
    if file_ext in SUPPORTED_IMAGE_TYPES:
        return 'image', file_ext
    elif file_ext in SUPPORTED_VIDEO_TYPES:
        return 'video', file_ext
    elif file_ext in SUPPORTED_DOCUMENT_TYPES:
        return 'document', file_ext
    else:
        return 'unknown', file_ext

@app.route("/process", methods=["POST"])
def process_file():
    """Handle file processing requests for images, videos, and documents"""
    if 'file' not in request.files:
        return jsonify(error="No file uploaded"), 400

    uploaded_file = request.files['file']
    if uploaded_file.filename == '':
        return jsonify(error="No file selected"), 400

    file_type, file_ext = get_file_type(uploaded_file.filename)
    
    if file_type == 'unknown':
        return jsonify(error=f"Unsupported file type: {file_ext}"), 400

    try:
        custom_prompt = request.form.get('prompt', None)
        
        # Save uploaded file temporarily
        with tempfile.NamedTemporaryFile(delete=False, suffix=file_ext) as temp_file:
            uploaded_file.save(temp_file.name)
            temp_path = temp_file.name

        try:
            if file_type == 'image':
                # Process single image
                image = Image.open(temp_path).convert("RGB")
                result = parallel_process_image(image, custom_prompt)
                result['file_type'] = 'image'
                result['suggested_filename'] = f"{result['keywords']}{file_ext}"
                
            elif file_type == 'video':
                # Process video frames
                frames = extract_video_frames(temp_path, num_frames=4)
                
                # Process first frame with Qwen for description and keywords
                qwen_result = extract_keywords_and_describe(frames[0], custom_prompt)
                
                # Process all frames with OCR in parallel
                with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
                    ocr_futures = [executor.submit(extract_text_ocr, frame) for frame in frames]
                    ocr_results = [future.result() for future in ocr_futures]
                
                # Combine OCR results from all frames
                all_ocr_text = []
                total_ocr_time = 0
                for i, ocr_result in enumerate(ocr_results):
                    if ocr_result['text'].strip():
                        all_ocr_text.append(f"Frame {i+1}: {ocr_result['text']}")
                    total_ocr_time += ocr_result['processing_time']
                
                result = {
                    'keywords': qwen_result['keywords'],
                    'description': qwen_result['description'],
                    'ocr_text': "\n\n".join(all_ocr_text),
                    'frames_processed': len(frames),
                    'processing_times': {
                        'qwen_processing': qwen_result['processing_time'],
                        'ocr_processing': total_ocr_time,
                        'total_processing': qwen_result['processing_time'] + total_ocr_time
                    },
                    'gpu_usage': {
                        'qwen_gpu': qwen_result['gpu_used'],
                        'ocr_gpu': ocr_results[0]['gpu_used'] if ocr_results else False
                    },
                    'file_type': 'video',
                    'suggested_filename': f"{qwen_result['keywords']}{file_ext}",
                    'status': 'success'
                }
                
            elif file_type == 'document':
                # Process document (convert to images first)
                if file_ext == '.pdf':
                    images = process_pdf_document(temp_path)
                else:
                    return jsonify(error=f"Document type {file_ext} not yet supported"), 400
                
                # Process first page with Qwen for description and keywords
                qwen_result = extract_keywords_and_describe(images[0], custom_prompt)
                
                # Process all pages with OCR in parallel
                with concurrent.futures.ThreadPoolExecutor(max_workers=min(4, len(images))) as executor:
                    ocr_futures = [executor.submit(extract_text_ocr, img) for img in images]
                    ocr_results = [future.result() for future in ocr_futures]
                
                # Combine OCR results from all pages
                all_ocr_text = []
                total_ocr_time = 0
                for i, ocr_result in enumerate(ocr_results):
                    if ocr_result['text'].strip():
                        all_ocr_text.append(f"Page {i+1}: {ocr_result['text']}")
                    total_ocr_time += ocr_result['processing_time']
                
                result = {
                    'keywords': qwen_result['keywords'],
                    'description': qwen_result['description'],
                    'ocr_text': "\n\n".join(all_ocr_text),
                    'pages_processed': len(images),
                    'processing_times': {
                        'qwen_processing': qwen_result['processing_time'],
                        'ocr_processing': total_ocr_time,
                        'total_processing': qwen_result['processing_time'] + total_ocr_time
                    },
                    'gpu_usage': {
                        'qwen_gpu': qwen_result['gpu_used'],
                        'ocr_gpu': ocr_results[0]['gpu_used'] if ocr_results else False
                    },
                    'file_type': 'document',
                    'suggested_filename': f"{qwen_result['keywords']}{file_ext}",
                    'status': 'success'
                }
            
            # Add model information
            result['models_used'] = {
                'vision_model': 'Qwen2-VL-2B-Instruct',
                'ocr_model': 'EasyOCR (Arabic + English)'
            }
            
            return jsonify(result)
            
        finally:
            # Clean up temporary file
            try:
                os.unlink(temp_path)
            except OSError:
                pass
                
    except Exception as e:
        logger.error(f"Error processing file: {e}")
        return jsonify(
            error="Failed to process file", 
            details=str(e),
            file_type=file_type
        ), 500

@app.route("/caption", methods=["POST"])
def caption():
    """Handle image captioning requests (single image)"""
    if 'file' not in request.files:
        return jsonify(error="No image uploaded"), 400

    img_file = request.files['file']
    if img_file.filename == '':
        return jsonify(error="No file selected"), 400

    try:
        img = Image.open(img_file.stream).convert("RGB")
        prompt = request.form.get('prompt', 'Describe this image in detail.')

        # OCR step (always EasyOCR Arabic+English)
        ocr_result = extract_text_ocr(img)
        ocr_text = ocr_result['text']

        # Caption step (Qwen2-VL)
        caption_result = extract_keywords_and_describe(img, prompt)
        caption_text = caption_result['description']

        return jsonify({
            'ocr': ocr_text,
            'caption': caption_text,
            'model': 'Qwen2-VL-2B-Instruct',
            'status': 'success'
        })
    except Exception as e:
        logger.error(f"Error processing /caption request: {e}")
        return jsonify(
            error="Failed to process image",
            details=str(e)
        ), 500

@app.route("/health", methods=["GET"])
def health_check():
    """Health check endpoint"""
    gpu_available, gpu_info = check_gpu_availability()
    return jsonify({
        'status': 'healthy',
        'gpu_available': gpu_available,
        'gpu_info': gpu_info,
        'models_loaded': {
            'qwen': model is not None,
            'ocr': ocr_reader is not None
        }
    })

if __name__ == "__main__":
    logger.info("Starting Optimized Multi-Modal Processing Server...")
    logger.info(f"Qwen Model path: {QWEN_MODEL_PATH}")
    logger.info(f"MMProj path: {MMPROJ_MODEL_PATH}")
    
    # Verify files exist
    if not os.path.exists(QWEN_MODEL_PATH):
        logger.error(f"Model file not found at {QWEN_MODEL_PATH}")
        exit(1)
    if not os.path.exists(MMPROJ_MODEL_PATH):
        logger.error(f"MMProj file not found at {MMPROJ_MODEL_PATH}")
        exit(1)
    
    # Check GPU availability
    gpu_available, gpu_info = check_gpu_availability()
    logger.info(f"GPU Status: {gpu_info}")
    
    # Pre-load models (optional, for faster first request)
    logger.info("Pre-loading models...")
    try:
        load_model()
        load_ocr_reader()
        logger.info("Models pre-loaded successfully")
    except Exception as e:
        logger.warning(f"Model pre-loading failed, will load on first request: {e}")
    
    # Start server
    app.run(
        host="0.0.0.0", 
        port=5000, 
        debug=False,
        threaded=True,
        use_reloader=False
    )