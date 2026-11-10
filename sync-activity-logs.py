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
    "task_code": ["jobtaskno", "codicetask", "task"],
    "plan_code": ["rigacommessa", "jobplanno", "numerorigacommessa"],
    "job_name": ["descrizionecommessa", "nomecommessa", "commessadescrizione", "descrizioneriga", "jobname", "jobdescription", "description"],
    "activity_name": ["descrizionetask", "descrizioneattivita", "nomeattivita", "activitydescription", "activityname", "taskdescription", "task"],
}


def normalize(value):
    decomposed = unicodedata.normalize("NFD", str(value).casefold())
    return "".join(char for char in decomposed if char.isalnum() and not unicodedata.combining(char))


def normalize_code(value):
    text = str(value or "").strip()
    try:
        numeric_value = float(text.replace(",", "."))
        if numeric_value.is_integer():
            text = str(int(numeric_value))
    except (TypeError, ValueError):
        pass
    return normalize(text)


def numeric(value):
    try:
        parsed = pd.to_numeric(value, errors="coerce")
        return None if pd.isna(parsed) else float(parsed)
    except (TypeError, ValueError):
        return None


def as_bool(value):
    if isinstance(value, bool):
        return value
    if value is None or pd.isna(value):
        return False
    return normalize(value) in {"1", "true", "si", "yes", "y"}


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
        "Codice task": fields.get("task_code"),
        "Numero riga commessa": fields.get("plan_code"),
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

    customer_by_job = {}
    jobs_path = Path("public/jobs.json")
    if jobs_path.exists():
        for job in json.loads(jobs_path.read_text(encoding="utf-8")):
            job_code = normalize(job.get("JobNo", ""))
            customer = str(job.get("Customer Name") or "").strip()
            if job_code and customer:
                customer_by_job[job_code] = customer
    daily["Cliente"] = daily["Codice commessa"].map(lambda value: customer_by_job.get(normalize(value), ""))

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
    detail_columns = [*detail_fields.keys(), "Cliente", "Tipo attività"]
    group_columns = [date_field, person_field, *detail_columns]
    daily = daily.groupby(group_columns, as_index=False, dropna=True)[sum_columns].sum()

    # Collega ogni riga ZDT al dettaglio CRM/NAV tramite commessa, task e riga.
    jobs_path = Path("public/jobs.json")
    resources_path = Path("public/resources.json")
    jobs = json.loads(jobs_path.read_text(encoding="utf-8")) if jobs_path.exists() else []
    resources = json.loads(resources_path.read_text(encoding="utf-8")) if resources_path.exists() else []
    resource_by_name = {normalize(item.get("Name", "")): normalize(item.get("No", "")) for item in resources}
    jobs_by_key = {}
    for job in jobs:
        key = (
            normalize_code(job.get("JobNo")),
            normalize_code(job.get("JobTaskNo")),
            normalize_code(job.get("JobPlanNo")),
        )
        if all(key):
            jobs_by_key.setdefault(key, []).append(job)

    def resolve_job(row):
        key = (
            normalize_code(row.get("Codice commessa")),
            normalize_code(row.get("Codice task")),
            normalize_code(row.get("Numero riga commessa")),
        )
        candidates = jobs_by_key.get(key, [])
        if not candidates:
            return None, "Commessa/task/riga non abbinati"

        resource_no = resource_by_name.get(normalize(row.get(person_field, "")), "")
        resource_matches = [item for item in candidates if resource_no and normalize(item.get("Resource No", "")) == resource_no]
        if resource_matches:
            candidates = resource_matches

        prices = {numeric(item.get("Unit Price")) for item in candidates}
        if None in prices or len(prices) != 1:
            return None, "Tariffa NAV non univoca"
        price = next(iter(prices))
        if price is None:
            return None, "Prezzo NAV non disponibile"
        logged = sum(numeric(item.get("Ore Loggate")) or 0 for item in candidates)
        invoice_hours = sum(numeric(item.get("Ore Enable Invoicing")) or 0 for item in candidates)
        enabled = any(as_bool(item.get("Enable Invoicing")) for item in candidates)
        return {"price": price, "crm_logged": logged, "invoice_hours": invoice_hours, "enabled": enabled}, "Valorizzata"

    daily["Prezzo unitario NAV"] = 0.0
    daily["Ore valorizzate"] = 0.0
    daily["Stima fatturato"] = 0.0
    daily["Fonte ore stima"] = ""
    daily["Esito valorizzazione"] = ""

    # Le ore CRM sono aggregate per dettaglio commessa, mentre ZDT ha una riga
    # per data/attività. Conta quindi Enable Invoice una sola volta per risorsa,
    # commessa/task/riga e mese, ripartendolo tra le righe ZDT secondo le ore
    # loggate; altrimenti la stessa quantità CRM verrebbe duplicata ogni giorno.
    invoice_groups = {}
    for index, row in daily.iterrows():
        match, status = resolve_job(row)
        logged_hours = numeric(row.get("Ore Loggate")) or 0
        daily.at[index, "Esito valorizzazione"] = status
        if not match:
            continue
        daily.at[index, "Prezzo unitario NAV"] = match["price"]
        if match["enabled"]:
            period = pd.to_datetime(row.get(date_field), errors="coerce")
            month_key = period.strftime("%Y-%m") if pd.notna(period) else str(row.get(date_field, ""))[:7]
            key = (
                month_key,
                normalize(row.get(person_field, "")),
                normalize_code(row.get("Codice commessa")),
                normalize_code(row.get("Codice task")),
                normalize_code(row.get("Numero riga commessa")),
            )
            invoice_groups.setdefault(key, []).append(
                (index, logged_hours, match["invoice_hours"], match["price"])
            )
            daily.at[index, "Fonte ore stima"] = "Ore Enable Invoicing CRM"
        else:
            daily.at[index, "Ore valorizzate"] = logged_hours
            daily.at[index, "Stima fatturato"] = logged_hours * match["price"]
            daily.at[index, "Fonte ore stima"] = "Durata loggata ZDT"

    for rows in invoice_groups.values():
        total_logged = sum(item[1] for item in rows)
        # Tutte le righe del gruppo risolvono lo stesso dettaglio CRM mensile;
        # il totale enable invoice viene applicato una sola volta.
        invoice_hours = rows[0][2]
        for index, logged_hours, _, price in rows:
            share = logged_hours / total_logged if total_logged > 0 else (1 if index == rows[0][0] else 0)
            billable_hours = invoice_hours * share
            daily.at[index, "Ore valorizzate"] = billable_hours
            daily.at[index, "Stima fatturato"] = billable_hours * price

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
