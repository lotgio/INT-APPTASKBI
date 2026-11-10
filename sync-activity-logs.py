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
    "albanese lorenzo", "brigo matteo", "brotto fabio", "cecchin chiara",
    "cestaro luca", "dian enrico", "luise alessandro", "marino daniele",
    "verzotto maria", "rampazzo lisa", "sarto michele", "omodei cesare",
}

FIELD_CANDIDATES = {
    "date": ["data", "giorno", "postingdate", "workdate", "activitydate", "date"],
    "person": ["persona", "risorsa", "nome", "nominativo", "dipendente", "utente", "resource", "resourcename", "employeename", "person", "member", "componente"],
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

    # Il dettaglio contiene una riga per attività ZDT e le ore fatturabili già
    # calcolate dalla sorgente CRM: usarle per data/commessa evita ripartizioni
    # stimate da aggregati mensili.
    detail_blob = os.getenv(
        "AZURE_ACTIVITY_DETAIL_BLOB",
        "SQLSERVER1_ZeroDownTimeDB_ControlloLogCRM_DettaglioAttivita.parquet",
    )
    detail_container = os.getenv("AZURE_ACTIVITY_DETAIL_CONTAINER", container)
    detail_client = BlobServiceClient.from_connection_string(connection).get_blob_client(
        container=detail_container, blob=detail_blob
    )
    detail_content = BytesIO()
    detail_client.download_blob().readinto(detail_content)
    detail_content.seek(0)
    detail_frame = pd.read_parquet(detail_content)
    print(f"Colonne dettaglio CRM: {', '.join(str(column) for column in detail_frame.columns)}")

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
    jobs = json.loads(jobs_path.read_text(encoding="utf-8")) if jobs_path.exists() else []
    jobs_by_key = {};
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

    detail_date = find_field(detail_frame.columns, "date")
    detail_person = find_field(detail_frame.columns, "person")
    detail_job = find_field(detail_frame.columns, "job_code")
    detail_task = find_field(detail_frame.columns, "task_code")
    detail_plan = find_field(detail_frame.columns, "plan_code")
    detail_billable = next(
        (column for column in detail_frame.columns if normalize(column) in {"orefatturabili", "billablehours"}),
        None,
    )
    detail_invoice_hours = next(
        (column for column in detail_frame.columns if normalize(column) in {"invoicequantityore", "invoicehours"}),
        None,
    )
    detail_invoice_minutes = next(
        (column for column in detail_frame.columns if normalize(column) in {"invoicequantity", "invoiceminutes"}),
        None,
    )
    detail_to_bill = next(
        (column for column in detail_frame.columns if normalize(column) in {"tobill", "enableinvoice"}),
        None,
    )
    required_detail = {
        "data": detail_date, "componente": detail_person, "commessa": detail_job,
        "task": detail_task, "riga": detail_plan,
    }
    missing_detail = [name for name, column in required_detail.items() if column is None]
    if missing_detail:
        raise ValueError(
            f"Colonne chiave mancanti nel dettaglio CRM: {missing_detail}; "
            f"colonne presenti: {list(detail_frame.columns)}"
        )
    if detail_billable is None and detail_invoice_hours is None and detail_invoice_minutes is None:
        raise ValueError("Il dettaglio CRM non contiene Ore Fatturabili né InvoiceQuantity")

    def detail_day(value):
        parsed = pd.to_datetime(value, errors="coerce", dayfirst=True)
        return parsed.strftime("%Y-%m-%d") if pd.notna(parsed) else ""

    def detail_hours(row):
        if detail_billable:
            value = numeric(row.get(detail_billable))
            if value is not None:
                return max(value, 0)
        if detail_to_bill and not as_bool(row.get(detail_to_bill)):
            return 0.0
        if detail_invoice_hours:
            value = numeric(row.get(detail_invoice_hours))
            if value is not None:
                return max(value, 0)
        if detail_invoice_minutes:
            value = numeric(row.get(detail_invoice_minutes))
            if value is not None:
                return max(value / 60, 0)
        return 0.0

    billable_by_activity = {}
    for _, detail in detail_frame.iterrows():
        key = (
            detail_day(detail.get(detail_date)),
            normalize(detail.get(detail_person, "")),
            normalize_code(detail.get(detail_job)),
            normalize_code(detail.get(detail_task)),
            normalize_code(detail.get(detail_plan)),
        )
        if all(key):
            billable_by_activity[key] = billable_by_activity.get(key, 0.0) + detail_hours(detail)

    daily["Prezzo unitario NAV"] = 0.0
    daily["Ore valorizzate"] = 0.0
    daily["Stima fatturato"] = 0.0
    daily["Fonte ore stima"] = "Ore Fatturabili CRM per attività"
    daily["Esito valorizzazione"] = ""

    matched_detail_rows = 0
    for index, row in daily.iterrows():
        match, status = resolve_job(row)
        daily.at[index, "Esito valorizzazione"] = status
        detail_key = (
            detail_day(row.get(date_field)),
            normalize(row.get(person_field, "")),
            normalize_code(row.get("Codice commessa")),
            normalize_code(row.get("Codice task")),
            normalize_code(row.get("Numero riga commessa")),
        )
        if detail_key not in billable_by_activity:
            daily.at[index, "Esito valorizzazione"] = "Attività non abbinata al dettaglio CRM"
            daily.at[index, "Fonte ore stima"] = "Dettaglio CRM mancante"
            continue
        billable_hours = billable_by_activity[detail_key]
        matched_detail_rows += 1
        daily.at[index, "Ore valorizzate"] = billable_hours
        if match:
            daily.at[index, "Prezzo unitario NAV"] = match["price"]
            daily.at[index, "Stima fatturato"] = billable_hours * match["price"]
        else:
            daily.at[index, "Esito valorizzazione"] = status

    if len(daily) and matched_detail_rows == 0:
        raise ValueError("Nessuna riga giornaliera abbinata al nuovo dettaglio CRM; verificare le chiavi")

    print(f"Righe giornaliere abbinate al dettaglio CRM: {matched_detail_rows}/{len(daily)}")

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
