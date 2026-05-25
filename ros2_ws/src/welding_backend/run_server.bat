@echo off
cd /d %~dp0
if not exist .venv\Scripts\python.exe (
  echo [welding_backend] Creating virtual environment...
  python -m venv .venv
  call .venv\Scripts\activate.bat
  python -m pip install --upgrade pip
  pip install -r requirements.txt
  pip install cascadio
) else (
  call .venv\Scripts\activate.bat
)
echo [welding_backend] http://localhost:8000
python run_server.py
