#!/bin/bash

# Use Python 3.10 explicitly
PYTHON=$(which python3.10 || which python3)

# Create a virtual environment with Python 3.10
$PYTHON -m venv venv

# Activate the virtual environment
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Start Node.js server in the background
node server.js &

# Start Python server
$PYTHON opencv.py
