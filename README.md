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
