# Migraciones de Funbox

Los archivos se ejecutan en orden lexicográfico. El prefijo de fecha mantiene un
orden global; el sufijo indica el dominio (`core`, `rooms`, `players`,
`game_sessions`).

El frontend no consulta estas tablas directamente durante una partida. El backend
es la autoridad y utiliza la conexión privada de Supabase.

Flujo previsto:

1. Crear un proyecto en Supabase.
2. Ejecutar `supabase link --project-ref <ref>`.
3. Aplicar migraciones con `supabase db push`.
4. Configurar `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` y `DATABASE_URL`
   únicamente en el backend.
