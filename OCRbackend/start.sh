#!/bin/bash

# Activate the virtual environment
source venv/bin/activate

# Install dependencies (optional, if not already installed)
pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple

# Start the Python server
python3 opencv.py