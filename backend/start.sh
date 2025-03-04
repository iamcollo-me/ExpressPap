#!/bin/bash

# Start the Node.js server in the background
node server.js &

# Start the Python server
python3 opencv.py
