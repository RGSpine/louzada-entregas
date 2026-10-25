import {
  resolveClinicalDark,
  type ClinicalCalmThemeMode,
} from "@/design/tokens";

export const THEME_STORAGE_KEY = "theme";

export const THEME_MODES: ClinicalCalmThemeMode[] = [
  "auto",
  "light",
  "dark",
  "system",
];

export function readStoredTheme(): ClinicalCalmThemeMode {
  if (typeof window === "undefined") return "auto";
  try {
    const t = localStorage.getItem(THEME_STORAGE_KEY);
    if (t === "light" || t === "dark" || t === "system" || t === "auto") {
      return t;
    }
  } catch {
    /* ignore */
  }
  return "auto";
}

export function applyThemeClass(
  theme: ClinicalCalmThemeMode,
  prefersDark = false,
): void {
  if (typeof document === "undefined") return;
  const dark = resolveClinicalDark(theme, prefersDark);
  document.documentElement.classList.toggle("dark", dark);
}

/** Script inline para FOUC — espelha resolveClinicalDark */
export const CLINICAL_THEME_BOOTSTRAP_SCRIPT = `(function(){
  try {
    var t = localStorage.getItem('theme');
    var dark = true;
    if (t === 'light') dark = false;
    else if (t === 'dark') dark = true;
    else if (t === 'system') {
      dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    } else {
      var h = parseInt(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hour12: false }), 10);
      dark = h < 7 || h >= 19;
    }
    if (dark) document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
  } catch (e) {
    document.documentElement.classList.add('dark');
  }
})();`;
