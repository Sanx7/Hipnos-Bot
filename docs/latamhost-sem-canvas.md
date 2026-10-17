# Execução temporária na LatamHost sem Canvas nativo

O modo é opt-in: configure `DISABLE_CANVAS=true` nas variáveis do painel ou
no `.env` e reinicie. Sem esse valor, os imports nativos e as implementações
originais continuam ativos; erros de Canvas ausente/quebrado não são ocultados.
A variável do painel tem prioridade sobre o `.env`.
O parser aceita `true` independentemente de maiúsculas e espaços externos;
ausência, `false`, `0`, `1` e outros valores não ativam o modo. No comando de
instalação Linux use literalmente `DISABLE_CANVAS=true`.

## Instalação Linux

`DISABLE_CANVAS` controla o runtime; sozinho não muda o comportamento do npm.
Para evitar a compilação na LatamHost, execute na raiz do projeto:

```sh
chmod +x scripts/npm-shell-sem-canvas.sh
DISABLE_CANVAS=true npm ci --ignore-scripts=false --script-shell="$PWD/scripts/npm-shell-sem-canvas.sh"
```

Depois, mantenha `DISABLE_CANVAS=true` configurado para `npm start`.
A atribuição antes de `npm ci` vale somente para aquele processo: não configura
o ambiente dos próximos reinícios. O npm não lê o `.env` do projeto.
Se o painel instala automaticamente, configure esse comando de instalação
personalizado. Apenas adicionar a variável ao painel não evita o install padrão.

O shell verifica `npm_package_name=canvas`, `npm_lifecycle_event=install` e
`DISABLE_CANVAS=true`. Só nesse caso omite o comando nativo, emitindo aviso.
Para todo o restante executa `/bin/sh` com os argumentos originais e propaga
o código de saída. Os scripts de Sharp, FFmpeg, Baileys etc. continuam ativos.
O wrapper é Linux/POSIX; não altere globalmente `script-shell` no npm.

Não há Canvas falso: o pacote JS continua na árvore instalada, mas seu script
de instalação (`prebuild-install -r napi || node-gyp rebuild`) não é executado.
Em uma instalação limpa, não haverá binding nativo utilizável. Não execute
`npm rebuild canvas` nesse servidor enquanto faltarem as bibliotecas do sistema.
O `npm ci` recria `node_modules`; use durante a preparação da hospedagem,
com o processo do bot parado. Nenhuma alteração de manifesto/lock é necessária.

Por que não `--ignore-scripts`? Ele afetaria todas as bibliotecas.
Por que não `--omit=optional`? Canvas é dependência direta obrigatória e peer
de TikTok; além disso, a omissão excluiria binários opcionais de FFmpeg/Sharp.
Transformá-lo em opcional, sozinho, ainda permitiria tentar sua compilação.
Referências: [configurações do npm](https://docs.npmjs.com/cli/using-npm/config/)
e [dependências opcionais](https://docs.npmjs.com/cli/configuring-npm/package-json/).

Para voltar ao modo normal em um servidor com suporte nativo, execute `npm ci`
sem o shell personalizado, remova a variável (ou use `false`) e reinicie.
Nenhuma renderização, resolução ou qualidade foi alterada.

## Mapeamento de dependências

| Arquivo | Uso real de Canvas | Indisponíveis somente com `DISABLE_CANVAS=true` |
| --- | --- | --- |
| `comandos/menu-fig/attp.js` | `createCanvas`: frames PNG para figurinha animada | `attp` |
| `comandos/menu-fig/brat.js` | `createCanvas`: capa e frames | `brat`, `bratvid` |
| `comandos/menu-efeitos/efeitos-imagem.js` | `createCanvas`/`loadImage`: cards de par, recorte e composição de memes | `kiss`, `kissme`, `ship`, `shipme`, `clown`, `slap`, `spank`, `batslap`, `beautiful`, `bobross`, `ad`, `rip`, `apagar` |
| `comandos/menu-efeitos/efeitos-visuais.js` | `createCanvas`/`loadImage`: frames animados, astronauta e mira | `glitchgif`, `rotacao3d`, `fogogif`, `derreter`, `naoolhe`, `falha`, `impostor`, `gun` |

São 24 comandos; seus nomes e aliases continuam registrados e respondem com
aviso de indisponibilidade, sem baixar mídia, reagir ou iniciar renderização.
Inclui os aliases `deletar`, `delete-foto`, `lápide`, `lapide` e `nao-olhe`.

Os demais comandos dos mesmos arquivos continuam com suas funções originais:
overlays e filtros de API/Jimp, `contraste`, `espelhar`, `pixel`, `textopulsar`,
`ondasanim`, `vhs`, `entidade`, `conquista` e `cerebro`. Os avisos preexistentes
de `bolsonaro` e `sfundo` permanecem. Perfil, ranking e boas-vindas usam Jimp,
portanto não precisam ser bloqueados.

Dependência indireta: `tiktok.js` → `@tobyg74/tiktok-api-dl` → `jsdom` →
`jsdom/lib/jsdom/utils.js`, que tenta `require('canvas')` dentro de `try/catch`
e define Canvas como ausente se falhar. `tiktok-audio.js` reutiliza `tiktok.js`.
Esses downloads não usam a renderização HTML Canvas. Os comandos permanecem;
a tentativa opcional de jsdom foi verificada com módulo ausente e binding
quebrado, sem alterar `node_modules` ou interceptar imports em produção.

Scripts offline com import direto: `scripts/teste-efeitos.js` e
`scripts/teste-efeitos-visuais.js` geram fotos sintéticas com Canvas real.
`teste-brat.js` e `teste-temavip.js` também o usam indiretamente via comandos.
Essas suítes continuam exigindo Canvas para validar as mídias do modo normal.
Referências a `/canvas` em URLs da Some Random API, variáveis de desenho e
comentários sobre Jimp não representam imports adicionais de node-canvas.

## Verificação offline

```sh
node scripts/teste-compatibilidade-canvas.js
node scripts/teste-npm-shell-sem-canvas.js
```

O primeiro executa o código de `bot.js` em VM com as fronteiras de Express,
MongoDB/sessão/lease e criação de socket mockadas, bloqueando conexões de rede.
Executa o loader real e verifica 594 entradas e listeners de inicialização.
Cobre Canvas ausente, binding quebrado, modo normal com falhas explícitas e
modo normal com Canvas nativo instalado. Verifica os 24 avisos e aliases,
Jimp real e o carregamento indireto por jsdom.
Compara também todas as entradas entre os modos, garantindo metadados idênticos
e mudança de executor exclusivamente nos 24 comandos, além de oito casos de
interpretação da variável de ambiente.

O segundo executa o shell com ambientes de lifecycle simulados e confirma que
somente o install de Canvas é pulado e falhas de outras bibliotecas propagam.
No Windows usa o `sh` do Git; pode-se definir `TEST_SH` para outro caminho.

Validação complementar no modo normal: `teste-efeitos.js`,
`teste-efeitos-visuais.js`, `teste-brat.js`, `teste-temavip.js`,
`teste-on-off.js` e `teste-loader.js`, com URIs Mongo vazias.

Limites: não foi feita instalação integral na LatamHost/Linux, conexão real
ao WhatsApp/MongoDB ou download em APIs. O shell não resolve falhas nativas
de outras bibliotecas. Não foi executado deploy manual nem acesso à produção.
