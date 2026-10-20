export type ThemeMode = "light" | "dark" | "system";

let mediaQueryListener: (() => void) | null = null;

// Tailwind's dark: variant keys off the .dark class, the Design System
// tokens off data-theme: keep both in step.
function setDark(root: HTMLElement, dark: boolean) {
  root.classList.toggle("dark", dark);
  root.dataset.theme = dark ? "dark" : "light";
}

export function applyTheme(theme: ThemeMode) {
  const root = document.documentElement;

  // Remove any existing system listener
  if (mediaQueryListener) {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.removeEventListener("change", mediaQueryListener);
    mediaQueryListener = null;
  }

  if (theme === "dark") {
    setDark(root, true);
  } else if (theme === "light") {
    setDark(root, false);
  } else {
    // System: follow OS preference and listen for changes
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => setDark(root, mq.matches);
    apply();
    mediaQueryListener = apply;
    mq.addEventListener("change", apply);
  }
}
