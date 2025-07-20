import os
import torch
from transformers import AutoProcessor, AutoModelForImageTextToText
from PIL import Image
import re
import cv2  # Add OpenCV for video frame extraction

from nlp_utils import is_document, detect_ocr, extract_keywords_from_caption

# --- Model and Processor Initialization ---
BASE_DIR = os.path.abspath(os.path.dirname(__file__))
SMOLVLM2_PATH = os.path.join(BASE_DIR, "models", "SmolVLM2")
QWEN_PATH = os.path.join(BASE_DIR, "models", "QWEN", "Qwen2-VL-2B-Instruct-IQ2_M.gguf")

# --- Qwen Model Loader ---
qwen_model = None
qwen_processor = None

def load_qwen_model():
    global qwen_model, qwen_processor
    try:
        from llama_cpp import Llama
        qwen_model = Llama(
            model_path=QWEN_PATH,
            n_ctx=2048,
            n_threads=4,
            verbose=False
        )
        # Qwen does not use a processor like transformers, so we set it to None
        qwen_processor = None
    except Exception as e:
        print(f"FATAL: Could not load Qwen model from {QWEN_PATH}. Error: {e}")
        qwen_model, qwen_processor = None, None

# --- SmolVLM2 Model Loader ---
smol_model = None
smol_processor = None
smol_device = None
smol_dtype = None

def load_smolvlm2_model():
    global smol_model, smol_processor, smol_device, smol_dtype
    try:
        smol_processor = AutoProcessor.from_pretrained(SMOLVLM2_PATH)
        smol_device = "cuda" if torch.cuda.is_available() else "cpu"
        smol_dtype = torch.bfloat16 if torch.cuda.is_available() else torch.float32
        smol_model = AutoModelForImageTextToText.from_pretrained(
            SMOLVLM2_PATH, torch_dtype=smol_dtype
        ).to(smol_device)
        smol_model.eval()
    except Exception as e:
        print(f"FATAL: Could not load model from {SMOLVLM2_PATH}. Error: {e}")
        smol_processor, smol_model, smol_device, smol_dtype = None, None, None, None

# --- Model Selection ---
def get_model(use_qwen: bool):
    if use_qwen:
        if qwen_model is None:
            load_qwen_model()
        return qwen_model, qwen_processor, None, None, "qwen"
    else:
        if smol_model is None:
            load_smolvlm2_model()
        return smol_model, smol_processor, smol_device, smol_dtype, "smolvlm2"

def extract_middle_frame(video_path: str) -> Image.Image:
    """
    Extracts the middle frame from a video file and returns it as a PIL Image.
    """
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open video file: {video_path}")
    frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    middle_frame_idx = frame_count // 2
    cap.set(cv2.CAP_PROP_POS_FRAMES, middle_frame_idx)
    ret, frame = cap.read()
    cap.release()
    if not ret:
        raise RuntimeError("Failed to read frame from video.")
    frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    return Image.fromarray(frame_rgb)

