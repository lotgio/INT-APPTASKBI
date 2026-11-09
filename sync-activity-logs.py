#!/usr/bin/env python3
"""Download daily activity Parquet and prepare the static Pages data file."""
import json
import os
from io import BytesIO
from pathlib import Path

import pandas as pd
from azure.storage.blob import BlobServiceClient
from dotenv import load_dotenv

FIELD_CANDIDATES = {
    "date": ["data", "giorno", "postingdate", "workdate", "activitydate", "date"],
    "person": ["risorsa", "nome", "nominativo", "dipendente", "utente", "resource", "resourcename", "employeename", "person", "member", "persona"],
    "hours": ["oreloggate", "ore", "durata", "oreconsuntivate", "hours", "loggedhours", "quantity", "workinghours", "time"],
    "confirmed_hours": ["oreflagconfirmeddb", "oreconfermate", "confirmedhours"],
    "unconfirmed_hours": ["orenonconfermate", "unconfirmedhours"],
    "registrations": ["numeroregistrazioni", "registrations", "registrationcount"],
    "confirmed_registrations": ["registrazioniflagconfirmeddb", "registrazioniconfermate", "confirmedregistrations"],
    "logged_minutes": ["minutiloggati", "loggedminutes"],
    "confirmed_minutes": ["minutiflagconfirmeddb", "minuticonfermati", "confirmedminutes"],
    "unconfirmed_minutes": ["minutinonconfermati", "unconfirmedminutes"],
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
    print(f"Colonne origine parquet: {', '.join(str(column) for column in frame.columns)}")

    date_field = find_field(frame.columns, "date")
    person_field = find_field(frame.columns, "person")
    fields = {kind: find_field(frame.columns, kind) for kind in FIELD_CANDIDATES if kind not in ("date", "person")}
    if not date_field or not person_field or not fields["hours"] or not fields["confirmed_hours"]:
        raise ValueError(f"Colonne necessarie non individuate; campi trovati: {list(frame.columns)}")

    daily = frame[[date_field, person_field]].copy()
    output_fields = {
        "hours": "Ore Loggate",
        "confirmed_hours": "Ore Confermate",
        "unconfirmed_hours": "Ore Non Confermate",
        "registrations": "Numero Registrazioni",
        "confirmed_registrations": "Registrazioni Confermate",
        "logged_minutes": "Minuti Loggati",
        "confirmed_minutes": "Minuti Confermati",
        "unconfirmed_minutes": "Minuti Non Confermati",
    }
    for kind, output_name in output_fields.items():
        source = fields.get(kind)
        daily[output_name] = pd.to_numeric(frame[source], errors="coerce").fillna(0) if source else 0

    db_flag_hours = normalize(fields["confirmed_hours"]) == "oreflagconfirmeddb"
    if db_flag_hours:
        daily["Ore Non Confermate"] = (daily["Ore Loggate"] - daily["Ore Confermate"]).clip(lower=0)
        if fields["registrations"] and fields["confirmed_registrations"]:
            daily["Registrazioni Confermate"] = pd.to_numeric(frame[fields["confirmed_registrations"]], errors="coerce").fillna(0)
        if fields["logged_minutes"] and fields["confirmed_minutes"]:
            daily["Minuti Non Confermati"] = (daily["Minuti Loggati"] - daily["Minuti Confermati"]).clip(lower=0)

    daily = daily.dropna(subset=[date_field, person_field])
    sum_columns = list(output_fields.values())
    daily = daily.groupby([date_field, person_field], as_index=False, dropna=True)[sum_columns].sum()
    daily = daily.rename(columns={date_field: "Data", person_field: "Componente"})
    records = daily.astype(object).where(pd.notna(daily), None).to_dict(orient="records")
    target = Path("public/activity-logs.json")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(records, ensure_ascii=False, default=str, allow_nan=False), encoding="utf-8")
    print(f"Raggruppati {len(records)} totali giornalieri: data={date_field}, componente={person_field}, ore loggate={fields['hours']}, ore confermate={fields['confirmed_hours']}, criterio flag DB={db_flag_hours}")
    print(f"Sincronizzati i totali da {account}/{container}/{blob} in {target}")


if __name__ == "__main__":
    main()
