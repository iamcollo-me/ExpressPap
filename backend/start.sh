#!/bin/bash

# Exit immediately if a command exits with a non-zero status
set -e  

# Ensure the correct Python version is used
PYTHON_VERSION="3.10"

# Check if the correct Python version is installed
if ! python3 --version | grep -q "$PYTHON_VERSION"; then
    echo "Error: Python $PYTHON_VERSION is required. Update the environment settings."
    exit 1
fi

# Create and activate a virtual environment if it doesn't exist
if [ ! -d "venv" ]; then
    python3 -m venv venv
fi

source venv/bin/activate

# Upgrade pip before installing dependencies
pip install --upgrade pip

# Install Python dependencies
pip install -r requirements.txt || { echo "Error: Failed to install Python dependencies"; exit 1; }

# Start the Node.js server in the background
node server.js &

# Start the Python server (use exec to properly forward signals)
exec python3 opencv.py
