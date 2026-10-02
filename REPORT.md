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
- Porta padrão do callback: **1421** (1420 é a porta do Vite e pode estar ocupada; a URI é configurável e precisa casar com o que está registrado no Dashboard do Spotify).

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

108 testes passando (`npm test`, 16 arquivos):

- `tests/intents/localParser.test.ts` — 36 casos do spec (comandos, volume, música+artista, playlist, atuais, vagas, compostas)
- `tests/intents/intentRouter.test.ts` — comandos simples com **0 chamadas** ao Grok; fallback para vagas/compostas
- `tests/ai/aiIntentParser.test.ts` — mock do Grok; rejeita JSON inválido, ações inventadas e volume fora do schema
- `tests/spotify/spotifyController.test.ts` — mocks de player/search (sem conta real)
- `tests/spotify/spotifyAuth.test.ts` — login/logout com mocks
- `tests/spotify/spotifyApi.test.ts` — resposta 200 em texto (request-id), 204, JSON, 403 NO_ACTIVE_DEVICE e retry 401
- `tests/spotify/httpScope.test.ts` — scopes HTTP das capabilities (não usar `https://*`)
- `tests/app/processCommand.test.ts` — integração `buildApp`: "pausa"/"próxima"/"volume 50" → Spotify chamado 1x, sem Grok, erro propagado ao feedback e estado
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
SPOTIFY_REDIRECT_URI=http://127.0.0.1:1421/callback
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

## Correção Spotify OAuth / PKCE

### Causa do erro

O `buildAuthorizationUrl` (TS) já montava a URL corretamente com `response_type=code`, `code_challenge_method=S256`, `code_challenge` e `state`. O erro `response_type must be code` acontecia no **backend desktop**: o Rust `open_url` abria o navegador via

```text
cmd /C start "" <url>
```

sem aspas. O `&` que separa os parâmetros da query é **separador de comando no cmd**, então a URL era truncada no primeiro `&` e o Spotify recebia apenas `https://accounts.spotify.com/authorize?client_id=...` — sem `response_type`, sem `scope`, sem `code_challenge`. Demonstrado em execução:

```text
cmd /c echo https://accounts.spotify.com/authorize?client_id=abc&response_type=code&scope=user
→ https://accounts.spotify.com/authorize?client_id=abc
→ 'response_type' não é reconhecido como um comando interno...
```

O fluxo por Node (CLI) não apresentava o problema porque o `NodeAuthBackend` usava `start "" "<url>"` (com aspas).

### Arquivos alterados

- `src-tauri/src/settings.rs` — `open_url` usa `tauri-plugin-opener` (`app.opener().open_url(...)`, sem shell); `auth_open_callback_server` valida o `state` do OAuth; `extract_code_from_request` virou `extract_query_param(request, key)`.
- `src-tauri/Cargo.toml` e `src-tauri/src/lib.rs` — `tauri-plugin-opener = "2"` + `tauri_plugin_opener::init()` no Builder.
- `src-tauri/capabilities/default.json` — permissão `opener:allow-open-url`.
- `src/spotify/spotifyAuth.ts` — adicionado `generateState()`; `buildAuthorizationUrl` agora recebe e inclui `state`; `AuthBackend.startCallbackServer` aceita `expectedState` e valida (Node e Tauri/Rust); `login()` gera `state` e o passa à URL e ao servidor de callback.
- `tests/spotify/spotifyAuth.test.ts` — novos testes de `buildAuthorizationUrl`.

### Correção aplicada

- Navegador no desktop abre com a URL completa (todos os parâmetros chegam ao Spotify).
- PKCE verificado: `code_verifier` (64 bytes base64url) → SHA-256 → `code_challenge` (base64url sem padding) → `code_challenge_method=S256`.
- Troca de token envia `grant_type=authorization_code`, `code`, `redirect_uri`, `client_id`, `code_verifier` — sem `CLIENT_SECRET`.
- `redirect_uri` é o valor salvo nas Settings (`http://127.0.0.1:1421/callback`), idêntico na autorização e na troca; nada de substituir por `localhost`.
- `state` agora presente na URL e validado no callback (proteção CSRF).

### Correção da abertura da URL no Windows (`explorer.exe` → `tauri-plugin-opener`)

O `explorer.exe <url>` não abria o navegador (o Windows abria **Meus Documentos**), então a abertura da URL OAuth foi migrada para o mecanismo oficial do Tauri:

