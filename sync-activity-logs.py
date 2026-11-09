#!/usr/bin/env python3
"""Download daily activity Parquet and prepare the static Pages data file."""
import json
import os
import unicodedata
from io import BytesIO
from pathlib import Path

import pandas as pd
from azure.storage.blob import BlobServiceClient
from dotenv import load_dotenv

TEAM_MEMBERS = {
    "lotta giorgia", "favero matteo", "stocco alberto", "vita anna",
    "mason mauro", "padovan matteo", "micheletto nicola",
}

FIELD_CANDIDATES = {
    "date": ["data", "giorno", "postingdate", "workdate", "activitydate", "date"],
    "person": ["risorsa", "nome", "nominativo", "dipendente", "utente", "resource", "resourcename", "employeename", "person", "member", "persona"],
    "hours": ["oreloggate", "ore", "durata", "oreconsuntivate", "hours", "loggedhours", "quantity", "workinghours", "time"],
    "confirmed_hours": ["oreconfermate", "confirmedhours"],
    "unconfirmed_hours": ["orenonconfermate", "unconfirmedhours"],
    "registrations": ["numeroregistrazioni", "registrations", "registrationcount"],
    "confirmed_registrations": ["registrazioniconfermate", "confirmedregistrations"],
    "logged_minutes": ["minutiloggati", "loggedminutes"],
    "confirmed_minutes": ["minuticonfermati", "confirmedminutes"],
    "unconfirmed_minutes": ["minutinonconfermati", "unconfirmedminutes"],
    "job_code": ["commessa", "codicecommessa", "commessacodice", "numerocommessa", "jobno", "jobnumber", "jobcode", "job"],
    "job_name": ["descrizionecommessa", "nomecommessa", "commessadescrizione", "descrizioneriga", "jobname", "jobdescription", "description"],
    "activity_name": ["descrizionetask", "descrizioneattivita", "nomeattivita", "activitydescription", "activityname", "taskdescription", "task"],
}


def normalize(value):
    decomposed = unicodedata.normalize("NFD", str(value).casefold())
    return "".join(char for char in decomposed if char.isalnum() and not unicodedata.combining(char))


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
    detail_fields = {
        "Codice commessa": fields.get("job_code"),
        "Nome commessa": fields.get("job_name"),
        "Dettaglio attività": fields.get("activity_name"),
    }
    for output_name, source in detail_fields.items():
        daily[output_name] = frame[source].fillna("").astype(str).str.strip() if source else ""

    code = daily["Codice commessa"].str.upper()
    name = daily["Nome commessa"].str.upper()
    activity = daily["Dettaglio attività"].str.upper()
    daily["Tipo attività"] = "Non COIG"
    daily.loc[code.str.startswith("COIG") | name.str.startswith("COIG") | activity.str.startswith("COIG"), "Tipo attività"] = "COIG"

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

    if not fields["unconfirmed_hours"]:
        daily["Ore Non Confermate"] = (daily["Ore Loggate"] - daily["Ore Confermate"]).clip(lower=0)
    if not fields["confirmed_registrations"] and fields["registrations"]:
        daily["Registrazioni Confermate"] = 0
    if not fields["unconfirmed_minutes"] and fields["logged_minutes"] and fields["confirmed_minutes"]:
        daily["Minuti Non Confermati"] = (daily["Minuti Loggati"] - daily["Minuti Confermati"]).clip(lower=0)

    daily = daily.dropna(subset=[date_field, person_field])
    daily = daily[daily[person_field].map(normalize).isin({normalize(name) for name in TEAM_MEMBERS})]
    sum_columns = list(output_fields.values())
    detail_columns = [*detail_fields.keys(), "Tipo attività"]
    group_columns = [date_field, person_field, *detail_columns]
    daily = daily.groupby(group_columns, as_index=False, dropna=True)[sum_columns].sum()
    daily = daily.rename(columns={date_field: "Data", person_field: "Componente"})
    records = daily.astype(object).where(pd.notna(daily), None).to_dict(orient="records")
    target = Path("public/activity-logs.json")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(records, ensure_ascii=False, default=str, allow_nan=False), encoding="utf-8")
    print(f"Raggruppati {len(records)} totali per i 7 componenti selezionati: data={date_field}, componente={person_field}, commessa={fields['job_code'] or 'non disponibile'}, descrizione commessa={fields['job_name'] or 'non disponibile'}, attività={fields['activity_name'] or 'non disponibile'}")
    print(f"Dimensione export consuntivazioni: {target.stat().st_size / (1024 * 1024):.1f} MB")
    print(f"Sincronizzati i totali da {account}/{container}/{blob} in {target}")


if __name__ == "__main__":
    main()
