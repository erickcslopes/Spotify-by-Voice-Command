# Spotify Voice Assistant

Assistente de voz **desktop local-first** para controle do Spotify por comandos de voz. Comandos comuns são interpretados por um **parser determinístico local**. Um modelo pequeno da **xAI/Grok** é utilizado **apenas como fallback** para frases ambíguas, semânticas ou compostas.

## Conceito

```text
voz/texto
   ↓
intenção (Intent Engine)
   ↓
Spotify Controller
   ↓
Spotify Web API
```

A prioridade é manter a maioria absoluta dos comandos resolvida localmente (sem custo e sem latência) e usar a IA somente quando a intenção não puder ser determinada com segurança.

Exemplos:

| Comando | Resultado | Fonte |
| --- | --- | --- |
| `pausa` | `pause` | local (1 chamada Grok = 0) |
| `próxima` | `next_track` | local |
| `volume 40` | `set_volume(40)` | local |
| `toca Black Betty` | `play_track("Black Betty")` | local |
| `toca Black Betty do Ram Jam` | `play_track("Black Betty", "Ram Jam")` | local |
| `toca playlist treino` | `play_playlist("treino")` | local |
| `coloca minha playlist de rock e volume em 30` | ações compostas | Grok (fallback) |

## Stack

- **TypeScript + Vite** — lógica central e interface
- **Tauri 2 + Rust** — shell desktop (janela, tray, hotkey, áudio)
- **whisper.cpp** — transcrição de fala local (opcional)
- **Spotify Web API** — OAuth Authorization Code + PKCE
- **xAI (Grok)** — fallback semântico somente quando necessário

## Estrutura

```text
src/
├── intents/     # tipos, normalizador, padrões, parser local, router, schemas
├── spotify/     # auth PKCE, API HTTP, player, search, controller
├── ai/          # client Grok, prompt, parser de intenções por IA
├── voice/       # interface SpeechToTextProvider + provider whisper local
├── config/      # configuração centralizada
├── feedback/    # mensagens amigáveis ao usuário
├── app/         # bootstrap e estado
└── ui/          # interface mínima (Vite)
config/
└── commands.json  # aliases configuráveis dos comandos simples
tests/             # testes do parser, router, IA e Spotify (mocks)
src-tauri/         # scaffold desktop (Tauri 2)
```

## Instalação

Requisitos: Node.js 22+ (recomendado), npm.

```bash
npm install
```

Crie o arquivo `.env` a partir do exemplo:

```bash
cp .env.example .env
```

Preencha `SPOTIFY_CLIENT_ID`. Para testar o fallback, preencha também `XAI_API_KEY`.

> O app usa **PKCE**, portanto nenhum `CLIENT_SECRET` é necessário nem deve ser incluído no repositório.

## Configuração Spotify

1. Crie um app em <https://developer.spotify.com/dashboard>.
2. Em **Redirect URIs**, adicione: `http://127.0.0.1:1420/callback`
3. Copie o `Client ID` para `SPOTIFY_CLIENT_ID` no `.env`.

Autenticar (modo texto):

```bash
npm run cli -- --login
```

Isso abre o navegador e salva os tokens localmente (fora do repositório).

## Configuração xAI (fallback)

```env
XAI_API_KEY=sk-...
XAI_MODEL=grok-3-mini
```

O modelo é centralizado na configuração (`src/config/defaults.ts` + `.env`). Sem chave configurada, o Grok fica desabilitado e comandos desconhecidos retornam "Não consegui interpretar esse comando."

## Voz (whisper.cpp + push-to-talk)

**Desktop (Tauri):** o microfone é capturado em Rust (cpal), convertido para WAV mono 16 kHz e enviado ao whisper.cpp na própria máquina. A interface tem um botão **🎤 Falar** (push-to-talk): segure para gravar, solte para transcrever e executar. O mesmo pipeline é acionado pela **hotkey global**.

**Navegador/CLI:** sem captura de áudio real — a entrada é textual (nada de áudio para a IA; só o texto do comando vai ao Grok quando o parser local falhar).

Instale o whisper.cpp para voz real:

```bash
# Windows (uma vez)
git clone https://github.com/ggerganov/whisper.cpp
cd whisper.cpp
cmake -B build -DWHISPER_BUILD_TESTS=OFF
cmake --build build --config Release
build\bin\Release\whisper-cli.exe -m models\ggml-base.bin  # baixa o modelo e valida
```

No desktop, aponte o binário/modelo pela **tela de Configurações → Whisper** (sem digitar caminhos: use os botões "Selecionar…") e valide com **"Validar instalação"**. Em desenvolvimento, o `.env` continua valendo como fallback:

```env
WHISPER_BIN=whisper-cli
WHISPER_MODEL=base
WHISPER_MODEL_PATH=C:\whisper\models\ggml-base.bin
WHISPER_TIMEOUT_MS=60000
MIN_RECORDING_MS=300
```

O provider é uma interface (`SpeechToTextProvider`), trocável sem afetar o restante.

## Execução

```bash
# testes
npm test

# typecheck
npm run typecheck

# interface web de demonstração (sem Spotify e sem microfone)
npm run dev

# modo texto (entrada textual → intents → Spotify)
npm run cli
```

No modo texto, digite comandos como `toca Black Betty`, `pausa`, `volume 40`, ou `parse <texto>` para ver apenas a intenção detectada.