- **`explorer.exe` removido** de `open_url` (`src-tauri/src/settings.rs`) — o comando agora recebe `tauri::AppHandle` e usa `app.opener().open_url(url, None::<&str>)` (trait `OpenerExt`), abrindo a URL no navegador padrão **sem passar por shell** (`cmd`/`explorer`/`Start-Process`).
- **`tauri-plugin-opener = "2"`** adicionado ao `Cargo.toml` e inicializado no `Builder` (`tauri_plugin_opener::init()`) em `src-tauri/src/lib.rs`.
- **Permissões**: adicionado `opener:allow-open-url` em `src-tauri/capabilities/default.json` (abre URLs HTTP/HTTPS; nenhum acesso arbitrário a arquivos).
- Fluxo único mantido: `TauriAuthBackend.openUrl(url)` → `invoke("open_url", { url })` → plugin opener. Nada de `cmd /C start`, `explorer.exe` ou `Start-Process` no caminho do OAuth.
- O `NodeAuthBackend` (modo texto/CLI, fora do desktop) mantém `start "" "<url>"` **com aspas** — é o único caminho não-Tauri e sempre funcionou (nunca causou o bug).

### Correção do scope HTTP do `tauri-plugin-http`

Após a abertura do navegador e o callback funcionarem, a troca do code por token falhava com:

```text
Falha ao conectar: url not allowed on the configured scope: https://accounts.spotify.com/api/token
```

- **Causa**: o `tauri-plugin-http` exige que as URLs acessadas pelo webview estejam declaradas no scope das capabilities. O `capabilities/default.json` tinha apenas `"http:default"` (scope restrito a localhost), então qualquer request externo (token endpoint / Web API) era bloqueado.
- **Capability alterada**: `src-tauri/capabilities/default.json` — `"http:default"` virou um objeto com `allow`, liberando **apenas** os endpoints realmente usados:
  - `https://accounts.spotify.com/api/token` — troca do authorization code e refresh token
  - `https://api.spotify.com/v1/*` — Web API (player, busca, current playing, etc.)
- **Justificativa do escopo mínimo**: nada de `https://*` nem acesso HTTP irrestrito; `https://accounts.spotify.com/authorize` não precisa de permissão HTTP (abre no navegador via `tauri-plugin-opener`, permissão separada `opener:allow-open-url`).
- O POST de troca continua `https://accounts.spotify.com/api/token` com `Content-Type: application/x-www-form-urlencoded` e `grant_type=authorization_code`, `code`, `redirect_uri`, `client_id`, `code_verifier` — sem `client_secret`. PKCE inalterado.
- **Testes**: `tests/spotify/httpScope.test.ts` (3 casos) — garante que o scope contém `https://accounts.spotify.com/api/token` e `https://api.spotify.com/v1/*` e não usa `https://*`.

### Testes adicionados/alterados (8 novos, 97 no total)

- `buildAuthorizationUrl` contém `response_type=code` e **nunca** `response_type=token`
- contém `client_id`, `redirect_uri`, `code_challenge` e `state`
- `redirect_uri` das Settings chega intacto à URL (decodificado == valor salvo; sem `localhost`)
- `code_challenge` é o SHA-256 base64url sem padding do verifier
- `login()` completo (mock do fetch): URL aberta com PKCE/state, troca por token com `grant_type=authorization_code` e `code_verifier`, sem `client_secret`, save dos tokens
- `TauriAuthBackend.openUrl` envia a **URL OAuth completa** ao comando `open_url` (sem `cmd`/`explorer`/`powershell`)
- `tests/spotify/httpScope.test.ts` — scope HTTP contém `https://accounts.spotify.com/api/token` e `https://api.spotify.com/v1/*`; não usa `https://*`

### Resultado da validação

- `npm run typecheck` ✅ · `npm test` ✅ (98/98) · `npm run build` ✅ (Vite)
- `cargo check` ✅ · `cargo build --release` ✅ · `npm run tauri build` ✅ (instalador NSIS gerado)
- App release abre e permanece ativo ✅
- **Teste manual OAuth pendente (requer Client ID real + máquina)**: executar.bat → Configurações → Spotify → Client ID → Salvar → Conectar Spotify. Esperado: navegador padrão abre `accounts.spotify.com` (tela de autorização) — **sem** Meus Documentos, sem "response_type must be code". Depois de autorizar: callback em `127.0.0.1:1421`, `state` validado, POST `/api/token` **sem erro de scope**, tokens persistidos, status "Conectado". Em seguida, testar um comando simples (ex.: "o que está tocando") para confirmar que `https://api.spotify.com/v1/*` também está liberado.

### Limitações restantes

- O login end-to-end real não pôde ser executado neste ambiente (sem autorização do Spotify); o erro original (`response_type must be code`) foi reproduzido e eliminado pela troca do `open_url`, e a URL completa é coberta por testes.
- `show_dialog=true` permanece (força a tela de consentimento do Spotify a cada login, comportamento intencional do app).

