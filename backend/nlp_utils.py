import nltk
from nltk.corpus import stopwords
from nltk import word_tokenize, pos_tag
import re
import os
import numpy as np
import easyocr
import torch
from keybert import KeyBERT
import pdfplumber
import docx

# --- Initialization ---
try:
    kw_model = KeyBERT()
    reader_en = easyocr.Reader(['en'], gpu=torch.cuda.is_available())
    reader_ar = easyocr.Reader(['ar'], gpu=torch.cuda.is_available())

    for pkg in ("stopwords", "punkt", "averaged_perceptron_tagger"):
        nltk.data.find(f"tokenizers/{pkg}")
except LookupError:
    nltk.download("stopwords")
    nltk.download("punkt")
    nltk.download("averaged_perceptron_tagger")
except Exception as e:
    print(f"Warning: Could not initialize NLP models. Functionality will be limited. Error: {e}")
    kw_model, reader_en, reader_ar = None, None, None

# --- Constants ---
STOPWORDS = set(stopwords.words("english"))
BAD_WORDS = {
    "assistant", "describe", "image", "please", "provide", "mention",
    "likely", "appears", "depicts", "scene", "visible", "background",
    "this", "that", "might", "detail", "e.g", "text", "layout",
    "document", "photo", "medium", "element", "object", "content", "visual"
}
POS_ALLOW = {"NN", "NNS", "NNP", "NNPS", "JJ"}

# --- Text File Processing ---
def _extract_text_from_file(file_path: str) -> str:
    """Internal function to extract raw text from txt, pdf, or docx files."""
    ext = os.path.splitext(file_path)[1].lower()
    text = ""
    if ext == '.txt':
        with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
            text = f.read()
    elif ext == '.pdf':
        with pdfplumber.open(file_path) as pdf:
            for page in pdf.pages:
                text += page.extract_text() or ''
    elif ext in ('.docx', '.doc'):
        doc = docx.Document(file_path)
        text = '\n'.join([p.text for p in doc.paragraphs])
    return text

def extract_text_file_keywords(file_path: str, n: int = 10) -> list:
    """
    Extracts top keywords from a text-based file using KeyBERT, ensuring diversity.
    """
    if not kw_model:
        raise RuntimeError("KeyBERT model is not initialized.")
    
    text = _extract_text_from_file(file_path)
    if not text.strip():
        return []

    keywords = kw_model.extract_keywords(
        text,
        keyphrase_ngram_range=(1, 1),
        stop_words='english',
        top_n=3,
        use_mmr=True,
        diversity=0.7 
    )
    # remove duplicated words
    keywords = list(set(keywords))  
    
    # Filter out keywords that are likely concatenated words (e.g., longer than 20 chars, no spaces)
    filtered = []
    skip_indices = set()
    for i, kw in enumerate(keywords):
        word = kw[0] if kw else ''
        if word and (len(word) <= 20 or ' ' in word):
            filtered.append(word)
            skip_indices.add(i)
            
    # If we filtered out any keyword, try to add next best available (not already included)
    while len(filtered) < len(keywords):
        for i, kw in enumerate(keywords):
            word = kw[0] if kw else ''
            if i not in skip_indices and word and (len(word) <= 20 or ' ' in word):
                if word not in filtered:
                    filtered.append(word)
                    skip_indices.add(i)
                    break
        else:
            break
    return filtered

# --- Image-related NLP (No changes below this line) ---
def is_document(img) -> bool:
    """Determines if an image is likely a document based on its mode and aspect ratio."""
    w, h = img.size
    return img.mode in ("1", "L") or (h > 0 and w / h < 0.7)

def detect_ocr(image) -> tuple[str, str]:
    """Detects and returns the dominant text (English or Arabic) from an image.
    If the detected text is longer than 7 words, returns up to 5 keywords using KeyBERT.
    """
    if not reader_en or not reader_ar:
        return "", "unknown"
        
    arr = np.array(image)
    text_en = " ".join(reader_en.readtext(arr, detail=0, paragraph=True))
    text_ar = " ".join(reader_ar.readtext(arr, detail=0, paragraph=True))

    ar_chars = len(re.findall(r"[\u0600-\u06FF]", text_ar + text_en))
    en_chars = len(re.findall(r"[a-zA-Z]", text_ar + text_en))

    if ar_chars > en_chars:
        text = text_ar.strip()
        lang = 'ar'
    else:
        text = text_en.strip()
        lang = 'en'

    # If OCR result is longer than 7 words and KeyBERT is available, extract up to 5 keywords
    if kw_model and len(text.split()) > 7:
        keywords = kw_model.extract_keywords(
            text,
            keyphrase_ngram_range=(1, 1),
            stop_words='english',
            top_n=5,
            use_mmr=True,
            diversity=0.7
        )
        # keywords is a list of tuples (word, score), get just the words
        text = " ".join([kw[0] for kw in keywords if kw and kw[0]])

    return text, lang

def extract_keywords_from_caption(caption: str) -> list:
    """Extracts meaningful keywords (nouns and adjectives) from an English text caption."""
    tokens = word_tokenize(caption.lower())
    tagged = pos_tag(tokens)
    
    keywords = []
    for word, tag in tagged:
        if (tag in POS_ALLOW and
            word.isalpha() and
            len(word) > 2 and
            word not in STOPWORDS and
            word not in BAD_WORDS):
            if word not in keywords:
                keywords.append(word)
    return keywords