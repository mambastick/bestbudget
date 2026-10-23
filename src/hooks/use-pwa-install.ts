"use client"

import { useSyncExternalStore } from "react"
import { getInstallState, INITIAL_INSTALL_STATE, subscribeInstallState, takeInstallPrompt } from "@/lib/pwa/install-prompt"

const serverSnapshot = () => INITIAL_INSTALL_STATE

export function usePwaInstall() {
  const state = useSyncExternalStore(subscribeInstallState, getInstallState, serverSnapshot)
  return { ...state, takePrompt: takeInstallPrompt }
}
