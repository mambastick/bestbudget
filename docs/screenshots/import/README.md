# Импорт — синтетическая браузерная проверка

Скриншоты из `e2e/imports.spec.ts`, Chromium на production standalone-сборке:

- `import-preview-375.png` — карточки при ширине 375px; проверяется `document.documentElement.scrollWidth <= innerWidth`.
- `import-preview-desktop.png` — предпросмотр с MCC-категорией и решениями.
- `import-duplicates-desktop.png` — повтор того же CSV, строка по умолчанию пропускается.

Данные полностью синтетические: `owner@e2e.test`, `SYNTHETIC IMPORT SHOP`. Это подтверждение UI и собственного формата, не приёмка реальной банковской выгрузки. Отдельный e2e проверяет XLSX через production upload-route и отклонение чужого Origin.

Воспроизведение: `npx -y pnpm@10.27.0 test:e2e`; результаты появляются в `work/import-*.png`. Порты 3200/54330 должны быть свободны. Для собственного кеша браузера задайте `PLAYWRIGHT_BROWSERS_PATH` в дисковой временной директории и предварительно выполните `pnpm exec playwright install chromium`.
