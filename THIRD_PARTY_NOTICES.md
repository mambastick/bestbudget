# Third-party notices

BestBudget's original code is covered by the root [MIT license](LICENSE).
Vendored code retains the upstream terms below, including local modifications.
The MIT license for BestBudget does not relicense those files or remove their
Commons Clause restrictions. A distribution containing these components must
preserve these notices and license texts; it must not be described as entirely
MIT-licensed or as granting unrestricted rights to the vendored components.

License texts were checked against the primary upstream repositories on
2026-10-23 and are included verbatim in `LICENSES/`. The pinned commits below
identify the reviewed license snapshots, not the original component import
revisions, which were not recorded. Links to current upstream licenses are
provided alongside the snapshots.

## React Bits

- Files: `src/components/reactbits/CountUp.tsx` and
  `src/components/reactbits/SpotlightCard.tsx` (TypeScript + Tailwind variants,
  with local adaptations). `CountUp.test.ts` is a BestBudget test, not vendored code.
- Source: [DavidHDev/react-bits](https://github.com/DavidHDev/react-bits),
  [React Bits](https://reactbits.dev).
- License: **MIT + Commons Clause License Condition v1.0**, copyright
  (c) 2026 David Haz. This is the upstream's modified license, not plain MIT.
  The container's license metadata refers to it as `LicenseRef-React-Bits`.
- Full text: [local copy](LICENSES/react-bits.md),
  [reviewed snapshot](https://github.com/DavidHDev/react-bits/blob/e12c22192ac7b4b452c5e2feb9b586d74765d696/LICENSE.md),
  [current upstream](https://github.com/DavidHDev/react-bits/blob/main/LICENSE.md).

The license allows using, modifying and distributing the code as part of an
application, website or product, including commercial use. It prohibits selling,
sublicensing or redistributing the components themselves, whether standalone,
bundled or ported. It also restricts distributing the upstream tools, sounds and
standalone tool exports; the full text defines those restrictions. These
vendored React Bits files are distributed under that upstream license, not
under BestBudget's MIT grant. Do not extract and redistribute them as a component
library or template pack under MIT.

## Animate UI

- Files: all `src/components/animate-ui/icons/*.tsx`. The following
  `src/components/ui/` files also adapt Animate UI components alongside shadcn/ui:
  `alert-dialog.tsx`, `checkbox.tsx`, `dialog.tsx`, `dropdown-menu.tsx`,
  `popover.tsx`, `progress.tsx`, `select.tsx`, `sheet.tsx`, `sidebar.tsx`,
  `switch.tsx`, `tabs.tsx`, `toggle-group.tsx`, `toggle.tsx`, `tooltip.tsx`.
- Source: [imskyleen/animate-ui](https://github.com/imskyleen/animate-ui),
  [Animate UI](https://animate-ui.com). The wrappers use the
  `@animate-ui/react` package; version 2.0.0 includes the same license text.
- License: **MIT + Commons Clause License Condition**, copyright
  (c) 2025 Elliot Sutton. This also is not plain MIT.
  The container's license metadata refers to it as `LicenseRef-Animate-UI`.
- Full text: [local copy](LICENSES/animate-ui.md),
  [reviewed snapshot](https://github.com/imskyleen/animate-ui/blob/e6cea6b5ae5a4985d3bf3cc0ebea173555eafd72/LICENSE.md),
  [current upstream](https://github.com/imskyleen/animate-ui/blob/main/LICENSE.md).

The license permits use and distribution as part of an application, website or
product, including commercial use, but prohibits selling or redistributing the
components themselves in their original form, alone or bundled. Its wording
differs from React Bits; consult its own full text. BestBudget's MIT license does
not override this restriction or relicense the Animate UI portions of the files.

## shadcn/ui

- Files: `src/components/ui/*.tsx`, based on the Base UI / base-nova registry,
  with local adaptations and the Animate UI integrations listed above.
- Source: [shadcn-ui/ui](https://github.com/shadcn-ui/ui),
  [shadcn/ui](https://ui.shadcn.com).
- License: **MIT License**, copyright (c) 2023 shadcn.
- Full text: [local copy](LICENSES/shadcn-ui.md),
  [reviewed snapshot](https://github.com/shadcn-ui/ui/blob/3d98900e9b73c45f035f8109e9d41ba6a51685e7/LICENSE.md),
  [current upstream](https://github.com/shadcn-ui/ui/blob/main/LICENSE.md).

Preserve the upstream copyright and permission notice when copying or
distributing substantial portions. Animate UI portions retain their additional
terms described above.

## Lucide / Feather icon artwork

- Files: SVG artwork in `src/components/animate-ui/icons/*.tsx`, distributed
  through [Animate UI's Lucide icons](https://animate-ui.com/docs/icons).
- Source: [lucide-icons/lucide](https://github.com/lucide-icons/lucide), with
  some icons derived from [Feather](https://github.com/feathericons/feather).
- License: **ISC License**, copyright (c) 2026 Lucide Icons and Contributors;
  **MIT License** for the Feather-derived icons listed in the upstream license,
  copyright (c) 2013-present Cole Bemis.
- Full text, including that list: [local copy](LICENSES/lucide.txt),
  [reviewed snapshot](https://github.com/lucide-icons/lucide/blob/20aef31db93fe4d9f398dbb15b120d99c48eef95/LICENSE),
  [current upstream](https://github.com/lucide-icons/lucide/blob/main/LICENSE).

Preserve both notices for the included artwork. The animation code also retains
Animate UI's terms above.

## Package dependencies

This document covers the copied source and icon artwork described above, not a
complete dependency license inventory. Other packages listed in `package.json`
and `pnpm-lock.yaml` retain their own licenses; preserve the notices supplied
with them when redistributing packages or bundles.
