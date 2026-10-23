export function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
}

export function installPlatform() {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  if (!ios) return "browser"
  return /Safari/.test(navigator.userAgent) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(navigator.userAgent) ? "iosSafari" : "iosOther"
}

export function subscribeStandalone(listener: () => void) {
  const media = window.matchMedia("(display-mode: standalone)")
  media.addEventListener("change", listener)
  window.addEventListener("pageshow", listener)
  return () => {
    media.removeEventListener("change", listener)
    window.removeEventListener("pageshow", listener)
  }
}