## Seleção de microfone

- **Novo campo `voice.device`** nas settings (TS `schema.ts` + Rust `VoiceSettings`), default vazio = dispositivo padrão do sistema.
- **Comando Rust `list_input_devices`** (`src-tauri/src/audio.rs`) enumera os dispositivos de entrada (cpal) e devolve os nomes; registrado em `lib.rs`.
- **`AudioRecorder.start(device)`** recebe o nome do dispositivo; `capture_loop` procura o dispositivo pelo nome (via `host.input_devices()`) e, se não estiver mais presente, cai no padrão do sistema. `start_recording` lê o device das settings persistentes.
- **UI**: aba **Configurações → Voz** ganhou o dropdown **Microfone** (opção "Padrão do sistema" + dispositivos detectados) com botão **Atualizar**; a seleção é salva em `settings.voice.device` e reaplicada ao abrir o app.
- **Teste**: `tests/settings/settingsSchema.test.ts` — `voice.device` default vazio, preserva seleção e default em arquivos antigos (108 testes no total).

## Correção — comandos não executavam

### Sintoma

Digitar um comando no campo de texto (ou falar) **não produzia efeito visível** no app desktop: nem ação nem mensagem de resultado. Comandos que retornam JSON do Spotify (busca, "o que está tocando") funcionavam; comandos de player (pausa, próxima, volume) "não faziam nada".

### Causa raiz

Os comandos **executavam de fato** no Spotify, mas `SpotifyApi.request` sempre tentava `response.json()` no corpo de toda resposta 2xx. O Spotify responde com **200 + request-id em texto puro** (não JSON, `Content-Type: text/plain`) para endpoints de comando (`PUT /me/player/pause`, `POST /me/player/next`, volume, etc.). O `JSON.parse` lançava `SyntaxError: Unexpected token 'r', "rFqn8RjNT8"... is not valid JSON`; o erro caía no `feedback.error` com mensagem genérica ("Algo deu errado. Verifique os logs.") — o usuário percebia como "nada acontece".

### Caminho afetado

`src/ui/main.ts` (Enviar/Enter) → `buildApp().processCommand` (`src/app/bootstrap.ts`) → `IntentRouter` → `SpotifyController` → `SpotifyPlayer` → `SpotifyApi.request` (`src/spotify/spotifyApi.ts`) → `response.json()`.

### Correção

`src/spotify/spotifyApi.ts`:
- **2xx com corpo não-JSON** (request-id de texto) → sucesso, retorna `undefined` sem parsear (verifica `Content-Type`).
- `response.json()` protegido por try/catch como último recurso.
- **403/404** agora leem `reason`/`message` do corpo: `NO_ACTIVE_DEVICE` continua virando `SpotifyNoActiveDeviceError`; os demais incluem a reason real na mensagem (ex.: `Erro do Spotify (status 403). Player command failed: Restriction violated`).

### Instrumentação (diagnóstico)

- `bootstrap.processCommand` loga `[command] input=...`, `intent=... source=...` e `ok: ...`/`error: ...` (sem tokens/chaves).
- Estado expandido: `lastSource` (`local`/`ai`) e `lastError` em `AppState`.
- UI: painel "Origem" e "Erro" em `#voice-info`; `renderResults` mostra o erro com destaque vermelho quando há falha; estado visual `idle → processing → success|error` já refletido pela `VoicePipeline`.

### Testes

- `tests/spotify/spotifyApi.test.ts` — 200 com texto (request-id) não lança; 204 → undefined; 200 JSON → parsed; 403 `NO_ACTIVE_DEVICE` → `SpotifyNoActiveDeviceError`; 403 com reason na mensagem; 401 renova e reexecuta 1x.
- `tests/app/processCommand.test.ts` — integração do fluxo único: "pausa" → `/me/player/pause` chamado 1x e feedback "Pausado"; "próxima" → `next_track`; "volume 50" sem Grok; erro `NO_ACTIVE_DEVICE` propagado ao feedback e ao estado sem lançar.
- Total: **108 testes** (16 arquivos), `npm run typecheck`, `npm run build`, `cargo check` verdes.

### Teste manual (máquina com conta real)

Via CLI (`npm run cli`), mesmo `processCommand` do desktop:
- `toca Black Betty` → "Tocando Black Betty — Ram Jam" ✓
- `pausa` → "Pausado" ✓
- `continua` → "Reprodução continuada" ✓
- `próxima` → "Próxima música" ✓
- `o que está tocando` → "Black Betty — Ram Jam" ✓

### Limitações (comportamento do Spotify, não do app)

