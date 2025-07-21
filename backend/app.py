from flask import Flask, request, jsonify, Response, stream_with_context
from flask_cors import CORS
from werkzeug.exceptions import HTTPException
from PIL import Image
import os
import json

from model_utils import generate_image_name, get_model  # Remove processor, device, dtype
from nlp_utils import extract_text_file_keywords

# Base directory
BASE_DIR = os.path.abspath(os.path.dirname(__file__))

# Initialize Flask
app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}}, supports_credentials=True)

# Add global stop flag
stopd = False

@app.route("/caption", methods=["POST"])
def caption_image():
    """Endpoint to generate a name for a single uploaded image."""
    if 'file' not in request.files:
        return jsonify(error="No image uploaded"), 400

    img_file = request.files['file']
    qwen = request.form.get("qwen", "false").lower() == "true"
    try:
        img = Image.open(img_file).convert('RGB')
    except Exception as e:
        return jsonify(error="Invalid image format", details=str(e)), 400

    model, processor, device, dtype, model_type = get_model(qwen)
    result = generate_image_name(model, processor, device, dtype, img, model_type=model_type, return_info=True)
    if isinstance(result, tuple):
        name, info = result
        model_str = ""
        if info.get('ocr_used', False):
            model_str += "OCR + "
        model_str += "Qwen" if model_type == "qwen" else "SMOLVLM2"
        return jsonify({'name': name, 'model': model_str})
    else:
        return jsonify({'name': result, 'model': "Qwen" if model_type == "qwen" else "SMOLVLM2"})

def process_file(path, qwen=False):
    """
    Processes a single file from a given path, handling images, videos, and text files.
    Returns a name or an error string.
    """
    ext = os.path.splitext(path)[1].lower()
    if ext in ('.jpg', '.jpeg', '.png', '.bmp', '.gif', '.tiff', '.webp'):
        try:
            img = Image.open(path).convert('RGB')
            model, processor, device, dtype, model_type = get_model(qwen)
            name = generate_image_name(model, processor, device, dtype, img, model_type=model_type)
            return name, None
        except Exception as e:
            return None, f"Error processing image: {str(e)}"
    elif ext in ('.mp4', '.avi', '.mov', '.mkv', '.webm'):
        try:
            model, processor, device, dtype, model_type = get_model(qwen)
            name = generate_image_name(model, processor, device, dtype, path, model_type=model_type)
            return name, None
        except Exception as e:
            return None, f"Error processing video: {str(e)}"
    elif ext in ('.txt', '.pdf', '.docx', '.doc'):
        try:
            keywords = extract_text_file_keywords(path)
            if keywords:
                name = " ".join([w.capitalize() for w in keywords[:10]])
            else:
                name = os.path.basename(path) # Fallback to filename
            return name, None
        except Exception as e:
            return None, f"Error processing text file: {str(e)}"
    else:
        return None, "Unsupported file type"

@app.route("/stop", methods=["POST"])
def stop_server():
    global stopd
    stopd = True
    return jsonify({"status": "stopd"}), 200

@app.route("/captions", methods=["POST"])
def captions_batch():
    """Endpoint for batch processing of files (images or documents) from a list of paths."""
    data = request.get_json(force=True)
    if not isinstance(data, list):
        return jsonify(error="Input must be a list of {ind, path} objects"), 400

    qwen = False
    # Accept qwen as a top-level key in the batch request
    if isinstance(data, dict):
        qwen = data.get("qwen", False)
        data = data.get("files", [])
    elif len(data) > 0 and isinstance(data[0], dict) and "qwen" in data[0]:
        qwen = data[0].get("qwen", False)

    def generate():
        global stopd
        for item in data:
            if stopd:
                yield json.dumps({"error": "Stopd by user"}) + "\n"
                stopd = False
                break  # Stop immediately
            # --- Disconnect detection ---
            if hasattr(request, "environ") and request.environ.get("wsgi.input"):
                if hasattr(request.environ["wsgi.input"], "closed") and request.environ["wsgi.input"].closed:
                    break
            # --- End disconnect detection ---

            ind = item.get("ind")
            path = item.get("path")
            item_qwen = item.get("qwen", qwen)
            if not path:
                yield json.dumps({"ind": ind, "error": "Missing path"}) + "\n"
                continue
            if not os.path.isfile(path):
                yield json.dumps({"ind": ind, "error": f"File not found: {path}"}) + "\n"
                continue

            name, err = process_file(path, item_qwen)
            if err:
                yield json.dumps({"ind": ind, "error": err}) + "\n"
            else:
                yield json.dumps({"ind": ind, "name": name}) + "\n"

    return Response(stream_with_context(generate()), mimetype="application/x-ndjson")

@app.errorhandler(Exception)
def handle_exception(e):
    """Generic error handler for the application."""
    if isinstance(e, HTTPException):
        response = e.get_response()
        response.data = json.dumps({
            "code": e.code,
            "name": e.name,
            "error": e.description,
        })
        response.content_type = "application/json"
    else:
        response = jsonify(error=str(e), code=500)
        response.status_code = 500

    response.headers["Access-Control-Allow-Origin"] = "*"
    return response

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)