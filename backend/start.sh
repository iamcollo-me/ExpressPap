#!/bin/bash

# Create a virtual environment
python3 -m venv venv

# Activate the virtual environment
source venv/bin/activate

# Install Python dependencies
pip install -r requirements.txt

# Start the Node.js server in the background
node server.js &

# Start the Python server
python3 opencv.py
