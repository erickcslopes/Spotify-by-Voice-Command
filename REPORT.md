# Implementation Report

## Implementado

Bases do Spotify Voice Assistant conforme a especificação: aplicativo local-first com Intent Engine determinístico, camada Spotify isolada e fallback Grok validado por schema. Fase 4 concluída: captura real de microfone (Tauri/cpal) + transcrição local com whisper.cpp + push-to-talk. Fase 5 concluída: tray, hotkey global configurável, settings persistentes pela interface, login Spotify via UI, build release + instalador Windows (NSIS). A lógica central funciona por texto (CLI/UI) e por voz (desktop Tauri).

## Arquivos criados

- `package.json`, `tsconfig.json`, `vitest.config.ts`, `vite.config.ts`
- `.env.example`, `.gitignore`, `index.html`
- `src/intents/types.ts` — tipo único `Intent` + `IntentResult`
- `src/intents/normalizer.ts` — `normalizeInput` (raw/text/ascii)
- `src/intents/patterns.ts` — aliases, regex, confidence, detecção de fala vaga/composta
- `src/intents/localParser.ts` — parser determinístico
- `src/intents/intentRouter.ts` — roteamento local vs IA
- `src/intents/schemas.ts` — schemas Zod (validação da IA e das intents)
- `src/spotify/spotifyAuth.ts` — PKCE + `SpotifyAuthClient` (login com callback local)
- `src/spotify/tokenStore.ts` — `FileTokenStore`
- `src/spotify/spotifyApi.ts` — camada HTTP com auto-refresh e erro de device
- `src/spotify/spotifyPlayer.ts`, `src/spotify/spotifySearch.ts` — endpoints
- `src/spotify/spotifyController.ts` — `Intent` → ações
- `src/spotify/types.ts`
- `src/ai/grokClient.ts`, `src/ai/prompt.ts`, `src/ai/aiIntentParser.ts`, `src/ai/types.ts`
- `src/voice/types.ts`, `src/voice/speechToText.ts`, `src/voice/voiceService.ts`, `src/voice/voicePipeline.ts`, `src/voice/providers/localWhisper.ts`
- `src/config/defaults.ts`, `src/config/config.ts`
- `src/settings/schema.ts`, `src/settings/stores.ts` — schema Zod + stores de settings (Node/Tauri/Memory)
- `src/platform/env.ts`, `src/platform/http.ts` — detecção de runtime e fetch sem CORS (plugin-http)
- `src/voice/hotkeyController.ts` — lógica de hotkey testável isoladamente
- `src/feedback/feedbackService.ts`
- `src/errors.ts` — erros de domínio
- `src/app/state.ts`, `src/app/bootstrap.ts`
- `src/main.ts` — CLI (modo texto)
- `src/ui/main.ts`, `src/ui/style.css`
- `config/commands.json` — aliases editáveis
- `src-tauri/` — scaffold Tauri 2 (config, Cargo.toml, main/lib, commands, audio, tray, settings, hotkey)
- `src-tauri/src/settings.rs` — settings persistentes, keyring, servidor de callback OAuth, validação do whisper
- `src-tauri/src/hotkey.rs` — hotkey global (plugin) + eventos para o frontend
- `src-tauri/capabilities/default.json` — permissões (http, dialog, autostart)
- `tests/` — helpers + testes por camada
- `README.md`, `AGENTS.md`, `REPORT.md`

## Arquivos alterados

- `README.md` — reescrito para refletir a nova arquitetura
- `.gitignore` — mantém `/Legacy` ignorado; adiciona node_modules/dist/env/logs

## Arquitetura

```text
voz/texto → SpeechToText → normalizer → IntentRouter
                                          ├─ local parser (≥ threshold) → executar
                                          └─ fallback Grok → Zod → executar
                    IntentRouter → SpotifyController → SpotifyApi → Spotify Web API
```

Cada camada é isolada e testável. A IA nunca toca o Spotify: devolve JSON validado por `AllowedIntentSchema`.

## Intent parser

- Alias exato → confidence 1.0
- Regex específica (volume, playlist, música+artista, artista) → 0.95
- Fala vaga (`alguma coisa`, `parecida`, `aquela`, …) ou comando composto (`playlist + volume`) → confidence 0.4–0.5 (fallback IA)
- Sem correspondência → 0 (fallback IA)
- Volume fora de 0–100 é clampeado.

