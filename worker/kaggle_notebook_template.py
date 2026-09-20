# ==============================================================================
# Movie Recap Studio - Kaggle GPU One-Click Worker Runner
# ==============================================================================
# INSTRUCTIONS:
# 1. Open a new or existing Kaggle Notebook.
# 2. In Notebook Settings (right panel), set Accelerator to "GPU T4 x2" or "GPU P100".
# 3. Paste this cell and run it. The worker will automatically:
#    - Verify Python, PyTorch, CUDA, and FFmpeg
#    - Install required dependencies
#    - Initialize and validate VoxCPM2 zero-shot models
#    - Connect to your Movie Recap Studio app and process video recap jobs!
# ==============================================================================

SERVER_URL = "YOUR_APP_URL_HERE"  # Replace with your app URL (e.g. https://ais-dev-...run.app)
WORKER_TOKEN = "recap-kaggle-token-2026"

import os
import sys

# Clone or pull the repository if running standalone
if not os.path.exists("worker"):
    print("[1/2] Fetching Movie Recap Studio repository...")
    !git clone https://github.com/your-username/movie-recap-studio.git .

# Start the one-click worker daemon
print(f"[2/2] Launching Kaggle GPU Worker connecting to: {SERVER_URL}")
!python -m worker.main --server "{SERVER_URL}" --token "{WORKER_TOKEN}" --poll-interval 4
