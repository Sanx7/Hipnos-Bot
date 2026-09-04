# 🎵 /play com yt-dlp — dependências, configuração e deploy

## Como funciona a arquitetura

```
Usuário → /play <nome ou link>
   └─ yt-search (busca por nome, sem baixar nada)
   └─ youtube-dl-exec (wrapper Node.js) → EXECUTA o binário real do yt-dlp
        ├─ yt-dlp.exe baixado automaticamente no `npm install`
        │   (em node_modules/youtube-dl-exec/bin — embute o próprio Python 3.10)
        ├─ Desafios de JavaScript do YouTube resolvidos com o NODE.JS
        │   (--no-js-runtimes --js-runtimes node, conforme a doc oficial:
        │    https://github.com/yt-dlp/yt-dlp/wiki/EJS)
        ├─ ffmpeg do @ffmpeg-installer/ffmpeg converte o áudio para MP3
        └─ Timeout de 90s: o processo é morto se travar
   └─ Baileys envia o MP3 (limite de 20 MB verificado antes do envio)
```

Nada é reimplementado em JS puro: o pacote `youtube-dl-exec` é apenas um
**executor do binário** — quem resolve os desafios do YouTube é o yt-dlp de
verdade, usando o Node.js como runtime de JavaScript.

## Requisitos por ambiente

### Windows local (onde o bot roda hoje) — já está OK ✅

| Item | Situação | Observação |
|---|---|---|
| Node.js ≥ 22.0.0 | ✅ v24.17.0 | **Obrigatório**: é o runtime que o yt-dlp usa para resolver os desafios JS |
| Binário do yt-dlp | ✅ automático | Baixado no `npm install` (youtube-dl-exec). **Não precisa de Python no sistema** — o exe standalone embute o Python dele |
| Python 3 | ✅ 3.14.7 (opcional) | Só é necessário se você preferir instalar o yt-dlp via `pip install -U "yt-dlp[default]"` (essa forma inclui o pacote de desafios `yt-dlp-ejs`) |
| ffmpeg | ✅ automático | Vem do `@ffmpeg-installer/ffmpeg` (já era dependência do projeto) |
| yt-dlp global (winget) | ✅ 2026.07.04 (opcional) | Útil para testes manuais no terminal; o bot usa o binário do node_modules |

### Render (deploy futuro)

1. **Node ≥ 22** → defina a variável de ambiente `NODE_VERSION=22` (ou 24) no serviço.
2. **`npm install` baixa o binário do yt-dlp** automaticamente. O postinstall do
   `youtube-dl-exec` tenta checar um `python3` no sistema — para pular essa checagem
   (desnecessária, pois o binário é standalone), defina no Render:
   `YOUTUBE_DL_SKIP_PYTHON_CHECK=true`
3. **ffmpeg** → resolvido pelo `@ffmpeg-installer/ffmpeg` (npm). Nada a instalar.
4. **cookies.txt NÃO sobe para o Render** (está no `.gitignore`). O /play funciona
   sem cookies na maioria dos vídeos; se um vídeo exigir login, o bot responde
   com a mensagem amigável. Para suportar cookies no Render, gere o arquivo em
   runtime ou use `YTDLP_PATH` apontando para um binário+cookies próprios.
5. **Persistência**: os downloads vão para `os.tmpdir()` e são apagados após o envio.

### Outras hospedagens (VPS/Docker)

- Debian/Ubuntu: `apt install python3 pipx && pipx install "yt-dlp[default]"` e
  defina `YTDLP_PATH=/home/usuario/.local/bin/yt-dlp` para usar esse binário.
- Docker com imagem Node: `YOUTUBE_DL_SKIP_PYTHON_CHECK=true` resolve o postinstall.

## Configuração do runtime JS (documentação oficial do yt-dlp)

O yt-dlp resolve os desafios do YouTube com um runtime JavaScript externo
(Deno, **Node.js ≥ 22.0.0**, QuickJS ou Bun). O bot passa por código, em todos
os downloads: `--no-js-runtimes --js-runtimes node` — ou seja, força **apenas**
o Node, garantindo comportamento idêntico no Windows e no Render (onde não
existe Deno).

Também foi criado o arquivo de configuração global do yt-dlp
(`%APPDATA%\yt-dlp\config`) com `--js-runtimes node` para uso manual no terminal.

**Componentes remotos (opcional)**: os scripts de desafio (`yt-dlp-ejs`) já vêm
embutidos no binário. Se o YouTube mudar os desafios e o binário ficar velho,
habilite o download automático deles do GitHub com a variável
`PLAY_REMOTE_EJS=true` (equivale a `--remote-components ejs:github` da doc oficial).

## Variáveis de ambiente do /play (todas opcionais)

| Variável | Padrão | Função |
|---|---|---|
| `PLAY_TIMEOUT_MS` | `90000` | Timeout máximo do download; ao estourar, o processo yt-dlp é morto e o usuário é avisado |
| `PLAY_LIMITE_MB` | `20` | Tamanho máximo do MP3 para envio (acima disso o usuário é avisado) |
| `PLAY_REMOTE_EJS` | `false` | Baixa scripts de desafio atualizados do GitHub |
| `YTDLP_PATH` | *(binário do node_modules)* | Usa outro binário yt-dlp |
| `YOUTUBE_DL_SKIP_PYTHON_CHECK` | *(não definido)* | `true` no Render para pular checagem de `python3` no install |

## Isolamento de erros (garantias implementadas)

- Todo o `/play` está dentro de `try/catch` + `finally`; **nenhum erro escapa**
  para o listener `messages.upsert` ou para a conexão do Baileys.
- Cada `sock.sendMessage` do comando também tem try/catch próprio.
- `bot.js` ganhou uma última linha de defesa: um `.catch()` em
  `comando.executar(...)` que apenas registra o erro no console.
- Timeout de 90s mata o processo do yt-dlp (`subprocess.cancel` + `timeout` do spawn).
- `--max-filesize 25M` evita baixar arquivos gigantes; pós-download há verificação
  de 20 MB antes de enviar.
- Arquivos temporários são apagados no `finally` (mesmo com erro).
- 1 download por chat por vez (trava anti-spam leve).

## Testes

```powershell
node scripts\teste-play.js      # roda os 3 casos
node scripts\teste-play.js 3    # roda só o caso 3
```

Resultado da validação (com o `sock` falso, sem conectar no WhatsApp):

| Caso | Entrada | Resultado |
|---|---|---|
| Vídeo normal | `/play Never Gonna Give You Up` | ✅ MP3 de 6,72 MB em 25,9s |
| Vídeo mais longo | `/play Bohemian Rhapsody Queen` | ✅ MP3 de 10,87 MB em 30,2s |
| Link inexistente | `/play https://www.youtube.com/watch?v=dQw4w9WgXc9` | ✅ "❌ Esse vídeo não está disponível..." em 3,6s, bot vivo |

O envio real pelo WhatsApp usa o mesmo formato dos demais comandos do bot
(`audio` + `mimetype: 'audio/mpeg'`), então o caminho de envio é o mesmo já
validado pelos outros comandos que enviam mídia.

## Manutenção

- Atualizar o binário usado pelo bot: `npm update youtube-dl-exec` (baixa a
  release mais recente do yt-dlp, com os desafios mais atuais).
- Atualizar o yt-dlp global (testes manuais): `winget upgrade yt-dlp`.
- Se um dia voltar a falhar com "Sign in to confirm": renove o `cookies.txt`
  (exporte do navegador logado no YouTube e salve na raiz do projeto).
