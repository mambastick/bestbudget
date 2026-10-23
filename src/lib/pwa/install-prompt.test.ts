import vm from "node:vm"
import { afterEach, describe, expect, it, vi } from "vitest"
import { getInstallState, INSTALL_PROMPT_BOOTSTRAP, INSTALL_STATE_EVENT, subscribeInstallState, takeInstallPrompt } from "./install-prompt"

function bootstrap() {
  const window = new EventTarget()
  vi.stubGlobal("window", window)
  vm.runInNewContext(INSTALL_PROMPT_BOOTSTRAP, { window, Event })
  return window
}

function promptEvent() {
  return Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
    prompt: vi.fn(async () => {}),
    userChoice: Promise.resolve({ outcome: "accepted" as const }),
  })
}

afterEach(() => vi.unstubAllGlobals())

describe("early PWA install capture", () => {
  it("retains an event before a subscriber exists and consumes it only once", () => {
    const window = bootstrap()
    const event = promptEvent()
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(getInstallState().prompt).toBe(event)
    expect(event.prompt).not.toHaveBeenCalled()
    expect(takeInstallPrompt()).toBe(event)
    expect(takeInstallPrompt()).toBeNull()
    expect(event.prompt).not.toHaveBeenCalled()
  })

  it("notifies mounted subscribers for later prompts, consumption and installation", () => {
    const window = bootstrap()
    const changed = vi.fn()
    const unsubscribe = subscribeInstallState(changed)
    const event = promptEvent()
    window.dispatchEvent(event)
    expect(changed).toHaveBeenCalledTimes(1)
    const snapshot = getInstallState()
    expect(getInstallState()).toBe(snapshot)
    expect(takeInstallPrompt()).toBe(event)
    expect(getInstallState()).not.toBe(snapshot)
    expect(changed).toHaveBeenCalledTimes(2)
    window.dispatchEvent(new Event("appinstalled"))
    expect(getInstallState()).toEqual({ prompt: null, installed: true })
    expect(changed).toHaveBeenCalledTimes(3)
    unsubscribe()
    window.dispatchEvent(promptEvent())
    expect(changed).toHaveBeenCalledTimes(3)
  })

  it("preserves pre-hydration installation and does not register duplicate global handlers", () => {
    const window = bootstrap()
    const changed = vi.fn()
    window.addEventListener(INSTALL_STATE_EVENT, changed)
    vm.runInNewContext(INSTALL_PROMPT_BOOTSTRAP, { window, Event })
    window.dispatchEvent(promptEvent())
    expect(changed).toHaveBeenCalledTimes(1)
    window.dispatchEvent(new Event("appinstalled"))
    expect(getInstallState()).toEqual({ prompt: null, installed: true })
    expect(takeInstallPrompt()).toBeNull()
    expect(changed).toHaveBeenCalledTimes(2)
  })
})
