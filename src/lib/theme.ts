export type ThemeMode = "light" | "dark" | "system";

let mediaQueryListener: (() => void) | null = null;

export function applyTheme(theme: ThemeMode) {
  const root = document.documentElement;

  // Remove any existing system listener
  if (mediaQueryListener) {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.removeEventListener("change", mediaQueryListener);
    mediaQueryListener = null;
  }

  if (theme === "dark") {
    root.classList.add("dark");
  } else if (theme === "light") {
    root.classList.remove("dark");
  } else {
    // System: follow OS preference and listen for changes
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      if (mq.matches) {
        root.classList.add("dark");
      } else {
        root.classList.remove("dark");
      }
    };
    apply();
    mediaQueryListener = apply;
    mq.addEventListener("change", apply);
  }
}
