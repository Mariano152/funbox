"use client";

import { useEffect, useState } from "react";
import { getMusicSuggestions } from "./music.api";
import {
  ANSWER_DURATIONS,
  CLIP_DURATIONS,
  MUSIC_GENRES,
  MUSIC_LANGUAGES,
  ROUND_COUNTS,
  type MusicGameConfig,
  type MusicLanguage,
} from "./music.types";

export function MusicConfigFields({
  value,
  onChange,
  compact = false,
}: {
  value: MusicGameConfig;
  onChange: (value: MusicGameConfig) => void;
  compact?: boolean;
}) {
  const [artistQuery, setArtistQuery] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const currentYear = new Date().getFullYear();
  const patch = <Key extends keyof MusicGameConfig>(
    key: Key,
    next: MusicGameConfig[Key],
  ) => onChange({ ...value, [key]: next });

  useEffect(() => {
    if (artistQuery.trim().length < 3) {
      return;
    }
    let active = true;
    const timeout = window.setTimeout(() => {
      getMusicSuggestions("artist", artistQuery)
        .then(({ suggestions: found }) =>
          active && setSuggestions(
            found.filter((artist) => !value.artists.includes(artist)).slice(0, 6),
          ),
        )
        .catch(() => { if (active) setSuggestions([]); });
    }, 550);
    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [artistQuery, value.artists]);

  const toggleGenre = (genre: string) => {
    patch(
      "genres",
      value.genres.includes(genre)
        ? value.genres.filter((item) => item !== genre)
        : [...value.genres, genre],
    );
  };

  const toggleLanguage = (language: MusicLanguage) => {
    patch(
      "languages",
      value.languages.includes(language)
        ? value.languages.filter((item) => item !== language)
        : [...value.languages, language],
    );
  };

  const addArtist = (artist: string) => {
    patch("artists", [...value.artists, artist]);
    setArtistQuery("");
    setSuggestions([]);
  };

  return (
    <div className={`music-config-fields ${compact ? "compact" : ""}`}>
      <div className="music-config-group">
        <span className="music-config-label">Géneros</span>
        <p className="music-field-help">Deja “Todos” activo o combina los que quieras.</p>
        <div className="genre-picker">
          <button className={!value.genres.length ? "selected" : ""} onClick={() => patch("genres", [])} type="button">Todos</button>
          {MUSIC_GENRES.map((genre) => (
            <button className={value.genres.includes(genre) ? "selected" : ""} key={genre} onClick={() => toggleGenre(genre)} type="button">{genre}</button>
          ))}
        </div>
      </div>

      <div className="music-config-group">
        <span className="music-config-label">Idioma</span>
        <p className="music-field-help">Deja “Todos” activo o combina los que quieras.</p>
        <div className="genre-picker">
          <button className={!value.languages.length ? "selected" : ""} onClick={() => patch("languages", [])} type="button">Todos</button>
          {MUSIC_LANGUAGES.map((language) => (
            <button className={value.languages.includes(language.value) ? "selected" : ""} key={language.value} onClick={() => toggleLanguage(language.value)} type="button">{language.label}</button>
          ))}
        </div>
      </div>

      <div className="music-config-group">
        <span className="music-config-label">Dificultad</span>
        <p className="music-field-help">Deja “Todas” activo o combina las dificultades que quieras.</p>
        <div className="genre-picker">
          <button className={!value.difficulties.length ? "selected" : ""} onClick={() => patch("difficulties", [])} type="button">Todas</button>
          {([ ["easy", "Fácil"], ["medium", "Media"], ["hard", "Difícil"] ] as const).map(([difficulty, label]) => (
            <button
              className={value.difficulties.includes(difficulty) ? "selected" : ""}
              key={difficulty}
              onClick={() => patch(
                "difficulties",
                value.difficulties.includes(difficulty)
                  ? value.difficulties.filter((item) => item !== difficulty)
                  : [...value.difficulties, difficulty],
              )}
              type="button"
            >{label}</button>
          ))}
        </div>
      </div>

      <div className="music-config-group">
        <span className="music-config-label">Años de lanzamiento</span>
        <div className="year-range">
          <label>Desde<input type="number" min={1900} max={currentYear} value={value.yearFrom} onChange={(event) => patch("yearFrom", Number(event.target.value))} /></label>
          <span>—</span>
          <label>Hasta<input type="number" min={value.yearFrom} max={currentYear} value={value.yearTo} onChange={(event) => patch("yearTo", Number(event.target.value))} /></label>
        </div>
      </div>

      <div className="music-config-group">
        <span className="music-config-label">Artistas</span>
        <p className="music-field-help">Vacío significa todos. Busca y agrega solamente los que quieras incluir.</p>
        <div className="artist-filter">
          <input value={artistQuery} onChange={(event) => setArtistQuery(event.target.value)} placeholder="Buscar artista…" autoComplete="off" />
          {artistQuery.trim().length >= 3 && suggestions.length > 0 && (
            <div className="artist-filter-results">
              {suggestions.map((artist) => <button key={artist} onClick={() => addArtist(artist)} type="button">+ {artist}</button>)}
            </div>
          )}
        </div>
        {value.artists.length > 0 && (
          <div className="selected-artists">
            {value.artists.map((artist) => (
              <button key={artist} onClick={() => patch("artists", value.artists.filter((item) => item !== artist))} type="button">{artist} ×</button>
            ))}
          </div>
        )}
      </div>

      <div className="music-config-row">
        <OptionButtons label="Fragmento" values={CLIP_DURATIONS} selected={value.clipDuration} suffix="s" onSelect={(next) => patch("clipDuration", next)} />
        <OptionButtons label="Tiempo para responder" values={ANSWER_DURATIONS} selected={value.answerDuration} suffix="s" onSelect={(next) => patch("answerDuration", next)} />
      </div>
      <OptionButtons label="Rondas" values={ROUND_COUNTS} selected={value.rounds} onSelect={(next) => patch("rounds", next)} />

      <label className="music-config-group">
        <span className="music-config-label">Vibra o intención para la IA</span>
        <textarea className="music-prompt-input" maxLength={500} placeholder="Ej. White girl music, canciones de karaoke, fiesta elegante…" value={value.prompt} onChange={(event) => patch("prompt", event.target.value)} />
        <small className="music-field-help">Aquí no pongas años, artistas, géneros ni idioma: usa los filtros de arriba.</small>
      </label>
    </div>
  );
}

function OptionButtons<T extends number>({
  label, values, selected, suffix = "", onSelect,
}: {
  label: string;
  values: readonly T[];
  selected: number;
  suffix?: string;
  onSelect: (value: T) => void;
}) {
  return (
    <div className="music-config-group">
      <span className="music-config-label">{label}</span>
      <div className="choice-grid">
        {values.map((item) => <button className={selected === item ? "selected" : ""} key={item} onClick={() => onSelect(item)} type="button">{item}{suffix}</button>)}
      </div>
    </div>
  );
}
