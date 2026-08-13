import os
import io
import base64
from flask import Flask, request, jsonify
from PIL import Image
from llama_cpp import Llama
from llama_cpp.llama_chat_format import Qwen25VLChatHandler
import easyocr  # Replaced PaddleOCR with EasyOCR
import logging

# --- Constants ---
QWEN_MODEL_PATH = os.path.join(os.path.dirname(__file__), "models", "QWEN", "Qwen2-VL-2B-Instruct-IQ2_M.gguf")
MMPROJ_MODEL_PATH = os.path.join(os.path.dirname(__file__), "models", "QWEN", "mmproj-Qwen2-VL-2B-Instruct-f16.gguf")

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# --- Flask App ---
app = Flask(__name__)

# Disable debug mode for production-like setup
app.config['DEBUG'] = False
app.config['TESTING'] = False

# Global model instance (loaded once)
model = None

def check_gpu_availability():
    """Check if CUDA/GPU is available"""
    try:
        import subprocess
        result = subprocess.run(['nvidia-smi'], capture_output=True, text=True)
        if result.returncode == 0:
            logger.info("NVIDIA GPU detected")
            return True
        else:
            logger.warning("nvidia-smi failed, GPU may not be available")
            return False
    except FileNotFoundError:
        logger.warning("nvidia-smi not found, assuming no GPU available")
        return False

def load_model():
    """Load the Qwen2-VL model with multimodal projection and proper GPU utilization"""
    global model
    if model is None:
        gpu_available = check_gpu_availability()
        
        try:
            # Initialize the chat handler for Qwen2-VL
            chat_handler = Qwen25VLChatHandler(
                clip_model_path=MMPROJ_MODEL_PATH,
                verbose=False  # Reduce verbose output
            )
            
            # Configure model parameters for optimal GPU usage
            model_params = {
                "model_path": QWEN_MODEL_PATH,
                "chat_handler": chat_handler,
                "n_ctx": 32768,  # Use full model capacity
                "verbose": False,
                "seed": 42,
                "use_mmap": True,  # Memory mapping for efficiency
                "use_mlock": True,  # Lock memory pages
            }
            
            if gpu_available:
                # GPU-specific parameters
                model_params.update({
                    "n_gpu_layers": -1,  # Use all GPU layers
                    "main_gpu": 0,  # Use first GPU
                    "tensor_split": None,  # Let llama.cpp handle tensor distribution
                    "rope_scaling_type": -1,  # Auto rope scaling
                    "rope_freq_base": 0.0,  # Auto frequency base
                    "offload_kqv": True,  # Offload KV cache to GPU
                    "flash_attn": False,  # Disable flash attention (can cause issues with some setups)
                    "n_batch": 512,  # Batch size for GPU
                    "n_ubatch": 128,  # Micro batch size
                })
                logger.info("Configuring model for GPU acceleration...")
            else:
                # CPU-only parameters
                model_params.update({
                    "n_threads": os.cpu_count(),  # Use all CPU cores
                    "n_batch": 128,  # Smaller batch for CPU
                })
                logger.info("Configuring model for CPU-only execution...")
            
            # Load the model
            model = Llama(**model_params)
            
            # Verify GPU usage
            if gpu_available:
                logger.info("Model loaded - attempting to verify GPU usage...")
                # You can add a simple test here if needed
            
            logger.info(f"Qwen2-VL model loaded successfully ({'GPU' if gpu_available else 'CPU'} mode)")
            
        except Exception as e:
            logger.error(f"Error loading model with optimal settings: {e}")
            
            # Minimal fallback configuration
            try:
                logger.info("Attempting fallback configuration...")
                chat_handler = Qwen25VLChatHandler(
                    clip_model_path=MMPROJ_MODEL_PATH,
                    verbose=False
                )
                model = Llama(
                    model_path=QWEN_MODEL_PATH,
                    chat_handler=chat_handler,
                    n_ctx=8192,  # Reduced context as fallback
                    verbose=False
                )
                logger.info("Model loaded with fallback configuration")
            except Exception as e2:
                logger.error(f"Fallback configuration also failed: {e2}")
                raise e2
    return model

def image_to_base64(image):
    """Convert PIL Image to base64 string with optimization"""
    # Resize image if too large (optimal for Qwen2-VL)
    max_size = (896, 896)  # Qwen2-VL optimal size
    if image.size[0] > max_size[0] or image.size[1] > max_size[1]:
        image.thumbnail(max_size, Image.Resampling.LANCZOS)
        logger.info(f"Image resized to: {image.size}")
    
    # Ensure RGB format
    if image.mode != 'RGB':
        image = image.convert('RGB')
    
    buffered = io.BytesIO()
    image.save(buffered, format="JPEG", quality=95, optimize=True)
    img_str = base64.b64encode(buffered.getvalue()).decode()
    return f"data:image/jpeg;base64,{img_str}"

