export type ThemePreference = "light" | "dark";

export type UserSettings = {
  theme: ThemePreference;
  brushColor: string;
  customColor: string;
  brushSize: number;
  inkOpacity: number;
  smoothing: number;
  zoom: number;
};

export const DEFAULT_USER_SETTINGS: UserSettings = {
  theme: "light",
  brushColor: "#101828",
  customColor: "#164e63",
  brushSize: 6,
  inkOpacity: 100,
  smoothing: 35,
  zoom: 115,
};

const SETTINGS_KEY = "cursivepdf:user-settings:v1";

export function loadUserSettings(): UserSettings {
  if (typeof localStorage === "undefined") {
    return getDefaultSettings();
  }

  const rawSettings = localStorage.getItem(SETTINGS_KEY);

  if (!rawSettings) {
    return getDefaultSettings();
  }

  try {
    const parsed = JSON.parse(rawSettings) as Partial<UserSettings>;

    return {
      theme: parsed.theme === "dark" || parsed.theme === "light" ? parsed.theme : getDefaultTheme(),
      brushColor: normalizeHexColor(parsed.brushColor, DEFAULT_USER_SETTINGS.brushColor),
      customColor: normalizeHexColor(parsed.customColor, DEFAULT_USER_SETTINGS.customColor),
      brushSize: clampNumber(parsed.brushSize, 1, 28, DEFAULT_USER_SETTINGS.brushSize),
      inkOpacity: clampNumber(parsed.inkOpacity, 10, 100, DEFAULT_USER_SETTINGS.inkOpacity),
      smoothing: clampNumber(parsed.smoothing, 0, 100, DEFAULT_USER_SETTINGS.smoothing),
      zoom: clampNumber(parsed.zoom, 50, 250, DEFAULT_USER_SETTINGS.zoom),
    };
  } catch {
    return getDefaultSettings();
  }
}

export function saveUserSettings(settings: UserSettings): void {
  if (typeof localStorage === "undefined") {
    return;
  }

  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function normalizeHexColor(value: unknown, fallback = DEFAULT_USER_SETTINGS.brushColor): string {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.trim();
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(trimmed);

  if (!match) {
    return fallback;
  }

  const hex = match[1];
  const expanded =
    hex.length === 3
      ? hex
          .split("")
          .map((character) => `${character}${character}`)
          .join("")
      : hex;

  return `#${expanded.toLowerCase()}`;
}

function getDefaultSettings(): UserSettings {
  return {
    ...DEFAULT_USER_SETTINGS,
    theme: getDefaultTheme(),
  };
}

function getDefaultTheme(): ThemePreference {
  if (typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches) {
    return "dark";
  }

  return DEFAULT_USER_SETTINGS.theme;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, value));
}
