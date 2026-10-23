export const PWA_COLORS = { light: "#f9fafb", dark: "#0a0c10" } as const

// CSS screen dimensions and pixel ratio; covers SE, notched iPhones and common iPads.
export const SPLASH_SCREENS = [
  [320, 568, 2], [375, 667, 2], [414, 736, 3], [375, 812, 3],
  [390, 844, 3], [393, 852, 3], [402, 874, 3], [414, 896, 3],
  [428, 926, 3], [430, 932, 3], [440, 956, 3],
  [768, 1024, 2], [810, 1080, 2], [820, 1180, 2], [834, 1194, 2],
  [1024, 1366, 2], [1032, 1376, 2],
] as const
