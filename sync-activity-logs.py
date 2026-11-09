#!/usr/bin/env python3
"""Download the daily activity Parquet and prepare the static Pages data file."""
import json
import os
from io import BytesIO
from pathlib import Path

import pandas as pd
from azure.storage.blob import BlobServiceClient
from dotenv import load_dotenv

FIELD_CANDIDATES = {
    "date": ["data", "giorno", "postingdate", "workdate", "activitydate", "date"],
    "person": ["risorsa", "nome", "nominativo", "dipendente", "utente", "resource", "resourcename", "employeename", "person", "member"],
    "hours": ["ore", "oreloggate", "durata", "oreconsuntivate", "hours", "loggedhours", "quantity", "workinghours", "time"],
}


def normalize(value):
    return "".join(char for char in str(value).lower() if char.isalnum())


def find_field(columns, kind):
    candidates = FIELD_CANDIDATES[kind]
    for candidate in candidates:
        for column in columns:
            if normalize(column) == candidate:
                return column
    for column in columns:
        if any(candidate in normalize(column) for candidate in candidates):
            return column
    return None


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
    date_field = find_field(frame.columns, "date")
    person_field = find_field(frame.columns, "person")
    hours_field = find_field(frame.columns, "hours")
    if not all((date_field, person_field, hours_field)):
        raise ValueError(f"Colonne necessarie non individuate; campi trovati: {list(frame.columns)}")

    daily = frame[[date_field, person_field, hours_field]].copy()
    daily[hours_field] = pd.to_numeric(daily[hours_field], errors="coerce").fillna(0)
    daily = daily.dropna(subset=[date_field, person_field])
    daily = daily.groupby([date_field, person_field], as_index=False, dropna=True)[hours_field].sum()
    daily = daily.rename(columns={date_field: "Data", person_field: "Componente", hours_field: "Ore"})
    records = daily.astype(object).where(pd.notna(daily), None).to_dict(orient="records")
    target = Path("public/activity-logs.json")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(records, ensure_ascii=False, default=str, allow_nan=False), encoding="utf-8")
    print(f"Raggruppati {len(records)} totali giornalieri usando le colonne {date_field}, {person_field}, {hours_field}")
    print(f"Sincronizzati i totali da {account}/{container}/{blob} in {target}")


if __name__ == "__main__":
    main()
