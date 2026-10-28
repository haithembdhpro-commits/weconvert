// Applied before React mounts so a dark-theme user never sees a light flash. External file: the CSP forbids inline scripts.
try { if (localStorage.getItem("wc-theme") === "dark") document.documentElement.classList.add("dark") } catch (e) {}
// Blue accent chosen on 28/10/2026: forget the orange preview stored by earlier builds.
try { localStorage.removeItem("wc-accent") } catch (e) {}
