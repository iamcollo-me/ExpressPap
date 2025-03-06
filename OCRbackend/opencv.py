import os
import base64
import traceback
import numpy as np
import cv2
import easyocr
import requests
from flask import Flask, request, jsonify
from flask_cors import CORS
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Initialize Flask app
app = Flask(__name__)
CORS(app)

print("🐞 Flask app initialized with CORS enabled")

# EasyOCR Initialization
try:
    print("🖼️ Initializing EasyOCR...")
    reader = easyocr.Reader(["en"])
    print("✅ EasyOCR initialized (CPU mode)")
except Exception as e:
    print(f"🔴 EasyOCR initialization failed: {str(e)}")
    exit(1)

# Node.js Backend URL
NODEJS_BACKEND_URL = os.getenv("NODEJS_BACKEND_URL", "https://expresspap.onrender.com")

# Image Processing Endpoint
@app.route("/upload", methods=["POST"])
def upload_image():
    try:
        print("📨 Received upload request")
        
        # Handle different content types
        if request.is_json:
            data = request.get_json()
            if "image" not in data:
                return jsonify({"status": "error", "message": "Missing image data"}), 400
                
            print("🔍 Processing base64 image")
            img = process_base64(data["image"])
        else:
            if 'image' not in request.files:
                return jsonify({"status": "error", "message": "No file uploaded"}), 400
                
            print("📁 Processing file upload")
            img = process_file(request.files['image'])

        print("🔎 Performing OCR...")
        plates = ocr_processing(img)
        
        print(f"🔑 Detected plates: {plates}")
        
        # Send the detected license plate to the Node.js backend
        response = send_to_nodejs(plates)
        
        return response

    except Exception as e:
        print(f"🔥 Critical error: {str(e)}")
        traceback.print_exc()
        return jsonify({"status": "error", "message": "Processing failed"}), 500

# Helper functions
def process_base64(image_data):
    try:
        npimg = np.frombuffer(base64.b64decode(image_data), np.uint8)
        img = cv2.imdecode(npimg, cv2.IMREAD_COLOR)
        return img
    except Exception as e:
        print(f"📷 Base64 decode error: {str(e)}")
        raise

def process_file(file):
    try:
        npimg = np.frombuffer(file.read(), np.uint8)
        img = cv2.imdecode(npimg, cv2.IMREAD_COLOR)
        return img
    except Exception as e:
        print(f"📁 File processing error: {str(e)}")
        raise

def ocr_processing(img):
    results = reader.readtext(img)
    return [text[1].upper().replace(' ', '') for text in results]


def send_to_nodejs(plates):
    try:
        print(f"📤 Sending detected plates to Node.js backend: {plates}")
        
        # Send the detected license plate to the Node.js backend
        response = requests.post(
            f"{NODEJS_BACKEND_URL}/verify",
            json={"licensePlate": plates[0]}  # Send the first detected plate
        )
        
        if response.status_code == 200:
            print("✅ Node.js backend processed the request successfully")
            return jsonify(response.json()), 200
        else:
            print(f"🔴 Node.js backend returned an error: {response.status_code}")
            return jsonify({
                "status": "error",
                "message": "Node.js backend error",
                "details": response.json()
            }), response.status_code

    except Exception as e:
        print(f"🔴 Error communicating with Node.js backend: {str(e)}")
        return jsonify({
            "status": "error",
            "message": "Failed to communicate with Node.js backend"
        }), 500


# Health Check
@app.route("/health", methods=["GET"])
def health_check():
    return jsonify({
        "status": "healthy",
        "services": {
            "ocr": "ready"
        }
    }), 200

# Server Startup
if __name__ == "__main__":
    port = 5001
    print(f"🚀 Starting server on port {port}")
    app.run(host="0.0.0.0", port=port, debug=False)
