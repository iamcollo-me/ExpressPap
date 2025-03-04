#!/bin/bash

# Install Python dependencies
pip3 install -r requirements.txt

# Start the Node.js server in the background
node server.js &

# Start the Python server
python3 opencv.py
