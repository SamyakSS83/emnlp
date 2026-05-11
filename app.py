import json
import os
from pathlib import Path

from google import genai
from flask import Flask, abort, jsonify, render_template, request
from dotenv import load_dotenv

load_dotenv()


BASE_DIR = Path(__file__).resolve().parent
GENERATED_PATH = BASE_DIR / "data" / "generated_sentences.jsonl"
_data_dir = Path(os.environ.get("DATA_DIR", BASE_DIR))
HUMAN_VERIF_PATH = _data_dir / "human_verif.jsonl"

# Seed persistent disk from committed file on first deploy
_seed_source = BASE_DIR / "human_verif.jsonl"
if not HUMAN_VERIF_PATH.exists() and _seed_source.exists() and _data_dir != BASE_DIR:
    _data_dir.mkdir(parents=True, exist_ok=True)
    import shutil
    shutil.copy2(_seed_source, HUMAN_VERIF_PATH)

# Configure Gemini API for transliteration
api_keys = [
    os.environ.get("GEMINI_API_KEY1"),
    os.environ.get("GEMINI_API_KEY2"),
    os.environ.get("GEMINI_API_KEY3"),
]
api_keys = [k for k in api_keys if k and k.strip()]

if not api_keys:
    print("Warning: No Gemini API keys found for transliteration.")

app = Flask(__name__)


def get_gemini_client():
    """Get a Gemini client instance with the first available API key."""
    if not api_keys:
        return None
    return genai.Client(api_key=api_keys[0])


def load_generated_records():
    records = []
    if not GENERATED_PATH.exists():
        return records

    with GENERATED_PATH.open("r", encoding="utf-8") as handle:
        for index, line in enumerate(handle, start=1):
            line = line.strip()
            if not line:
                continue
            record = json.loads(line)
            record["source_index"] = index
            records.append(record)
    return records


def build_empty_review(record):
    def sentence_item(key, kind, label):
        return {
            "key": key,
            "kind": kind,
            "label": label,
            "source_sentence": record.get(key, {}).get("sentence", ""),
            "sentence": record.get(key, {}).get("sentence", ""),
            "approved": False,
            "decision": "",
            "edited_sentence": "",
            "touched": False,
        }

    return {
        "source_index": record["source_index"],
        "phrase": record.get("phrase", ""),
        "meaning": record.get("meaning", ""),
        "items": [
            sentence_item("idiomatic_1", "idiomatic", "Idiomatic 1"),
            sentence_item("idiomatic_2", "idiomatic", "Idiomatic 2"),
            sentence_item("literal_1", "literal", "Literal 1"),
            sentence_item("literal_2", "literal", "Literal 2"),
        ],
        "extras": [],
    }


def load_reviews():
    reviews = {}
    if not HUMAN_VERIF_PATH.exists():
        return reviews

    with HUMAN_VERIF_PATH.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            record = json.loads(line)
            source_index = int(record["source_index"])
            reviews[source_index] = record
    return reviews


def save_reviews(reviews):
    HUMAN_VERIF_PATH.parent.mkdir(parents=True, exist_ok=True)
    temp_path = HUMAN_VERIF_PATH.parent / (HUMAN_VERIF_PATH.name + ".tmp")

    try:
        with temp_path.open("w", encoding="utf-8") as handle:
            for source_index in sorted(reviews):
                handle.write(json.dumps(reviews[source_index], ensure_ascii=False) + "\n")
        
        if temp_path.exists():
            temp_path.replace(HUMAN_VERIF_PATH)
        else:
            raise FileNotFoundError(f"Temp file not created: {temp_path}")
    except Exception as e:
        if temp_path.exists():
            temp_path.unlink()
        raise


