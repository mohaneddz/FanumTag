from flask import Flask, request, jsonify
import time
import os
import cv2
import numpy as np
from PIL import Image
import torch
from transformers import NougatProcessor, VisionEncoderDecoderModel
from paddleocr import PaddleOCR
import easyocr
import tempfile
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)

# Global variables to store models (loaded once)
paddle_ocr = None
easy_ocr = None
nougat_processor = None
nougat_model = None

def initialize_models():
    """Initialize all OCR models with GPU support"""
    global paddle_ocr, easy_ocr, nougat_processor, nougat_model
    
    logger.info("Initializing models...")
    
    # Check GPU availability
    device = "cuda" if torch.cuda.is_available() else "cpu"
    logger.info(f"Using device: {device}")
    
    if not torch.cuda.is_available():
        logger.warning("CUDA not available! Models will run on CPU.")
    
    try:
        # Initialize PaddleOCR with Arabic support and GPU
        logger.info("Loading PaddleOCR...")
        paddle_ocr = PaddleOCR(
            # use_angle_cls=True,
            lang='ar',  # Arabic language
            # use_gpu=torch.cuda.is_available(),
            # gpu_mem=500,  # GPU memory allocation in MB
            # show_log=False
        )
        logger.info("PaddleOCR loaded successfully")
        
        # Initialize EasyOCR with Arabic support and GPU
        logger.info("Loading EasyOCR...")
        easy_ocr = easyocr.Reader(
            ['ar'],  # Arabic language
            gpu=torch.cuda.is_available(),
            verbose=False
        )
        logger.info("EasyOCR loaded successfully")
        
        # Initialize Nougat for Arabic from local folder
        logger.info("Loading Nougat model from local folder...")
        local_model_dir = os.path.join(os.path.dirname(__file__), "models", "arabic")
        nougat_processor = NougatProcessor.from_pretrained(local_model_dir)
        nougat_model = VisionEncoderDecoderModel.from_pretrained(local_model_dir)
        
        if torch.cuda.is_available():
            nougat_model = nougat_model.to(device)
            logger.info("Nougat model moved to GPU")
        
        logger.info("All models loaded successfully")
        
    except Exception as e:
        logger.error(f"Error initializing models: {str(e)}")
        raise

def process_with_paddle_ocr(image_path):
    """Process image with PaddleOCR"""
    try:
        start_time = time.time()
        result = paddle_ocr.ocr(image_path)  # Removed cls=True
        
        # Extract text from results
        text_lines = []
        if result and result[0]:
            for line in result[0]:
                if line and len(line) > 1:
                    text_lines.append(line[1][0])
        
        caption = ' '.join(text_lines) if text_lines else ""
        duration = time.time() - start_time
        
        return caption, duration
        
    except Exception as e:
        logger.error(f"PaddleOCR error: {str(e)}")
        return f"Error: {str(e)}", 0

def process_with_easy_ocr(image_path):
    """Process image with EasyOCR"""
    try:
        start_time = time.time()
        result = easy_ocr.readtext(image_path, detail=0)  # detail=0 returns only text
        
        caption = ' '.join(result) if result else ""
        duration = time.time() - start_time
        
        return caption, duration
        
    except Exception as e:
        logger.error(f"EasyOCR error: {str(e)}")
        return f"Error: {str(e)}", 0

def process_with_nougat(image_path):
    """Process image with Nougat"""
    try:
        start_time = time.time()
        
        # Load and preprocess image
        image = Image.open(image_path).convert('RGB')
        
        # Process with Nougat
        pixel_values = nougat_processor(image, return_tensors="pt").pixel_values
        
        if torch.cuda.is_available():
            pixel_values = pixel_values.to("cuda")
        
        # Generate text
        outputs = nougat_model.generate(
            pixel_values,
            max_length=512,
            early_stopping=True,
            pad_token_id=nougat_processor.tokenizer.pad_token_id,
            eos_token_id=nougat_processor.tokenizer.eos_token_id,
            use_cache=True,
            bad_words_ids=[[nougat_processor.tokenizer.unk_token_id]],
        )
        
        # Decode the generated text
        caption = nougat_processor.batch_decode(outputs, skip_special_tokens=True)[0]
        duration = time.time() - start_time
        
        return caption, duration
        
    except Exception as e:
        logger.error(f"Nougat error: {str(e)}")
        return f"Error: {str(e)}", 0

@app.route('/caption', methods=['POST'])
def caption_image():
    """Main endpoint to process image with all OCR models"""
    
    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400
    
    # Validate file type
    allowed_extensions = {'png', 'jpg', 'jpeg', 'gif', 'bmp', 'tiff', 'webp'}
    file_ext = file.filename.rsplit('.', 1)[1].lower() if '.' in file.filename else ''
    
    if file_ext not in allowed_extensions:
        return jsonify({'error': 'Invalid file type. Supported: png, jpg, jpeg, gif, bmp, tiff, webp'}), 400
    
    total_start_time = time.time()
    
    try:
        # Save uploaded file to temporary location
        with tempfile.NamedTemporaryFile(delete=False, suffix=f'.{file_ext}') as temp_file:
            file.save(temp_file.name)
            temp_file_path = temp_file.name
        
        logger.info(f"Processing image: {file.filename}")
        
        # Process with all three OCR models
        paddle_caption, paddle_duration = process_with_paddle_ocr(temp_file_path)
        easy_caption, easy_duration = process_with_easy_ocr(temp_file_path)
        nougat_caption, nougat_duration = process_with_nougat(temp_file_path)
        
        total_duration = time.time() - total_start_time
        
        # Clean up temporary file
        os.unlink(temp_file_path)
        
        # Prepare response
        response = {
            'PaddleOCR_caption': paddle_caption,
            'EasyOCR_caption': easy_caption,
            'NougatOCR_caption': nougat_caption,
            'total_duration': round(total_duration, 3),
            'individual_durations': {
                'PaddleOCR': round(paddle_duration, 3),
                'EasyOCR': round(easy_duration, 3),
                'NougatOCR': round(nougat_duration, 3)
            }
        }
        
        logger.info(f"Processing completed in {total_duration:.3f} seconds")
        return jsonify(response)
        
    except Exception as e:
        # Clean up temporary file if it exists
        if 'temp_file_path' in locals() and os.path.exists(temp_file_path):
            os.unlink(temp_file_path)
        
        logger.error(f"Error processing image: {str(e)}")
        return jsonify({'error': f'Internal server error: {str(e)}'}), 500

@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    gpu_available = torch.cuda.is_available()
    gpu_info = {}
    
    if gpu_available:
        gpu_info = {
            'gpu_count': torch.cuda.device_count(),
            'current_device': torch.cuda.current_device(),
            'gpu_name': torch.cuda.get_device_name(0) if torch.cuda.device_count() > 0 else 'Unknown'
        }
    
    return jsonify({
        'status': 'healthy',
        'models_loaded': {
            'PaddleOCR': paddle_ocr is not None,
            'EasyOCR': easy_ocr is not None,
            'Nougat': nougat_model is not None
        },
        'gpu_available': gpu_available,
        'gpu_info': gpu_info
    })

@app.errorhandler(413)
def too_large(e):
    return jsonify({'error': 'File too large'}), 413

if __name__ == '__main__':
    # Set maximum file size (16MB)
    app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024
    
    # Initialize models before starting the server
    try:
        initialize_models()
        logger.info("Server starting on port 5050...")
        app.run(host='0.0.0.0', port=5050, debug=False, threaded=True)
    except Exception as e:
        logger.error(f"Failed to start server: {str(e)}")
        exit(1)