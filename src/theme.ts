/**
 * Light and dark mode. Without a choice the site follows the device setting (and keeps following
 * it as it changes); the header switch stores an explicit choice in this browser.
 */

export type ThemeChoice = "light" | "dark" | null;

const KEY = "stormx-theme";

export function resolveDark(choice: ThemeChoice, deviceDark: boolean): boolean {
  return choice === null ? deviceDark : choice === "dark";
}

function stored(): ThemeChoice {
  try {
    const value = window.localStorage.getItem(KEY);
    return value === "dark" || value === "light" ? value : null;
  } catch {
    return null;
  }
}

export function setUpTheme(onChange: (dark: boolean) => void): () => boolean {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let choice = stored();
  let dark = resolveDark(choice, media.matches);
  const toggles = document.querySelectorAll<HTMLElement>("[data-theme-toggle]");

  const apply = () => {
    dark = resolveDark(choice, media.matches);
    document.body.classList.toggle("calcite-mode-dark", dark);
    document.body.classList.toggle("calcite-mode-light", !dark);
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
    toggles.forEach((toggle) => {
      toggle.setAttribute("icon", dark ? "brightness" : "moon");
      toggle.setAttribute("text", dark ? "Switch to light mode" : "Switch to dark mode");
      toggle.setAttribute("aria-pressed", String(dark));
    });
    onChange(dark);
  };

  toggles.forEach((toggle) =>
    toggle.addEventListener("click", () => {
      choice = dark ? "light" : "dark";
      try {
        window.localStorage.setItem(KEY, choice);
      } catch {
        // Storage blocked: the choice lasts for this page only.
      }
      // Cross-fade instead of a sudden brightness jump.
      const doc = document as Document & { startViewTransition?: (update: () => void) => unknown };
      if (doc.startViewTransition && !reducedMotion.matches) doc.startViewTransition(apply);
      else apply();
    }),
  );
  media.addEventListener("change", () => {
    if (choice === null) apply();
  });
  apply();
  return () => dark;
}
