import pkg from "../../package.json"

/** Application version from package.json, embedded at build time. */
export const APP_VERSION: string = pkg.version
export const IS_PRERELEASE = APP_VERSION.includes("-")