## Spotify

- OAuth Authorization Code + PKCE; callback local em `127.0.0.1:PORT/callback`
- Tokens persistidos em `~/.spotify-voice-assistant/tokens.json` (fora do repo)
- `SpotifyApi` renova token em 401 e converte "NO_ACTIVE_DEVICE" em erro de domínio amigável
- Busca prioriza playlists do usuário antes da busca global

## Grok

- `GrokClient` isolado (endpoint/modelo configuráveis), timeout, `response_format: json_object`
- Prompt mínimo em português; sem histórico; `max_tokens` limitado
- `AiIntentParser` valida o retorno com Zod; ações inventadas ou fora do intervalo são rejeitadas

## Speech-to-Text

- Interface `SpeechToTextProvider` genérica, baseada em **caminho de arquivo**: `transcribe(audioPath)`
- `LocalWhisperProvider` (Node/CLI) chama o binário do whisper.cpp com modelo local
- Trocar o provider não exige alterar `intents/` nem `spotify/`

## Fase 4 — Voz (whisper.cpp + push-to-talk)

### Captura
- **Rust/cpal 0.15** no Tauri: `AudioRecorder` captura do dispositivo padrão de entrada.
- O `cpal::Stream` não é `Send`; a captura roda em **thread dedicada** (stream nunca cruza threads). O estado gerenciado pelo Tauri guarda apenas `Arc<Mutex<Vec<i16>>>` + flag de parada + `JoinHandle`.
- Conversão pós-captura: estéreo→mono (média) e **resample linear** para **WAV mono PCM 16 kHz** (formato esperado pelo whisper.cpp). Header WAV escrito manualmente (sem dependência extra).
- Gravações < `MIN_RECORDING_MS` (300 ms) são descartadas no pipeline TS.

### Transcrição
- Comandos Tauri: `start_recording`, `stop_recording` (retorna `{ path, duration_ms }`), `is_recording`, `transcribe_audio`.
- `transcribe_audio` spawna o whisper.cpp com `WHISPER_BIN`/`WHISPER_MODEL` (ou `WHISPER_MODEL_PATH`), timeout `WHISPER_TIMEOUT_MS`, e retorna só o texto limpo. Binário/modelo ausentes → erros amigáveis (nunca cai no Grok).

### Integração
- Ponto único de processamento: `processCommand(text)` (CLI, UI web e voz terminam nele); `AppState.lastIntent` registra a última intenção.
- `VoicePipeline` orquestra push-to-talk: estados `idle/recording/transcribing/processing/success/error`, concorrência bloqueada (uma gravação/transcrição por vez), silêncio → "Não detectei nenhum comando.".
- **Nenhum áudio vai à IA** — apenas texto quando o parser local falhar (Grok continua sendo o último recurso).

### UI
- Botão **🎤 Falar** (push-to-talk: pointerdown grava, pointerup transcreve), feedback visual por estado, última transcrição/intenção/resultado.
- No navegador (`npm run dev`) não há microfone: o botão apenas exibe aviso; a entrada é textual.

### Testes (63 no total, 8 arquivos)
- `tests/voice/voicePipeline.test.ts` — 5 casos (concorrência, silêncio, min duration, erro, sucesso)
- `tests/voice/voiceService.test.ts` — 1 caso (silêncio não cai no Grok)
- `tests/voice/voiceIntegration.test.ts` — 1 caso (fluxo completo com mocks)
- `tests/voice/localWhisper.test.ts` — 6 casos (binário/modelo ausentes, timeout, sucesso, texto limpo) — mock de `child_process`

### Dependências
- Rust: `cpal = "0.15"` (+ deps transitivas). TS/UI: sem novas deps de runtime.
- Ícone do app gerado em `src-tauri/icons/icon.ico` (exigido pelo `tauri-build` no Windows).

### Validação executada neste ambiente
- `npm run typecheck` ✅ · `npm test` ✅ (63/63) · `npm run build` ✅ (Vite)
- `cargo check` ✅ e `cargo build` ✅ em `src-tauri` (MSVC via cargo)
- `npm run tauri dev` inicia a janela desktop ✅ (foi necessário excluir `src-tauri/**` do watcher do Vite — EBUSY ao observar a DLL do Rust)
- Binário `spotify-voice-assistant.exe` compila e abre ✅
- **Não testado aqui**: whisper.cpp real (binário não instalado) e microfone físico — depende de máquina com áudio.

