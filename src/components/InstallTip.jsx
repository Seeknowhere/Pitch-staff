// A small, dismissible "put Tono on your home screen" tip.
// Android/Chrome: a real Install button. iPhone Safari: how to add it (Apple has no button for it).
import { useEffect, useState } from "react";

const KEY = "tono.installtip.v1";

const standalone = () =>
  window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone === true;
const isIOS = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

export function InstallTip() {
  const [prompt, setPrompt] = useState(null);
  const [hidden, setHidden] = useState(() => {
    try {
      return !!localStorage.getItem(KEY);
    } catch (e) {
      return false;
    }
  });

  useEffect(() => {
    const onPrompt = (e) => {
      e.preventDefault();
      setPrompt(e);
    };
    const onInstalled = () => close();
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  function close() {
    setHidden(true);
    try {
      localStorage.setItem(KEY, "1");
    } catch (e) {}
  }

  if (hidden || standalone()) return null;
  const ios = isIOS();
  if (!prompt && !ios) return null;

  return (
    <div className="install-tip" role="note">
      <img src="./icons/icon-192.png" alt="" width="36" height="36" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <b>Get Tono on your home screen</b>
        <span className="text-xs muted" style={{ display: "block" }}>
          {prompt
            ? "Opens like an app, full screen."
            : "Tap the Share button, then “Add to Home Screen”."}
        </span>
      </div>
      {prompt && (
        <button
          className="btn btn-primary"
          onClick={async () => {
            prompt.prompt();
            const r = await prompt.userChoice.catch(() => null);
            setPrompt(null);
            if (r && r.outcome === "accepted") close();
          }}
        >
          Install
        </button>
      )}
      <button className="btn btn-ghost" aria-label="Not now" onClick={close}>
        ✕
      </button>
    </div>
  );
}
