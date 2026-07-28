import type { CSSProperties } from "react";
import type { AvatarColor, AvatarKey } from "@/features/rooms/room.types";

export const AVATAR_CATALOG: {
  key: AvatarKey;
  name: string;
  personality: string;
  color: AvatarColor;
  accessory: string;
  mood: "happy" | "sleepy" | "wink";
}[] = [
  { key: "nerd", name: "Pixel", personality: "La nerd", color: "cyan", accessory: "glasses", mood: "happy" },
  { key: "athlete", name: "Turbo", personality: "La deportista", color: "pink", accessory: "headband", mood: "wink" },
  { key: "royal", name: "Gala", personality: "La royal", color: "purple", accessory: "crown", mood: "happy" },
  { key: "gardener", name: "Brote", personality: "La jardinera", color: "lime", accessory: "sprout", mood: "sleepy" },
  { key: "rocker", name: "Riff", personality: "La rockera", color: "orange", accessory: "mohawk", mood: "wink" },
  { key: "astronaut", name: "Nova", personality: "La astronauta", color: "blue", accessory: "antenna", mood: "happy" },
  { key: "chef", name: "Mochi", personality: "La chef", color: "red", accessory: "chef", mood: "happy" },
  { key: "detective", name: "Miga", personality: "La detective", color: "yellow", accessory: "detective", mood: "sleepy" },
  { key: "artist", name: "Tinta", personality: "La artista", color: "teal", accessory: "beret", mood: "wink" },
];

export function getAvatar(key: AvatarKey) {
  return AVATAR_CATALOG.find((avatar) => avatar.key === key) ?? AVATAR_CATALOG[0];
}

export function AvatarCharacter({
  avatarKey,
  index = 0,
  compact = false,
}: {
  avatarKey: AvatarKey;
  index?: number;
  compact?: boolean;
}) {
  const avatar = getAvatar(avatarKey);
  return (
    <div
      className={`jelly jelly-${avatar.color} avatar-${avatar.key} ${compact ? "jelly-compact" : ""}`}
      style={{ "--delay": `${index * 0.14}s` } as CSSProperties}
      aria-label={`${avatar.name}, ${avatar.personality}`}
    >
      <div className={`accessory accessory-${avatar.accessory}`} aria-hidden="true" />
      <div className="jelly-shine" />
      <div className="jelly-face">
        <i className={`eye eye-left ${avatar.mood === "sleepy" ? "eye-sleepy" : ""}`} />
        <i className={`eye eye-right ${avatar.mood === "wink" ? "eye-wink" : ""}`} />
        <i className={`mouth mouth-${avatar.mood}`} />
      </div>
      <div className="jelly-arm jelly-arm-left" />
      <div className="jelly-arm jelly-arm-right" />
    </div>
  );
}
