import os
import sys
import time
import argparse
import socket
import threading
import requests
import json

from worker.pipeline.orchestrator import RecapPipelineOrchestrator

try:
    import torch
except ImportError:
    torch = None

class KaggleGpuWorker:
    def __init__(self, server_url: str, token: str = "", poll_interval: int = 4, worker_id: str = ""):
        self.server_url = server_url.rstrip("/")
        self.token = token
        self.poll_interval = poll_interval
        self.worker_id = worker_id or f"kaggle-worker-{socket.gethostname()}-{os.getpid()}"
        self.active_job_id = None
        self.running = True

        # Detect GPU
        self.gpu_name = "NVIDIA Tesla T4 (Kaggle)"
        self.vram_total_gb = 16.0
        self.vram_used_gb = 1.2

        if torch and torch.cuda.is_available():
            self.gpu_name = torch.cuda.get_device_name(0)
            self.vram_total_gb = round(torch.cuda.get_device_properties(0).total_memory / (1024**3), 1)
            print(f"[Worker] GPU Detected: {self.gpu_name} ({self.vram_total_gb} GB VRAM)")
        else:
            print("[Worker] No CUDA device found, running in CPU compatibility mode")

    def _headers(self):
        headers = {"Content-Type": "application/json"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        return headers

    def send_heartbeat(self):
        """Sends periodic ping to server."""
        while self.running:
            try:
                payload = {
                    "workerId": self.worker_id,
                    "gpuName": self.gpu_name,
                    "vramTotalGb": self.vram_total_gb,
                    "vramUsedGb": self.vram_used_gb,
                    "activeJobId": self.active_job_id,
                    "hostname": socket.gethostname(),
                }
                res = requests.post(
                    f"{self.server_url}/api/worker/heartbeat",
                    json=payload,
                    headers=self._headers(),
                    timeout=8,
                )
                if res.status_code == 200:
                    pass
                else:
                    print(f"[Worker] Heartbeat warning: {res.status_code} - {res.text}")
            except Exception as e:
                print(f"[Worker] Heartbeat connection error: {e}")

            time.sleep(12)

    def register(self, capabilities: dict = None):
        """Registers worker capabilities with the backend server."""
        try:
            payload = {
                "workerId": self.worker_id,
                "name": "Kaggle GPU Worker",
                "status": "ready",
                "gpuName": self.gpu_name,
                "vramTotalGb": self.vram_total_gb,
                "vramUsedGb": self.vram_used_gb,
                "hostname": socket.gethostname(),
                "capabilities": capabilities or {
                    "whisper": True,
                    "edgeTts": True,
                    "voxcpm2": True,
                    "ffmpeg": True,
                    "nvenc": False,
                },
            }
            res = requests.post(
                f"{self.server_url}/api/workers/register",
                json=payload,
                headers=self._headers(),
                timeout=10,
            )
            if res.status_code == 200:
                print(f"[Worker] Registered worker capabilities with backend ✓")
            else:
                print(f"[Worker] Registration note: {res.status_code}")
        except Exception as e:
            print(f"[Worker] Registration note: {e}")

    def start(self):
        print(f"==================================================")
        print(f"Movie Recap Studio - Kaggle GPU Processing Worker")
        print(f"Server Target: {self.server_url}")
        print(f"Worker ID:     {self.worker_id}")
        print(f"Hardware:      {self.gpu_name}")
        print(f"==================================================")

        # Run automated initialization pipeline
        try:
            from worker.core.initializer import WorkerInitializer
            initializer = WorkerInitializer(worker_id=self.worker_id)
            init_res = initializer.run_initialization()
            self.gpu_name = init_res.get("gpuName", self.gpu_name)
            self.vram_total_gb = init_res.get("vramTotalGb", self.vram_total_gb)
            self.register(init_res.get("capabilities"))
        except Exception as init_err:
            print(f"[Worker] Initializer notice: {init_err}")
            self.register()

        # Start heartbeat thread
        hb_thread = threading.Thread(target=self.send_heartbeat, daemon=True)
        hb_thread.start()

        # Main polling loop
        while self.running:
            try:
                poll_res = requests.post(
                    f"{self.server_url}/api/worker/poll",
                    json={"workerId": self.worker_id},
                    headers=self._headers(),
                    timeout=10,
                )

                if poll_res.status_code == 200:
                    data = poll_res.json()
                    job = data.get("job")
                    if job:
                        self.process_job(job, data.get("voiceProfile"), data.get("apiKeys"))
                else:
                    print(f"[Worker] Poll returned {poll_res.status_code}")

            except Exception as e:
                print(f"[Worker] Polling error: {e}")

            time.sleep(self.poll_interval)

    def process_job(self, job: dict, voice_profile: dict, api_keys: dict):
        job_id = job["id"]
        self.active_job_id = job_id
        print(f"\n[Worker] >>> Claimed Job: {job_id} ({job.get('title', 'Untitled')})")

        def progress_callback(stage_name, stage_num, progress, extra):
            print(f"[Stage {stage_num}/10] {stage_name} -> {progress}%")
            try:
                payload = {
                    "stage": stage_name,
                    "stageNumber": stage_num,
                    "progress": progress,
                    **extra,
                }
                requests.post(
                    f"{self.server_url}/api/worker/jobs/{job_id}/progress",
                    json=payload,
                    headers=self._headers(),
                    timeout=8,
                )
            except Exception as pe:
                print(f"[Worker] Failed to report progress: {pe}")

        try:
            orchestrator = RecapPipelineOrchestrator(
                job_data=job,
                voice_profile=voice_profile,
                api_keys=api_keys,
                progress_callback=progress_callback,
            )
            result = orchestrator.run()

            print(f"[Worker] Job {job_id} finished successfully!")
            requests.post(
                f"{self.server_url}/api/worker/jobs/{job_id}/complete",
                json={
                    "outputVideoPath": result.get("output_video_path"),
                    "segments": result.get("segments"),
                },
                headers=self._headers(),
                timeout=10,
            )

        except Exception as e:
            structured_err = None
            if hasattr(e, "payload") and isinstance(e.payload, dict):
                structured_err = e.payload
            elif len(e.args) > 0 and isinstance(e.args[0], dict):
                structured_err = e.args[0]
            elif isinstance(e, dict):
                structured_err = e

            if structured_err:
                print(f"[Worker] Pipeline error in stage {structured_err.get('stage')}: {structured_err.get('message')}")
                try:
                    requests.post(
                        f"{self.server_url}/api/worker/jobs/{job_id}/fail",
                        json=structured_err,
                        headers=self._headers(),
                        timeout=10,
                    )
                except Exception as post_err:
                    print(f"[Worker] Failed to report error to server: {post_err}")
            else:
                print(f"[Worker] Unexpected fatal exception: {e}")
                try:
                    requests.post(
                        f"{self.server_url}/api/worker/jobs/{job_id}/fail",
                        json={
                            "stage": "processing",
                            "code": "UNEXPECTED_EXCEPTION",
                            "message": str(e),
                            "retryable": True,
                        },
                        headers=self._headers(),
                        timeout=10,
                    )
                except Exception as post_err:
                    print(f"[Worker] Failed to report error to server: {post_err}")
        finally:
            self.active_job_id = None

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Movie Recap Studio Kaggle GPU Worker")
    parser.add_argument("--server", type=str, required=True, help="URL of the Movie Recap Studio backend")
    parser.add_argument("--token", type=str, default="recap-kaggle-token-2026", help="Worker authentication token")
    parser.add_argument("--poll-interval", type=int, default=5, help="Polling interval in seconds")
    parser.add_argument("--worker-id", type=str, default="", help="Custom worker identifier")
    args = parser.parse_args()

    worker = KaggleGpuWorker(
        server_url=args.server,
        token=args.token,
        poll_interval=args.poll_interval,
        worker_id=args.worker_id,
    )
    try:
        worker.start()
    except KeyboardInterrupt:
        print("\n[Worker] Shutting down...")
        worker.running = False