def summarize_reviews(review_map):
    reviewed_phrases = len(review_map)
    approved = 0
    rejected = 0
    edited = 0
    added = 0

    for review in review_map.values():
        for item in review.get("items", []):
            if not item.get("touched"):
                continue
            if item.get("decision") == "approve":
                approved += 1
            elif item.get("decision") == "reject":
                rejected += 1
            elif item.get("decision") == "edit":
                edited += 1
        added += len(review.get("extras", []))

    return {
        "reviewed_phrases": reviewed_phrases,
        "approved_items": approved,
        "rejected_items": rejected,
        "edited_items": edited,
        "added_items": added,
    }


def get_review_payload(source_index):
    generated_records = load_generated_records()
    if source_index < 1 or source_index > len(generated_records):
        abort(404)

    generated_record = generated_records[source_index - 1]
    review_map = load_reviews()
    review = review_map.get(source_index) or build_empty_review(generated_record)

    return {
        "index": source_index,
        "total": len(generated_records),
        "generated": generated_record,
        "review": review,
    }


@app.get("/")
def index():
    generated_records = load_generated_records()
    review_map = load_reviews()
    stats = summarize_reviews(review_map)
    stats["total_phrases"] = len(generated_records)
    stats["pending_phrases"] = max(len(generated_records) - stats["reviewed_phrases"], 0)
    return render_template("index.html", total_phrases=len(generated_records), stats=stats)


@app.get("/api/stats")
def api_stats():
    generated_records = load_generated_records()
    review_map = load_reviews()
    stats = summarize_reviews(review_map)
    stats["total_phrases"] = len(generated_records)
    stats["pending_phrases"] = max(len(generated_records) - stats["reviewed_phrases"], 0)
    return jsonify(stats)


@app.get("/api/phrase/<int:source_index>")
def api_phrase(source_index):
    return jsonify(get_review_payload(source_index))


@app.post("/api/save")
def api_save():
    payload = request.get_json(force=True, silent=False)
    source_index = int(payload["source_index"])
    review = payload.get("review")

    generated_records = load_generated_records()
    if source_index < 1 or source_index > len(generated_records):
        abort(404)

    review_map = load_reviews()
    if not review:
        abort(400)

    review["source_index"] = source_index
    review["phrase"] = generated_records[source_index - 1].get("phrase", review.get("phrase", ""))
    review["meaning"] = generated_records[source_index - 1].get("meaning", review.get("meaning", ""))

    touched_items = [item for item in review.get("items", []) if item.get("touched")]
    if not touched_items and not review.get("extras"):
        return jsonify({"ok": False, "message": "No interactions to save."}), 400

    review_map[source_index] = review
    save_reviews(review_map)

    return jsonify({"ok": True, "stats": summarize_reviews(review_map)})


@app.post("/api/transliterate")
def api_transliterate():
    """Convert English-written Hindi (ITRANS/Hinglish) to Devanagari using Gemini API."""
    payload = request.get_json(force=True, silent=False)
    text = payload.get("text", "").strip()

    if not text:
        return jsonify({"ok": False, "error": "No text provided."}), 400

    if not api_keys:
        return jsonify({"ok": False, "error": "Gemini API not configured."}), 500

    try:
        client = get_gemini_client()
        prompt = f"""Convert the following English-written Hindi (Hinglish/ITRANS) to proper Devanagari script. 
Return ONLY the converted text in Devanagari, nothing else.

English Hindi: {text}
Devanagari:"""

        response = client.models.generate_content(
            model="gemini-3.1-flash-lite",
            contents=prompt
        )
        converted = response.text.strip()

        if not converted:
            return jsonify({"ok": False, "error": "Conversion returned empty."}), 400

        return jsonify({"ok": True, "converted": converted})

    except Exception as e:
        error_msg = str(e).lower()
        if "429" in error_msg or "resource exhausted" in error_msg or "quota" in error_msg:
            return jsonify({"ok": False, "error": "API rate limit reached. Try again later."}), 429
        return jsonify({"ok": False, "error": str(e)}), 500


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8000"))
    app.run(host="0.0.0.0", port=port, debug=True)