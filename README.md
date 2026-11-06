# Pokémon Battle Bot

Bot Discord per battaglie Pokémon 3v3 a turni. Dati e sprite da [PokéAPI](https://pokeapi.co).

## Come si gioca

- `/battaglia sfida @utente` — lancia la sfida; l'altro accetta o rifiuta coi bottoni
- Ogni giocatore riceve 3 Pokémon casuali (livello 50, Gen 1-5, niente leggendari pesanti) con 4 mosse offensive
- Ogni turno: **Scegli mossa** o **Cambia** (la scelta è privata, la vede solo chi la fa)
- Quando entrambi hanno scelto il turno si risolve: i cambi vanno per primi, poi le mosse in ordine di velocità
- Si calcolano tipi, STAB, colpi critici, precisione e danno come nei giochi
- Se un Pokémon va KO, chi lo perde sceglie il sostituto
- Vince chi mette KO tutta la squadra avversaria. Si può anche **Arrendersi** o usare `/battaglia annulla`
- Se un giocatore non agisce entro 2 minuti perde per timeout

Le battaglie vivono in memoria: se il bot si riavvia, quelle in corso vanno perse.

## Avvio in locale

1. Crea un'applicazione su https://discord.com/developers/applications, aggiungi un Bot e copia il token
2. Invita il bot con scope `bot` + `applications.commands` (permessi: Invia messaggi, Incorpora link)
3. ```bash
   cp .env.example .env   # inserisci DISCORD_TOKEN (e GUILD_ID per avere i comandi subito)
   npm install
   npm start
   ```

## Deploy su Render

1. Su Render: **New → Blueprint**, scegli questo repo (legge `render.yaml`), oppure **New → Web Service** con build `npm install` e start `npm start`
2. Aggiungi la variabile d'ambiente `DISCORD_TOKEN`
3. Deploy

### Tenerlo sempre acceso (UptimeRobot)

Sul piano free il Web Service va in sleep dopo 15 minuti senza richieste HTTP e il bot si disconnette. Il bot serve una pagina di stato sull'URL del servizio, pensata per essere pingata:

- `https://<tuo-servizio>.onrender.com/` — pagina di stato (sempre 200)
- `https://<tuo-servizio>.onrender.com/health` — JSON, 200 se il bot è connesso a Discord, 503 altrimenti

Su [UptimeRobot](https://uptimerobot.com) crea un monitor **HTTP(s)** sull'URL e intervallo di 5 minuti. Usa `/health` se vuoi essere avvisato quando il bot è disconnesso da Discord, `/` se ti basta tenere sveglio il servizio.
