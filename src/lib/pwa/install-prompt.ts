export interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}

export interface InstallState {
  prompt: InstallPromptEvent | null
  installed: boolean
}

declare global {
  interface Window {
    __bbInstallState?: InstallState
  }
}

export const INSTALL_STATE_EVENT = "bb:pwa-install-state"
export const INITIAL_INSTALL_STATE: InstallState = { prompt: null, installed: false }

// Parser-executed in <head>: capture browser events before any React bundle or effect can run.
export const INSTALL_PROMPT_BOOTSTRAP = `(()=>{
  if(window.__bbInstallState)return;
  window.__bbInstallState={prompt:null,installed:false};
  window.addEventListener("beforeinstallprompt",event=>{
    event.preventDefault();
    window.__bbInstallState={prompt:event,installed:false};
    window.dispatchEvent(new Event("${INSTALL_STATE_EVENT}"));
  });
  window.addEventListener("appinstalled",()=>{
    window.__bbInstallState={prompt:null,installed:true};
    window.dispatchEvent(new Event("${INSTALL_STATE_EVENT}"));
  });
})();`

export function getInstallState(): InstallState {
  return window.__bbInstallState ?? INITIAL_INSTALL_STATE
}

export function subscribeInstallState(listener: () => void) {
  window.addEventListener(INSTALL_STATE_EVENT, listener)
  return () => window.removeEventListener(INSTALL_STATE_EVENT, listener)
}

/** Consume synchronously from the shared store, including double clicks before React renders again. */
export function takeInstallPrompt() {
  const state = getInstallState()
  if (!state.prompt) return null
  window.__bbInstallState = { ...state, prompt: null }
  window.dispatchEvent(new Event(INSTALL_STATE_EVENT))
  return state.prompt
}
