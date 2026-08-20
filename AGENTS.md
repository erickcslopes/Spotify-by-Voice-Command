# AGENTS.md

Guia para agentes trabalhando neste repositório.

## Projeto

Spotify Voice Assistant: desktop app local-first para controle do Spotify por voz/texto. Comandos simples resolvidos por parser determinístico; Grok usado **somente** como fallback semântico.

## Comandos

```bash
npm test              # testes (vitest)
npm run test:watch    # testes em watch
npm run typecheck     # tsc --noEmit
npm run build         # typecheck + build Vite
npm run dev           # UI web de demonstração (Vite)
npm run cli           # modo texto (tsx src/main.ts)
npm run tauri dev     # desktop (requer toolchain Rust)
```

## Estrutura e responsabilidades

- `src/intents/` — núcleo: tipos de Intent, normalizador, padrões, parser local, router, schemas Zod.
- `src/spotify/` — auth PKCE, HTTP (`SpotifyApi`), player, search, `SpotifyController` (converte Intent em ações).
- `src/ai/` — `GrokClient`, prompt mínimo, `AiIntentParser` (valida com Zod).
- `src/voice/` — camada de voz: `SpeechToTextProvider` (interface `transcribe(audioPath)`), `LocalWhisperProvider` (Node), `VoiceService` e `VoicePipeline` (orquestra push-to-talk/estados).
- `src-tauri/` — desktop Rust: `audio.rs` captura microfone (cpal), converte para WAV mono 16 kHz e chama whisper.cpp (`transcribe_audio`). `lib.rs` registra comandos e gerencia `AudioRecorder`.
- `src/config/` — configuração centralizada (`.env` + `config/commands.json` + defaults).
- `src/app/` — `bootstrap.ts` (injeção de dependências) e estado/métricas.
- `config/commands.json` — aliases dos comandos simples (editável sem recompilar).
- `tests/` — testes por camada, com mocks (sem API real).

## Convenções

- TypeScript estrito (`strict: true`, `noUncheckedIndexedAccess`).
- **Sem comentários** a menos que agreguem (o spec pede documentar decisões relevantes — usar docblocks breves quando útil).
- Funções pequenas; módulos desacoplados; cada camada testável isoladamente.
- A IA **nunca** chama o Spotify: ela retorna JSON validado por `AllowedIntentSchema`; qualquer ação fora do conjunto é rejeitada.
- Princípios: `regex > IA`, `alias > IA`, configuração > IA. Melhorar o parser local antes de aceitar custo de IA.

## Regras de teste

- Comandos simples (`pausa`, `próxima`, `volume 50`, `toca Black Betty`) **não** devem chamar o Grok — há teste específico para isso.
- Testes de IA usam mock do `GrokClient`.
- Testes de Spotify usam mocks do player/search (sem conta real).
- Testes de voz usam mock do `SpeechToTextProvider` / `child_process` (sem microfone nem whisper real).

## Voz (Fase 4)

- Cadeia: push-to-talk → `AudioRecorder` (Rust/cpal, WAV mono 16 kHz) → `transcribe_audio` (whisper.cpp) → `processCommand(text)`.
- `VoicePipeline` garante que só há **uma** gravação/transcrição por vez; gravações < `MIN_RECORDING_MS` são descartadas.
- Silêncio/erro de transcrição **nunca** cai no Grok (não há texto útil); apenas texto válido vai ao parser, e só então o Grok pode ser usado.
- Nenhum áudio é enviado à IA — apenas texto, quando o parser local falhar.

## Settings (Fase 5)

- `src/settings/` — schema Zod (`schema.ts`), stores (`stores.ts`): `NodeSettingsStore` (CLI, escrita atômica temp+rename), `TauriSettingsStore` (comandos Rust) e `MemorySettingsStore` (navegador).
- Precedência: **settings persistentes > .env > defaults**. Campo ainda no default deixa o `.env` atuar como fallback (`pick()` em `config.ts`).
- `configFromSettings(settings, base)` produz o `AppConfig`; settings inválidas caem em defaults seguros.
- **Segredos**: chave da IA no **keyring do sistema** (Rust `settings.rs`, serviço `com.spotifyvoiceassistant.app`); tokens do Spotify em `~/.spotify-voice-assistant/tokens.json` (nunca em settings/logs).
- Rust: `src-tauri/src/settings.rs` — `SettingsService` gerenciado, `get_settings`/`save_settings`, `validate_whisper`, `auth_open_callback_server`, `open_url`, `token_*`, `ai_*`.

## Hotkey / Tray / Startup (Fase 5)

- Hotkey global via `tauri-plugin-global-shortcut` (só Rust): `src-tauri/src/hotkey.rs` registra e emite `voice:hotkey-down`/`voice:hotkey-up`; a UI (webview) chama `VoicePipeline.start/stop`. `hotkey_set` registra a nova antes de remover a antiga (mantém a anterior em conflito).
- Botão, hotkey e tray convergem no **mesmo `VoicePipeline`** (não duplicar lógica de voz).
- Tray (`src-tauri/src/tray.rs`): `minimizeToTray` intercepta o X (esconde a janela); `Sair` encerra limpo (`cleanup` para gravação e remove hotkey).
- Startup: `tauri-plugin-autostart` (`app.autolaunch()`) sincronizado com `general.startWithWindows`; `startMinimized` controla a exibição da janela (nasce `visible:false`).
- Não testar hotkey/tray/autostart reais em unit tests — mocks/abstrações (`HotkeyController` é testável isoladamente).

## Segurança

- Nunca commitar `.env` ou tokens.
- PKCE (sem `CLIENT_SECRET` no repo).
- Não registrar API keys/access tokens/refresh tokens em logs.