- **Pausar duas vezes seguidas** (já pausado): o Spotify responde `403 Player command failed: Restriction violated` (reason `UNKNOWN`). É restrição do lado do Spotify para pause idempotente; o app agora exibe a reason real em vez de mensagem genérica. "continua" após isso volta a funcionar.
- Conta que usa **player sem Premium** teria 403 similar em comandos de player — o app mostra a reason real do Spotify.

### Correção adicional — fluxo de voz (audio.rs) e timeout (texto)

O app transcreve via **whisper.cpp local** (sem relação com Groq); o xAI/Grok só interpreta comandos ambíguos. Dois pontos quebravam a voz e um travamento no texto:

1. **Gravação nunca iniciava (`audio.rs`)**: `start()` aguardava `rx.recv_timeout(5s)`, mas a thread só enviava o resultado por `tx` **depois** de `capture_loop` encerrar (fim da gravação). Num comando real a gravação durava >5s → timeout, a gravação nunca era registrada como ativa e a thread do microfone ficava presa. Corrigido: `capture_loop` envia o resultado de inicialização (`Ok((sample_rate, channels))`) **imediatamente após** `stream.play()`, enquanto a thread segue capturando até o flag de parada. `start()` registra a `ActiveRecording` e retorna `Ok` em milissegundos; `stop()` sinaliza parada e faz `join`.
2. **Transcrição vazia (`audio.rs`)**: o `Command` do whisper era criado sem `.stdout(Stdio::piped())`, então `wait_with_output()` devolvia `stdout` vazio e a transcrição nunca chegava. Adicionado `.stdout(Stdio::piped()).stderr(Stdio::piped())` (stderr também, para mensagens de erro precisas).
3. **UI congelava em comandos de texto (`spotifyApi.ts`)**: `httpFetch` não tinha timeout; uma API lenta travaria a interface. Adicionado `withTimeout` (15s) que rejeita com `SpotifyApiError("Tempo limite na requisição ao Spotify (15000 ms).")`.

### Testes (atualização)

- `tests/spotify/spotifyApi.test.ts` — **requisição lenta respeita o timeout** (fake timers, rejeita `SpotifyApiError` / `Tempo limite`) além dos casos anteriores.
- Total: **110 testes** (16 arquivos). `npm run typecheck`, `npm test`, `npm run build`, `cargo check` e `npm run tauri build` (NSIS) verdes.

### Permissão HTTP (capabilities) e alias `play` → `resume`

- **`src-tauri/capabilities/default.json`**: `http:default.allow` agora inclui `https://api.x.ai/v1/*` (além de `https://accounts.spotify.com/api/token` e `https://api.spotify.com/v1/*`). **Não** foi liberado `https://*`.
- **`config/commands.json`**: `"play"` adicionado ao grupo `resume` (comando determinístico). `"play"` sozinho → `resume` (source=local, Grok=0). `PLAY_PREFIXES` continua sem `play`, então `"play X"` (reproduzir faixa) não é afetado por esta mudança (cai no Grok, como antes).
- **Teste** (`tests/intents/intentRouter.test.ts`): `"play"` → `resume`, `source=local`, `ai.parse` não chamado (110 testes no total).

## Limitações atuais

- **whisper.cpp não instalado no ambiente de dev**: a voz só funciona end-to-end após instalar o binário e apontar o caminho (settings do desktop ou `WHISPER_BIN`). Todo o fluxo está testado com mocks; o teste de áudio real requer máquina com microfone.
- **Sem wake word**: ativação é por push-to-talk (botão, hotkey ou tray).
- **Porta do callback OAuth**: a padrão é 1421 (1420 é a porta do Vite e pode estar ocupada por outro processo); a URI precisa casar com o que está registrado no Dashboard do Spotify. Em `tauri dev`, o Vite ocupa 1420, então o Redirect URI padrão já não colide.
- **Split artista simples**: "música do artista" usa a última ocorrência de `do/de/da`; nomes com "de" no título podem quebrar (regra simples inicial, refinável com testes).
- **Sem cache de IA** (interface preparada futuramente).
- **A IA retorna apenas `play_artist` como fallback de "artista";** sem ranking sofisticado de busca (primeiro resultado razoável).

## Próximos passos

1. Validar voz end-to-end no desktop com microfone real (whisper já instalado em `D:\Github\whisper.cpp`)
2. Testar o fluxo de login Spotify completo pela UI (requer Client ID real + máquina)
3. Refinamento do parser (nomes com "de"/"do", mais aliases em `config/commands.json`)
4. Cache de IA opcional e métricas de custo
5. Testes de integração reais (separados, opcionais)