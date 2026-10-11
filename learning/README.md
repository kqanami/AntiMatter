# Задания 1–8: Solana Devnet

Это учебная часть ANTIMATTER. Все SOL здесь тестовые и используются только в Devnet. Страница `learning.html` показывает подтверждённый перевод, позволяет разобрать произвольную Devnet-транзакцию, проверить токен AMT, читать состояние PDA и открыть работающий MVP.

| Задание | Реализация | Проверка |
| --- | --- | --- |
| 1. Кошелёк и первый перевод | `scripts/learning/first-transfer.ts` | [Транзакция 0,001 SOL в Explorer](https://explorer.solana.com/tx/KwgF96gR19aV2ZeF7iF2rr6YBqsykHD96LtDXWSHonmxeTJaJYDm4er2mC466B7D2NWz2DY8BooxJQ79PzGjwkD?cluster=devnet), `verification/learning-first-transfer.json` |
| 2. Transaction Detective | `scripts/learning/inspect-transaction.ts` и браузерная страница | `verification/learning-transaction-analysis.json`: три account, System Program, `transfer`, комиссия 5 000 lamports |
| 3. Rust CLI | `rust-cli/` | `cargo check`; выполнены команды `balance` и `tx` на реальном Devnet RPC |
| 4. Первая Solana Program | `anchor/programs/antimatter_learning/`, инструкция `ping` | [SBF-сборка](https://github.com/kqanami/AntiMatter/actions/runs/38156009096), `verification/learning-program-deploy.json` и вызов `ping` в `verification/learning-program-calls.json` |
| 5. Anchor Counter | Там же, `initialize_counter` / `increment_counter`; клиент `scripts/learning/client.ts` | `verification/learning-program-calls.json`: создание PDA, увеличение и итоговое значение счётчика |
| 6. PDA-профиль | Там же, `create_profile` / `update_profile`, PDA из `profile` + адреса владельца | `verification/learning-program-calls.json`: создание, обновление и чтение on-chain профиля |
| 7. SPL Token и метаданные | [AMT mint](https://explorer.solana.com/address/GTYjjjnW9hcLg1UrgfZBfpL4BXP74eJcZ9TWDeguL9MR?cluster=devnet), `scripts/learning/token.ts`, `token/metadata.json`, перевод через `TransferChecked` | `verification/learning-week7-token.json`, `verification/learning-week7-metadata.json`; mint, supply и metadata проверяются в Devnet |
| 8. Web3 MVP | `desktop.html` — два экранных устройства, сверка кода, локальная подпись, перевод AMT и подтверждение в Devnet | `verification/learning-week8-mvp.json`; проверка реального зачисления через путь приложения |

Секретные ключи хранятся только в `.devnet/` (каталог исключён из Git), исходники и отчёты содержат только публичные адреса. **Не используйте ключи основной сети или кошелёк с реальными средствами.**

## Неделя 7: токен AMT и метаданные

В Devnet уже существует обычный SPL Token mint `GTYjjjnW9hcLg1UrgfZBfpL4BXP74eJcZ9TWDeguL9MR` с точностью 9 знаков и выпуском 1000 AMT. Код выпуска находится в `scripts/create-devnet-token.ts`, путь выдачи и перевода — в `scripts/send-devnet-amt.ts` и `src/amt.ts`. Приложение создаёт Associated Token Account получателя при необходимости, подписывает `TransferChecked` и проверяет факт зачисления после подтверждения транзакции. Клиент учебной страницы независимо читает supply и адрес on-chain метаданных.

Метаданные Metaplex привязаны к тому же mint. Публичный JSON и изображение хранятся в `learning/token/`; ключ mint authority остаётся только в `.devnet/`. Команды:

```bash
pnpm learning:token status
pnpm learning:token metadata:create
```

Вторая команда идемпотентна: если аккаунт метаданных уже существует с теми же полями, транзакция не повторяется; если поля отличаются, она останавливается. Для публикации JSON и изображения сначала требуется отправить их в публичный репозиторий GitHub, иначе команда откажется создавать on-chain запись с недоступным URI. Скрипт проверяет genesis hash Devnet, mint authority, точность и supply перед любой записью.

## Неделя 8: мини-хакатон и MVP

`desktop.html` запускает два независимых экранных кошелька в одном браузере. Отправитель выбирает AMT, получатель принимает предложение, оба сверяют короткий код, отправитель жестом подтверждает операцию. Подпись создаётся тестовым ключом отправителя, а результат показывается после проверки подтверждения и прироста AMT на ATA получателя. История содержит ссылку в Explorer. Это рабочий Web3-сценарий в Devnet; браузерная связь сама по себе не доказывает, что реальные телефоны находятся рядом.

```bash
pnpm build
pnpm desktop
# открыть http://127.0.0.1:5174/desktop.html
```

Для повторяемой сетевой проверки кода передачи без ручного прохождения UI есть `pnpm exec tsx scripts/verify-devnet-amt.ts`. Скрипт создаёт временные тестовые кошельки, выдаёт отправителю 2 AMT и немного Devnet SOL, выполняет тот же путь подготовки, подписи, отправки и сверки, которым пользуется приложение, и сохраняет публичное доказательство в `verification/learning-week8-mvp.json`. Каждая новая проверка расходует тестовые средства; готовый отчёт и ссылку Explorer можно смотреть без повторного запуска.

## Запуск страницы и первых трёх заданий

Из корня проекта:

```bash
pnpm install
pnpm dev
```

Откройте `http://127.0.0.1:5173/learning.html`. Если Devnet RPC временно недоступен, сохранённый отчёт и ссылка Explorer остаются доступны; живой разбор транзакции потребует подключения.

Первый перевод уже сделан. `pnpm learning:transfer` повторно использует подтверждённую транзакцию, если она найдена в Devnet; при отсутствии отчёта создаёт локальные учебные ключи и пытается получить тестовые SOL через faucet. Если faucet ограничил выдачу, можно указать путь к **другому тестовому** кошельку в `LEARNING_FUNDER_KEYPAIR`. Повторное создание перевода расходует тестовые SOL и не нужно для проверки текущего результата.

```bash
pnpm learning:inspect KwgF96gR19aV2ZeF7iF2rr6YBqsykHD96LtDXWSHonmxeTJaJYDm4er2mC466B7D2NWz2DY8BooxJQ79PzGjwkD
cargo run --manifest-path learning/rust-cli/Cargo.toml -- tx KwgF96gR19aV2ZeF7iF2rr6YBqsykHD96LtDXWSHonmxeTJaJYDm4er2mC466B7D2NWz2DY8BooxJQ79PzGjwkD
```

Rust CLI использует установленный `curl` для HTTPS. Команды: `balance ADDRESS`, `account ADDRESS`, `program ADDRESS`, `tx SIGNATURE`. Каждая команда сначала проверяет genesis hash Devnet.

## Сборка и развёртывание заданий 4–6

Программа собрана в SBF в GitHub Actions: бинарник `learning/build/antimatter_learning.so`, IDL `learning/idl/antimatter_learning.json`, SHA-256 и адрес — в `verification/learning-sbf-build.json`. Сборка использует Solana CLI и Anchor CLI 1.2.0 на Linux. Program ID при сборке берётся из зашифрованного секрета GitHub Actions `LEARNING_PROGRAM_KEYPAIR`; приватный ключ отсутствует в Git. Для повторной локальной сборки на Mac, Linux или WSL установите инструменты по [инструкции Solana](https://solana.com/docs/intro/installation) и [инструкции Anchor](https://www.anchor-lang.com/docs/installation).

На Windows готовый SBF можно отправить в Devnet командой `pnpm learning:deploy deploy`. Она проверяет genesis hash, SHA-256 и Program ID, загружает бинарник по частям в восстанавливаемый буфер и создаёт исполняемый аккаунт. Команда `pnpm learning:deploy upgrade` обновляет уже развёрнутую программу. Ключи и прогресс хранятся только в игнорируемой `.devnet/`. При ограничении публичного RPC повторите команду: уже подтверждённые части не загружаются заново. `LEARNING_RPC_URL` задаёт иной HTTPS RPC Devnet.

Если переносите проект на другой компьютер **с сохранением прежнего Program ID**, перенесите в защищённом виде `.devnet/learning-program-keypair.json` и `.devnet/learning-wallet.json`. Не добавляйте их в репозиторий или публичный архив. Если не переносить эти файлы, `learning:prepare` создаст новые ключи и автоматически обновит Program ID в Rust, Anchor.toml, веб-клиенте и предварительном IDL; прежний ID тогда использовать нельзя.

В корне проекта:

```bash
pnpm install
pnpm learning:prepare
solana config set --url devnet
solana address --keypair .devnet/learning-wallet.json
solana balance --keypair .devnet/learning-wallet.json --url devnet
```

Пополните выведенный адрес тестовыми SOL через [официальный faucet](https://faucet.solana.com/) или `solana airdrop` и проверьте баланс. На развёртывание программы требуется больше SOL, чем на обычный перевод; faucet может ограничивать выдачу. Нужны только Devnet SOL.

```bash
cd learning/anchor
anchor build
anchor deploy --provider.cluster devnet
cd ../..
pnpm learning:idl:sync
pnpm learning:client status
pnpm learning:client ping
pnpm learning:client counter:init
pnpm learning:client counter:increment
pnpm learning:client counter:show
pnpm learning:client profile:create "Имя" "Учебный профиль"
pnpm learning:client profile:update "Имя" "Обновлённое описание"
pnpm learning:client profile:show
```

Команда `pnpm learning:verify-program` последовательно вызывает все пять инструкций в Devnet и сохраняет адреса PDA, подписи транзакций и итоговое состояние в `verification/learning-program-calls.json`. Повторный запуск увеличивает счётчик ещё на один и расходует тестовые SOL.

`learning:prepare` копирует ключ программы в стандартный каталог `learning/anchor/target/deploy/`, который Anchor использует при развёртывании. `learning:idl:sync` принимает только IDL с тем же Program ID и всеми пятью ожидаемыми инструкциями. После сборки он заменяет предварительный IDL реально сгенерированным Anchor IDL. Для клиента по умолчанию используется `.devnet/learning-wallet.json`; другой тестовый ключ можно задать переменной `LEARNING_KEYPAIR`. После развёртывания откройте `learning.html`, введите адрес этого кошелька и проверьте счётчик и профиль. Ссылки на транзакции команд выводятся в Solana Explorer.

Если `anchor deploy` не хватило SOL, пополните кошелёк и повторите. Перед созданием профиля учтите, что его имя и описание публичны в блокчейне. В программе имя ограничено 32 байтами UTF-8, описание — 160 байтами; `has_one`, signer и PDA seeds защищают изменение чужого профиля. Счётчик увеличивается через `checked_add`.

Документация: [развёртывание Solana Program](https://solana.com/docs/programs/deploying), [PDA](https://solana.com/docs/core/pda), [Anchor PDA constraints](https://www.anchor-lang.com/docs/basics/pda).
