import argparse

import uvicorn

from .api import create_app

parser = argparse.ArgumentParser(description="Start the local PrivForensics workstation.")
parser.add_argument("--port", type=int, default=8765)
args = parser.parse_args()
uvicorn.run(create_app(), host="127.0.0.1", port=args.port, workers=1, access_log=False)