def generate_image_caption(image, prompt="What is the text in this image? then, Describe this image in detail."):
    """Generate caption for the given image"""
    try:
        # Load model if not already loaded
        llm = load_model()
        
        # Convert image to base64
        image_data = image_to_base64(image)
        
        # Create messages in the format expected by Qwen2-VL
        messages = [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {
                        "type": "image_url",
                        "image_url": {"url": image_data}
                    }
                ]
            }
        ]
        
        logger.info(f"Generating caption with prompt: {prompt}")
        
        # Generate response with optimized parameters
        response = llm.create_chat_completion(
            messages=messages,
            max_tokens=1024,
            temperature=0.4,  # Balanced creativity and consistency
            top_p=0.85,
            top_k=50,
            repeat_penalty=1.05,
            presence_penalty=0.1,
            frequency_penalty=0.1,
            stop=["<|im_end|>", "<|endoftext|>", "\n\n\n"]  # Better stop tokens
        )
        
        # Extract the generated text
        caption = response['choices'][0]['message']['content']
        
        # Handle empty responses with retry logic
        if not caption or caption.strip() == "":
            logger.warning("Empty caption received, trying with simpler prompt...")
            
            # Try with different prompts
            retry_prompts = [
                "What objects and details can you see in this image?",
                "Analyze this image and describe what you observe.",
                "What is shown in this picture?"
            ]
            
            for retry_prompt in retry_prompts:
                messages[0]["content"][0]["text"] = retry_prompt
                
                response = llm.create_chat_completion(
                    messages=messages,
                    max_tokens=512,
                    temperature=0.6,
                    top_p=0.9,
                    repeat_penalty=1.1,
                    stop=["<|im_end|>", "<|endoftext|>"]
                )
                
                caption = response['choices'][0]['message']['content']
                if caption and caption.strip():
                    logger.info(f"Success with retry prompt: {retry_prompt}")
                    break
            
        result = caption.strip() if caption else "Unable to generate a description for this image."
        logger.info(f"Generated caption length: {len(result)} characters")
        return result
        
    except Exception as e:
        logger.error(f"Error generating caption: {e}")
        raise e

def generate_image_ocr_qwen(image):
    """Extract text from image using Qwen2-VL (OCR)"""
    llm = load_model()
    image_data = image_to_base64(image)
    messages = [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "Read all visible text in this image. Output only the text, in its original language."},
                {"type": "image_url", "image_url": {"url": image_data}}
            ]
        }
    ]
    logger.info("Generating OCR text from image using Qwen2-VL...")
    response = llm.create_chat_completion(
        messages=messages,
        max_tokens=512,
        temperature=0.0,
        stop=["<|im_end|>", "<|endoftext|>", "\n\n\n"]
    )
    ocr_text = response['choices'][0]['message']['content']
    return ocr_text.strip() if ocr_text else ""

def generate_image_ocr_arabic(image):
    """Extract Arabic text from image using EasyOCR"""
    logger.info("Generating OCR text from image using EasyOCR (Arabic)...")
    reader = easyocr.Reader(['ar'])
    # Convert PIL Image to numpy array for EasyOCR
    import numpy as np
    img_array = np.array(image)
    result = reader.readtext(img_array)
    lines = [item[1] for item in result]
    return "\n".join(lines)

@app.route("/caption", methods=["POST"])
def caption():
    """Handle image captioning requests"""
    if 'file' not in request.files:
        return jsonify(error="No image uploaded"), 400

    img_file = request.files['file']
    if img_file.filename == '':
        return jsonify(error="No file selected"), 400

    try:
        img = Image.open(img_file.stream).convert("RGB")
        prompt = request.form.get('prompt', 'Describe this image in detail.')
        use_arabic_ocr = request.form.get('ar', 'False').lower() == 'true'

        # OCR step
        if use_arabic_ocr:
            ocr_text = generate_image_ocr_arabic(img)
        else:
            ocr_text = generate_image_ocr_qwen(img)

        # Caption step (always uses Qwen)
        caption_text = generate_image_caption(img, prompt)

        return jsonify({
            'ocr': ocr_text,
            'caption': caption_text,
            'model': 'Qwen2-VL-2B-Instruct',
            'status': 'success'
        })
    except Exception as e:
        print(f"Error processing request: {e}")
        return jsonify(
            error="Failed to process image", 
            details=str(e)
        ), 500

if __name__ == "__main__":
    logger.info("Starting Qwen2-VL Flask server...")
    logger.info(f"Model path: {QWEN_MODEL_PATH}")
    logger.info(f"MMProj path: {MMPROJ_MODEL_PATH}")
    
    # Verify files exist
    if not os.path.exists(QWEN_MODEL_PATH):
        logger.error(f"Model file not found at {QWEN_MODEL_PATH}")
        exit(1)
    if not os.path.exists(MMPROJ_MODEL_PATH):
        logger.error(f"MMProj file not found at {MMPROJ_MODEL_PATH}")
        exit(1)
    
    # Check GPU availability
    gpu_status = "available" if check_gpu_availability() else "not available"
    logger.info(f"GPU status: {gpu_status}")
    
    # Production-ready server configuration
    app.run(
        host="0.0.0.0", 
        port=5000, 
        debug=False,  # Disable debug mode
        threaded=True,  # Enable threading for better performance
        use_reloader=False  # Disable auto-reloader in production
    )