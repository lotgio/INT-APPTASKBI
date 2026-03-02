# App Task Reparto

Applicazione per gestire task di reparto con numero commessa, descrizione, assegnazione ai membri del team e organizzazione per data.

## Requisiti

- Node.js 18 o superiore
- npm
- (Opzionale) Azure Cosmos DB SQL API

## Configurazione

1. Copia .env.example in .env e inserisci le variabili.
2. Se usi Cosmos DB, crea un database e un container con partition key /teamId.

## Installazione dipendenze

- npm install

## Avvio in sviluppo

- npm run dev

L'app frontend è su http://localhost:5173 e le API su http://localhost:5174.

## Seed dati

- npm run seed

## Build produzione

- npm run build
- npm run start

## Pubblicazione su GitHub Pages (via facile)

1. Verifica che il nome repo sia `INT-apptaskBI`. Se diverso, aggiorna `base` in [vite.config.ts](vite.config.ts).
2. Installa dipendenze: `npm install`.
3. Pubblica: `npm run deploy`.
4. Su GitHub: Settings -> Pages -> Source = `gh-pages` branch, folder `/`.
5. Attendi 1-2 minuti e usa l'URL pubblico per condividere i link delle risorse.

## Note

Se le variabili Cosmos DB non sono configurate, il server usa memoria locale (i dati non persistono).
