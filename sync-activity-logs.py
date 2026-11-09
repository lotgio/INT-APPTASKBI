#!/usr/bin/env python3
"""Download the daily activity Parquet and prepare the static Pages data file."""
import json
import os
from io import BytesIO
from pathlib import Path

import pandas as pd
from azure.storage.blob import BlobServiceClient
from dotenv import load_dotenv


def main():
    load_dotenv()
    account = os.getenv("AZURE_ACTIVITY_STORAGE_ACCOUNT") or os.getenv("AZURE_STORAGE_ACCOUNT")
    key = os.getenv("AZURE_ACTIVITY_STORAGE_KEY") or os.getenv("AZURE_STORAGE_KEY")
    container = os.getenv("AZURE_ACTIVITY_STORAGE_CONTAINER", "parquet-files")
    blob = os.getenv("AZURE_ACTIVITY_STORAGE_BLOB", "SQLSERVER1_ZeroDownTimeDB_AttivitaGiornaliere.parquet")
    if not account or not key:
        raise ValueError("Missing AZURE_STORAGE_ACCOUNT or AZURE_STORAGE_KEY")

    connection = f"DefaultEndpointsProtocol=https;AccountName={account};AccountKey={key};EndpointSuffix=core.windows.net"
    client = BlobServiceClient.from_connection_string(connection).get_blob_client(container=container, blob=blob)
    content = BytesIO()
    client.download_blob().readinto(content)
    content.seek(0)
    frame = pd.read_parquet(content)
    records = frame.astype(object).where(pd.notna(frame), None).to_dict(orient="records")
    target = Path("public/activity-logs.json")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(records, ensure_ascii=False, default=str, allow_nan=False), encoding="utf-8")
    print(f"Sincronizzate {len(records)} consuntivazioni da {account}/{container}/{blob} in {target}")


if __name__ == "__main__":
    main()
