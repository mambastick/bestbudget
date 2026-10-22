/** The app mark rendered by next/og (PNG icons). Inline styles only: ImageResponse supports a CSS subset. */
export function BrandIconImage({ size, padded }: { size: number; padded?: boolean }) {
  const inner = padded ? size * 0.62 : size
  return (
    <div style={{ width: size, height: size, display: "flex", alignItems: "center", justifyContent: "center", background: "#3b5bdb", borderRadius: padded ? 0 : size * 0.22 }}>
      <svg width={inner * 0.72} height={inner * 0.72} viewBox="0 0 32 32">
        <path d="M9 21.5V10.5h7.2c2.4 0 3.9 1.2 3.9 3 0 1.2-.7 2.1-1.8 2.5 1.4.3 2.4 1.4 2.4 2.8 0 2-1.6 3.2-4.2 3.2H9Z" fill="none" stroke="#fff" strokeWidth={2.2} strokeLinejoin="round" />
        <circle cx="23.5" cy="21.5" r="2" fill="#69db7c" />
      </svg>
    </div>
  )
}