## Build desktop (Tauri)

```bash
npm run tauri dev      # desenvolvimento (janela + tray + hotkey)
npm run tauri build    # build release + instalador Windows (NSIS)
```

O instalador é gerado em:

```text
src-tauri/target/release/bundle/nsis/Spotify Voice Assistant_0.1.0_x64-setup.exe
```

## Aplicativo desktop (primeiro uso)

Sem usar o terminal:

1. Abra o aplicativo (ou instale o `setup.exe`).
2. Em **Configurações → Spotify**: informe o `Client ID` (e, se preciso, o `Redirect URI`), salve e clique **Conectar Spotify** — o navegador abre e o login acontece por PKCE.
3. Em **Configurações → Whisper**: selecione `whisper-cli.exe` e o modelo `ggml-*.bin`, salve e clique **Validar instalação**.
4. Em **Configurações → IA**: opcional — informe a API key (salva no **keyring do sistema**) e escolha o modelo.
5. Em **Configurações → Voz**: defina a **hotkey global** (padrão `Ctrl+Alt+Space`) e clique **Aplicar hotkey**.
6. Na tela principal, pressione a hotkey (ou segure **🎤 Falar**) e fale o comando.

### Tray

- O aplicativo roda em segundo plano no **tray** (bandeja do sistema).
- Com **Minimizar para tray ao fechar** ativo (padrão), fechar a janela (X) a esconde e mantém o app ativo.
- Menu do tray: **Falar**, **Abrir**, **Configurações** e **Sair** (encerra de forma limpa: para gravação, libera microfone e remove a hotkey).

### Hotkey global

- Funciona com a janela sem foco ou minimizada.
- Segure para gravar, solte para transcrever e executar.
- Se a combinação estiver em uso por outro programa, o app mostra um erro e mantém a combinação anterior.

### Iniciar com o Windows / Iniciar minimizado

- Em **Configurações → Geral**: habilite **Iniciar com o Windows** (registra/remove automaticamente no startup) e **Iniciar minimizado**.

### Configuração (precedência)

```text
Settings persistentes (interface)  →  %APPDATA%\com.spotifyvoiceassistant.app\settings.json
.env (apenas desenvolvimento)
defaults (src/config/defaults.ts)
```

A chave da IA fica no keyring do sistema; tokens do Spotify em `~/.spotify-voice-assistant/tokens.json` (fora do repositório).

> Em `npm run tauri dev`, a porta 1420 é ocupada pelo Vite — use um Redirect URI com outra porta (ex.: `http://127.0.0.1:1421/callback`) no Dashboard do Spotify se quiser testar o login em desenvolvimento.

## Teste manual

- [ ] Abrir o app
- [ ] Conectar Spotify pela interface
- [ ] Configurar Whisper e validar
- [ ] Testar o botão Falar
- [ ] Minimizar para tray
- [ ] Restaurar pelo tray
- [ ] Testar hotkey com janela sem foco
- [ ] Fechar a janela mantendo o tray
- [ ] Sair pelo tray
- [ ] Habilitar Start with Windows
- [ ] Fechar/reabrir e verificar que as settings persistem
- [ ] Gerar build release e instalar o bundle gerado

## Comandos suportados (parser local)

- **Pausa**: `pausa`, `pause`, `pausar`, `para a música`…
- **Continuar**: `continua`, `volta a tocar`…
- **Próxima / Anterior**: `próxima`, `pula essa`, `volta uma`…
- **Volume absoluto**: `volume 30`, `coloca o volume em 20`, `volume 75 por cento`
- **Volume relativo**: `aumenta o volume`, `mais alto`, `abaixa o volume`
- **Aleatório**: `ativa o aleatório`, `desativa aleatorio`
- **Repetição**: `repete essa música` (track), `repete a playlist` (context), `desativa repetição` (off)
- **Música**: `toca Black Betty`, `toca Black Betty do Ram Jam`, `toca artista Ram Jam`
- **Playlist**: `toca playlist treino`, `coloca minha playlist rock`, `playlist academia`
- **Música atual**: `o que está tocando`, `que música é essa`

Aliases são editáveis em `config/commands.json`.

## Arquitetura

Fluxo obrigatório — nenhum componente executa Spotify diretamente:

```text
UI / Voz
   ↓
IntentRouter (local ou fallback Grok)
   ↓
Intent (tipada)
   ↓
SpotifyController
   ↓
SpotifyApi
```

O Grok nunca chama o Spotify: retorna apenas JSON, validado por **Zod** contra um conjunto permitido de intents. Ações fora do schema são rejeitadas.

## Segurança

- `.env` no `.gitignore`; sem secrets no repositório.
- OAuth com PKCE (sem secret no binário).
- Respostas do Grok validadas antes da execução.
- Logs sem tokens/credenciais.

## Próximos passos

Ver `REPORT.md` para o estado atual e o roadmap (refinamentos de voz/parser, wake word opcional).

## Roadmap resumido

1. ✅ Scaffold + Intent Engine + testes
2. ✅ Spotify (auth PKCE, API, controller) + testes
3. ✅ Fallback Grok com schema + testes
4. ✅ Captura de microfone + whisper.cpp + push-to-talk (Tauri)
5. ✅ Tray, hotkey global, settings, build desktop + instalador