## Fase 5 — Desktop (tray, hotkey, settings, build)

### Settings
- Schema Zod em `src/settings/schema.ts` (geral, voz, whisper, IA, Spotify); inválidas → defaults seguros via `configFromSettings`.
- Precedência: **settings > .env > defaults**. `pick()` em `config.ts` faz o `.env` atuar como fallback apenas enquanto a settings ainda está no default (preserva o fluxo de desenvolvimento).
- Stores: `NodeSettingsStore` (CLI, escrita atômica temp+rename em `~/.spotify-voice-assistant/settings.json`), `TauriSettingsStore` (invoca comandos Rust), `MemorySettingsStore` (navegador).

### Segredos
- Chave da IA no **keyring do sistema** (Rust `keyring` v4, serviço `com.spotifyvoiceassistant.app`, conta `xai_api_key`), com fallback `XAI_API_KEY` do env; UI mostra apenas "Configurada". Nunca vai para settings/logs.
- Tokens do Spotify continuam em `~/.spotify-voice-assistant/tokens.json` (fora do repo), com `TauriTokenStore`/`token_load|save|clear` no Rust.

### Hotkey global
- `tauri-plugin-global-shortcut` com handler único em `hotkey.rs` (emite `voice:hotkey-down`/`voice:hotkey-up`; a UI chama `VoicePipeline.start/stop`).
- `hotkey_set` registra a nova combinação antes de remover a antiga — em conflito, mantém a anterior e retorna erro amigável.
- Botão 🎤, hotkey e tray convergem no **mesmo** `VoicePipeline`.

### Tray / Janela / Startup
- Tray: menu (Falar, Abrir, Configurações, Sair); `cleanup` para gravação e remove a hotkey no Sair.
- Janela nasce `visible:false` e é mostrada no setup se `!startMinimized`; `minimizeToTray` intercepta o CloseRequested (esconde em vez de fechar).
- Autostart via `tauri-plugin-autostart` (`app.autolaunch()`), sincronizado com `general.startWithWindows` no setup e ao salvar settings.

### Login Spotify pela UI
- `SpotifyAuthClient` reutiliza PKCE com `AuthBackend`: Node (node:http + `child_process`) e Tauri (Rust `auth_open_callback_server` — TcpListener 127.0.0.1 com timeout de 300 s — + `open_url` via `cmd start`). Logout limpa tokens.
- Porta default 1420 conflita com o Vite em `tauri dev` — usar outro Redirect URI em desenvolvimento (documentado no README).

### Transporte HTTP no webview
- `httpFetch` em `src/platform/http.ts`: `@tauri-apps/plugin-http` (sem CORS) no Tauri; `fetch` global no navegador/Node.

### UI
- Topbar com **Principal** e **Configurações** (abas Geral, Spotify, Voz, Whisper, IA): status do assistente, push-to-talk, login/logout, pickers de arquivo (binário/modelo), validar whisper, salvar chave, autostart/start-minimized, hotkey.

### Testes (88 no total, 13 arquivos)
- `tests/settings/settingsSchema.test.ts` — schema + merge/defaults
- `tests/settings/nodeStore.test.ts` — escrita atômica (mock de `fs`)
- `tests/config/configPrecedence.test.ts` — settings > env > defaults e fallback do env via `pick()`
- `tests/voice/hotkeyController.test.ts` — aplicar/limpar/conflito (mock)
- `tests/spotify/spotifyAuth.test.ts` — login/logout com store e backend mockados

### Dependências (Fase 5)
- npm: `@tauri-apps/plugin-http@2.5`, `plugin-dialog@2.7`, `plugin-autostart@2.5`, `plugin-global-shortcut@2.3`
- Rust: `tauri-plugin-global-shortcut`, `tauri-plugin-autostart`, `tauri-plugin-dialog`, `tauri-plugin-http`, `keyring = "4"`

### Validação executada neste ambiente
- `npm run typecheck` ✅ · `npm test` ✅ (88/88) · `npm run build` ✅ (Vite; imports `node:*` externalizados só para browser, nunca acessados no webview)
- `cargo check` ✅ e `cargo build --release` ✅; `npm run tauri dev` abre janela sem crash ✅
- `npm run tauri build` ✅ → instalador `src-tauri/target/release/bundle/nsis/Spotify Voice Assistant_0.1.0_x64-setup.exe`; o exe release abre e permanece ativo ✅
- **Não testado aqui**: voz end-to-end real (whisper.cpp não instalado), microfone físico, hotkey de fato (depende de desktop com áudio/teclado).

