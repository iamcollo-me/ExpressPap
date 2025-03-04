#!/bin/bash

set -e

# Ensure Python is available
PYTHON_CMD=$(which python3.10 || which python3 || which python)

if ! $PYTHON_CMD --version | grep -q "3.10"; then
    echo "Error: Python 3.10.x is required but not found."
    exit 1
fi

# Setup Python virtual environment
if [ ! -d "venv" ]; then
    $PYTHON_CMD -m venv venv
fi

source venv/bin/activate

# Upgrade pip and install dependencies
pip install --upgrade pip
pip install -r requirements.txt || { echo "Error: Failed to install dependencies"; exit 1; }

# Use npm to start both Node.js and Python together
exec npm start
