# Funbox

Juego de fiesta web con minijuegos asistidos por IA.

## Estructura

```text
funbox/
├── frontend/            Next.js: rutas, pantallas y estilos
│   └── src/
│       ├── app/         Enrutamiento únicamente
│       ├── features/    Lobby, ingreso y futuros juegos
│       └── styles/      Tokens, base y sistema visual
├── backend/             Fastify: servidor autoritativo
│   └── src/
│       ├── config/
│       └── modules/
│           ├── health/
│           └── rooms/   routes → controller → service → repository
├── packages/
│   └── contracts/       Tipos compartidos
└── supabase/
    └── migrations/      Migraciones PostgreSQL ordenadas por dominio
```

## Desarrollo

```bash
npm install
npm run dev:frontend
npm run dev:backend
```

Frontend: `http://localhost:3000`
Backend: `http://localhost:4000/api/health`

## Flujo de salas

1. `/` crea una sala persistente y abre `/host/[code]` en la TV.
2. Los jugadores entran por `/join` con código y nametag.
3. El primero se convierte en líder y recibe el control para comenzar.
4. Cada dispositivo conserva un token privado para reconexión.
5. Socket.IO actualiza la TV cuando entra un jugador o comienza la partida.
6. PostgreSQL guarda las salas y jugadores; los tokens solo se guardan como hash.

La sala admite un máximo de ocho jugadores.

## Adivina la canción: Gemini + YouTube

El backend usa Gemini para proponer una canción y YouTube Data API para
encontrar un video embebible y consultar su duración. El audio se reproduce
exclusivamente mediante el reproductor oficial de YouTube en `/dj/[code]`.

Agrega a `backend/.env`:

```env
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-3.5-flash-lite
YOUTUBE_API_KEY=...
```

`GEMINI_API_KEY` es opcional durante el desarrollo: sin ella se usa un catálogo
de respaldo. `YOUTUBE_API_KEY` sí es necesaria para preparar una ronda.
Las dos claves son secretos del backend y nunca deben usar el prefijo
`NEXT_PUBLIC_`.

1. Crea una sala de **Adivina la canción** y confirma su configuración.
2. Mientras entran los jugadores, el backend prepara la playlist y precarga los videos.
3. Abre `/dj/CODIGO` en el dispositivo de audio.
4. Inicia la partida desde el celular del líder.
5. En el DJ, reproduce la canción.
6. Si YouTube muestra publicidad, usa sus controles y confirma
   **La canción ya comenzó** para iniciar el temporizador de Funbox.