## Testes

88 testes passando (`npm test`, 13 arquivos):

- `tests/intents/localParser.test.ts` — 36 casos do spec (comandos, volume, música+artista, playlist, atuais, vagas, compostas)
- `tests/intents/intentRouter.test.ts` — comandos simples com **0 chamadas** ao Grok; fallback para vagas/compostas
- `tests/ai/aiIntentParser.test.ts` — mock do Grok; rejeita JSON inválido, ações inventadas e volume fora do schema
- `tests/spotify/spotifyController.test.ts` — mocks de player/search (sem conta real)
- `tests/spotify/spotifyAuth.test.ts` — login/logout com mocks
- `tests/voice/` — pipeline, serviço, integração e provider whisper (mocks, sem hardware real)
- `tests/settings/`, `tests/config/configPrecedence.test.ts`, `tests/voice/hotkeyController.test.ts` — settings, precedência e hotkey (Fase 5)

## Dependências adicionadas

- `zod` (validação)
- `@tauri-apps/api` + `@tauri-apps/cli` (desktop)
- `@tauri-apps/plugin-http`, `plugin-dialog`, `plugin-autostart`, `plugin-global-shortcut` (Fase 5)
- Rust: `cpal` (captura de microfone), `tauri-plugin-global-shortcut`, `tauri-plugin-autostart`, `tauri-plugin-dialog`, `tauri-plugin-http`, `keyring` (Fase 5)
- dev: `typescript`, `vite`, `vitest`, `tsx`, `@types/node`

## Variáveis de ambiente necessárias

```env
SPOTIFY_CLIENT_ID=
SPOTIFY_REDIRECT_URI=http://127.0.0.1:1420/callback
XAI_API_KEY=
XAI_MODEL=grok-3-mini
WHISPER_MODEL=base
WHISPER_BIN=whisper-cli
WHISPER_MODEL_PATH=            # modelo fixo (opcional)
WHISPER_MODELS_DIR=            # pasta de modelos (opcional)
WHISPER_TIMEOUT_MS=60000
MIN_RECORDING_MS=300
VOLUME_STEP=10
```

## Como executar

```bash
npm install
cp .env.example .env   # preencher SPOTIFY_CLIENT_ID (+ XAI_API_KEY p/ fallback)
npm run cli -- --login # autentica o Spotify
npm run cli            # modo texto
npm test               # testes
npm run dev            # UI web de demonstração (sem microfone)
npm run tauri dev      # desktop (voz + push-to-talk + tray + hotkey)
npm run tauri build    # build release + instalador NSIS
```

No desktop, a configuração é feita pela interface (Configurações → abas); o `.env` serve como fallback em desenvolvimento.

## Limitações atuais

- **whisper.cpp não instalado no ambiente de dev**: a voz só funciona end-to-end após instalar o binário e apontar o caminho (settings do desktop ou `WHISPER_BIN`). Todo o fluxo está testado com mocks; o teste de áudio real requer máquina com microfone.
- **Sem wake word**: ativação é por push-to-talk (botão, hotkey ou tray).
- **Porta do callback OAuth**: 1420 conflita com o Vite em `tauri dev` — usar outro Redirect URI no Dashboard do Spotify em desenvolvimento (em release a porta é livre).
- **Split artista simples**: "música do artista" usa a última ocorrência de `do/de/da`; nomes com "de" no título podem quebrar (regra simples inicial, refinável com testes).
- **Sem cache de IA** (interface preparada futuramente).
- **A IA retorna apenas `play_artist` como fallback de "artista";** sem ranking sofisticado de busca (primeiro resultado razoável).

## Próximos passos

1. Instalar whisper.cpp local e validar voz end-to-end (mic → texto → Spotify) no desktop
2. Testar o fluxo de login Spotify completo pela UI (requer Client ID real + máquina)
3. Refinamento do parser (nomes com "de"/"do", mais aliases em `config/commands.json`)
4. Cache de IA opcional e métricas de custo
5. Testes de integração reais (separados, opcionais)