def generate_image_name(model, processor, device, dtype, img_or_path, model_type="smolvlm2", return_info=False) -> str:
    """
    Generates a descriptive name for an image or video using a vision-language model.
    Supports both SmolVLM2 (transformers) and Qwen (llama-cpp).

    Args:
        model: The loaded transformer model.
        processor: The model's processor.
        device: The torch device ('cuda' or 'cpu').
        dtype: The torch dtype.
        img_or_path: A PIL Image object or a video file path.
        model_type: The type of model to use ('smolvlm2' or 'qwen').
        return_info: If True, returns (name, info_dict) with info about OCR/model used.

    Returns:
        A descriptive name for the image or video, and optionally info dict.
    """
    import inspect
    # Check if caller wants info
    frame = inspect.currentframe()
    caller = inspect.getouterframes(frame, 2)[1].function
    return_info = False
    if 'return_info' in inspect.getargvalues(frame).locals:
        return_info = inspect.getargvalues(frame).locals['return_info']
    info = {'ocr_used': False, 'model': model_type}
    if model_type == "qwen":
        # Only image input supported for Qwen
        if isinstance(img_or_path, str) and os.path.splitext(img_or_path)[1].lower() in ('.mp4', '.avi', '.mov', '.mkv', '.webm'):
            img = extract_middle_frame(img_or_path)
            is_video = True
        else:
            img = img_or_path
            is_video = False

        # Resize image if needed
        max_dim = 1024
        if max(img.size) > max_dim:
            img.thumbnail((max_dim, max_dim), Image.LANCZOS)

        # Qwen prompt (always image, never video)
        prompt = "Provide a short, descriptive title for this image (Title:), then briefly summarize its content (Summary:)."
        if is_document(img):
            prompt += " The image appears to be a document; mention any visible text, layout, and language."

        # Convert PIL image to PNG bytes (always RGB)
        import io
        img_rgb = img.convert("RGB")
        img_bytes_io = io.BytesIO()
        img_rgb.save(img_bytes_io, format="PNG")
        img_bytes = img_bytes_io.getvalue()

        # Qwen inference (image embedding + prompt)
        try:
            output = model.create_chat_completion(
                messages=[
                    {"role": "system", "content": "You are a helpful assistant."},
                    {"role": "user", "content": prompt, "images": [img_bytes]}
                ],
                max_tokens=128,
                temperature=0.2
            )
            raw_output = output['choices'][0]['message']['content']
        except Exception as e:
            raw_output = ""

        # Output parsing and filtering (match SMOLVLM2)
        cleaned_output = raw_output.replace(prompt, '').split('Assistant:')[-1].strip()
        # Remove leading/trailing quotes
        cleaned_output = cleaned_output.strip('"')
        title_match = re.search(r"Title:(.*?)(Summary:|$)", cleaned_output, re.IGNORECASE | re.DOTALL)
        summary_match = re.search(r"Summary:(.*)", cleaned_output, re.IGNORECASE | re.DOTALL)

        title = title_match.group(1).strip().strip('"') if title_match else ""
        summary = summary_match.group(1).strip().strip('"') if summary_match else cleaned_output

        # OCR and keyword extraction (identical to SMOLVLM2)
        ocr_text, _ = detect_ocr(img)
        model_keywords = extract_keywords_from_caption(summary)
        ocr_words = set(re.findall(r"\b[\w-]{3,}\b", ocr_text.lower()))
        filtered_keywords = [kw for kw in model_keywords if kw.lower() not in ocr_words]

        # Name generation logic (identical to SMOLVLM2)
        # 1. Prioritize the generated Title if it's descriptive (not just one word, not empty, not generic)
        if title and len(title.split()) > 1 and title.lower() not in {"untitled", "image", "photo", "picture"}:
            if return_info:
                return title, info
            return title

        # 2. Fallback to OCR text if available
        if ocr_text:
            info['ocr_used'] = True
            name_parts = [ocr_text.strip()]
            name_parts.extend(w.capitalize() for w in filtered_keywords[:5])
            if return_info:
                return " ".join(name_parts), info
            return " ".join(name_parts)

        # 3. Use filtered keywords if no OCR text
        if filtered_keywords:
            if return_info:
                return " ".join(w.capitalize() for w in filtered_keywords[:10]), info
            return " ".join(w.capitalize() for w in filtered_keywords[:10])

        # 4. As a last resort, use the raw summary or a default name
        if summary:
            if return_info:
                return " ".join(summary.split()[:10]).capitalize(), info
            return " ".join(summary.split()[:10]).capitalize()

        if return_info:
            return ("Untitled Image"), info
        return "Untitled Image"

    else:
        if not model or not processor:
            raise RuntimeError("Model or processor is not initialized.")

        # --- Handle video input ---
        if isinstance(img_or_path, str) and os.path.splitext(img_or_path)[1].lower() in ('.mp4', '.avi', '.mov', '.mkv', '.webm'):
            img = extract_middle_frame(img_or_path)
            is_video = True
        else:
            img = img_or_path
            is_video = False

        # --- Image Preprocessing ---
        max_dim = 1024
        if max(img.size) > max_dim:
            img.thumbnail((max_dim, max_dim), Image.LANCZOS)

        # --- Prompt Engineering ---
        base_prompt = "<image> Provide a short, descriptive title for this image (Title:), then briefly summarize its content (Summary:)."
        if is_video:
            base_prompt = "<image> Provide a short, descriptive title for this video (Title:), then briefly summarize its content (Summary:)."
        if is_document(img):
            prompt = base_prompt + " The image appears to be a document; mention any visible text, layout, and language."
        else:
            prompt = base_prompt

        # --- Model Inference ---
        inputs = processor(images=img, text=prompt, return_tensors='pt').to(device, dtype=dtype)
        with torch.no_grad():
            gen_ids = model.generate(**inputs, do_sample=False, max_new_tokens=128)
        raw_output = processor.batch_decode(gen_ids, skip_special_tokens=True)[0]

        # --- Output Parsing and Cleaning ---
        cleaned_output = raw_output.replace(prompt, '').split('Assistant:')[-1].strip()
        title_match = re.search(r"Title:(.*?)(Summary:|$)", cleaned_output, re.IGNORECASE | re.DOTALL)
        summary_match = re.search(r"Summary:(.*)", cleaned_output, re.IGNORECASE | re.DOTALL)

        title = title_match.group(1).strip() if title_match else ""
        summary = summary_match.group(1).strip() if summary_match else cleaned_output

        # --- OCR and Keyword Extraction ---
        ocr_text, _ = detect_ocr(img)
        model_keywords = extract_keywords_from_caption(summary)

        ocr_words = set(re.findall(r"\b[\w-]{3,}\b", ocr_text.lower()))

        filtered_keywords = [kw for kw in model_keywords if kw.lower() not in ocr_words]

        # --- Name Generation Logic ---
        # 1. Prioritize the generated Title if it's descriptive
        if title and len(title.split()) > 1:
            if return_info:
                return title, info
            return title

        # 2. Fallback to OCR text if available
        if ocr_text:
            info['ocr_used'] = True
            name_parts = [ocr_text.strip()]
            # Add a few non-OCR keywords for context
            name_parts.extend(w.capitalize() for w in filtered_keywords[:5])
            if return_info:
                return " ".join(name_parts), info
            return " ".join(name_parts)

        # 3. Use filtered keywords if no OCR text
        if filtered_keywords:
            if return_info:
                return " ".join(w.capitalize() for w in filtered_keywords[:10]), info
            return " ".join(w.capitalize() for w in filtered_keywords[:10])
            
        # 4. As a last resort, use the raw summary or a default name
        if summary:
            # Create a name from the first few words of the summary
            if return_info:
                return " ".join(summary.split()[:10]).capitalize(), info
            return " ".join(summary.split()[:10]).capitalize()
            
        if return_info:
            return ("Untitled Video" if is_video else "Untitled Image"), info
        return "Untitled Video" if is_video else "Untitled Image"