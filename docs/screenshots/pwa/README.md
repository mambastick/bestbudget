# Проверка PWA · 23 октября 2026

Все изображения созданы Playwright на production-сборке из синтетического `seed-demo`; настоящих финансов и банковских реквизитов нет. Телефон: viewport 375×812, DPR 2, `isMobile`, `hasTouch`, UA iPhone. `navigator.standalone` задаётся тестом; inset 47/34 px, вырез и home indicator на standalone-снимках — иллюстрация поверх Chromium, а не настоящий iOS. Проверка WebKit/устройства остаётся у владельца: [чек-лист](../../pwa.md#воспроизводимые-проверки).

- `iphone-light/dark.png` — обзор, safe-area шапки/FAB.
- `iphone-login.png` — вход и выбор темы ниже выреза; Keycloak — mock IdP из acceptance.
- `iphone-dialog-light/dark.png`, `iphone-footer-light/dark.png` — форма операции и прокрученный footer над home indicator.
- `iphone-sidebar-light/dark.png` — безопасные отступы боковой панели.
- `install-ios-safari.png`, `install-ios-chrome.png`, `install-en.png` — инструкции установки.
- `../../../public/screenshots/dashboard-{narrow,wide}.png` — картинки manifest (750×1624 и 1280×800), без имитации аппаратного выреза.

## Lighthouse

[Lighthouse JSON](lighthouse-pwa.json): **PWA 100/100**, шесть автоматических аудитов прошли: `viewport`, `installable-manifest`, `splash-screen`, `themed-omnibox`, `maskable-icon`, `content-width`. Ошибок выполнения и предупреждений нет. Три manual-пункта не имеют оценки и требуют ручной приёмки.

Запуск: Lighthouse **11.7.1**, Chromium 156, production standalone `/setup` на `http://localhost:3300`, отдельная пустая PGlite БД 54340. Версия 11 выбрана явно: в Lighthouse 12 категорию PWA [удалили](https://developers.google.com/speed/docs/insights/release_notes#may_10_2024). Эта оценка не заменяет проверки текущего install UI, реального iOS и OIDC.

```bash
export TMPDIR=/var/tmp/codex-golodn1y/bestbudget-pwa
CHROME_PATH=/path/to/chrome npx -y lighthouse@11.7.1 \
  http://localhost:3300/setup --only-categories=pwa \
  --chrome-flags="--headless --no-sandbox --disable-dev-shm-usage" \
  --output=json --output-path="$TMPDIR/lighthouse-pwa.json"
```

Для повторения изображений: `npx -y pnpm@10.27.0 test:e2e e2e/pwa.spec.ts`. Порты 3200/54330 должны быть свободны.

## Локальные gates

- `typecheck`, `lint`, `i18n:check`, `build` — успешно. i18n: 21 namespace, 1660 ключей, 0 ошибок; пять предупреждений о потенциально неиспользуемых динамических ключах.
- `test` на `2026-10-23T09:00:00Z`, `2026-11-01T09:00:00Z`, `2026-12-31T20:30:00Z` — по **368/368**, 43 файла.
- Полный `test:e2e` на production standalone — **28/28**, включая 9 PWA-сценариев и OIDC callback с флагом standalone.
- PWA `test:e2e e2e/pwa.spec.ts --repeat-each=3` — **27/27**.
- Docker/Helm локально не запускались; Docker проверяет CI. Реальных iOS/Android/desktop установок и production IdP в этом прогоне не было.

Проверки выполнены после переноса на main `a942071` с PR #20, #21 и #22. Во время работы e2e откладывался из-за занятых параллельной веткой портов; чужие процессы не останавливались. Сообщения Better Auth об отказе неизвестной/непривязанной OIDC-учётной записи относятся к ожидаемым отрицательным acceptance-сценариям.

PWA e2e использует общий `BROWSER_TIMEZONE=Asia/Vladivostok`, сервер — `TZ=UTC`. Общий fixture проверяет runtime/hydration ошибки во всех browser contexts; английские «Back»/«Install app» и офлайн ru/en проверяются явно.

## Раннее событие установки

PWA e2e блокирует загрузку React-бандлов управляемым Promise и отправляет `beforeinstallprompt` до гидрации. Проверяется настоящий перехват скриптом из `<head>` с действующей CSP, сохранение события, prompt только после клика и его однократное потребление. Отдельно проверены событие после гидрации и `appinstalled` до неё. Произвольных задержек и повторного диспатча потерянного prompt нет.

При первичных прогонах setup PWA один раз вернул onboarding после seed: fixture теперь отдельно подтверждает доступность seeded dashboard и сохраняет проверенные cookie. Полный прогон выявил неоднозначные текстовые локаторы правил в acceptance; они заменены на доступные кнопки конкретных правил, а локатор баланса выбирает видимую карточку вместо скрытой потоковой копии. Проверки сумм и гидрации сохранены. Артефакты Playwright вынесены за пределы исходников через `E2E_OUTPUT_DIR`, чтобы lint не читал создаваемые/удаляемые trace-файлы.
