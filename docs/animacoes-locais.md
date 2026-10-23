# Animações locais de relacionamentos e comandos adultos

## Escopo

Foram inventariados 63 arquivos locais: 9 de casamento, 5 de namoro e 49
adultos. Não há arquivo sem associação. Os nomes, extensões e conteúdos foram
preservados. Não há novos comandos adultos nem mudanças nos menus, bot.js,
autenticação, sessão WhatsApp, configurações ou repositórios MongoDB.

A observação do loader anterior continua válida: `soco` e `tapa` canônicos são
sombreados pelas brincadeiras; os aliases adultos existentes continuam intactos.
A seleção deste trabalho não altera essas colisões.

## Envio e falhas

`func/animacoes-locais.js` recebe uma lista explícita de caminhos aprovados e
filtra arquivos ausentes antes de sortear com `crypto.randomInt`. Cada arquivo
existente tem a mesma probabilidade, independentemente da extensão. Não há
varredura automática de pastas nem associação de mídias por nomes aproximados.

MP4 vai ao Baileys por caminho (`video: { url: caminho }`), com
`gifPlayback: true` e `mimetype: video/mp4`. GIF é convertido em MP4 H.264/yuv420p
pelo FFmpeg já instalado, sem novas dependências. Valida cabeçalhos, extensão,
arquivo regular, limite de 20 MiB e permanência dentro de assets/gifs, inclusive
ao resolver links simbólicos. Não carrega o acervo nem o vídeo inteiro em Buffer
no código da integração. O Baileys mantém seu próprio processamento de mídia.

A conversão usa um processo por vez, uma thread e prazo de 60 segundos. A saída
é limitada a 640 pixels por dimensão, preservando a proporção. Caminhos são
argumentos de execFile, sem shell. Os temporários são exclusivos por chamada
e removidos após o envio ou uma falha. Não há GIF bruto disfarçado de MP4.

Os relacionamentos só marcam a apresentação animada depois do resultado
confirmado pelo serviço. O marcador transitório WeakSet não adiciona campos às
respostas ou documentos e não participa das regras de negócio. Consultas, erros
e replays de decisões continuam em texto. Propostas repetidas mantêm a resposta
prévia de proposta conforme o comportamento existente.

Se faltar mídia, houver conversor ocupado ou falha de preparação, o relacionamento
envia a mensagem original em texto. Nos comandos adultos, permanece o aviso de
indisponibilidade existente. Uma falha de transporte nunca repete o vídeo ou a
operação de relacionamento e nunca desfaz uma transição persistida. O tratamento
adulto mantém seu aviso textual de erro. Logs novos usam somente eventos fixos.

## Casamento e namoro

| Comando | Arquivos em assets/gifs/ | Probabilidade por arquivo |
|---|---|---|
| `casar` | `casamento/casar1.mp4`, `casamento/casar2.mp4`, `casamento/casar3.mp4`, `casamento/casar4.mp4` | 1/4 |
| `aceitar` | `casamento/aceitar1.mp4`, `casamento/aceitar2.mp4`, `casamento/aceitar3.mp4` | 1/3 |
| `recusar` | `casamento/recusar.mp4` | 1/1 |
| `divorciar` | `casamento/divorciar.mp4` | 1/1 |
| `namorar` | `namoro/namorar.mp4` | 1/1 |
| `aceitarnamoro` | `namoro/aceitarnamoro.mp4` | 1/1 |
| `recusarnamoro` | `namoro/recusarnamoro1.mp4`, `namoro/recusarnamoro2.gif` | 1/2 |
| `terminar` | `namoro/terminar.mp4` | 1/1 |

## Comandos adultos e mídias

As listas antigas foram mantidas. Só foram acrescentadas as quatro variantes de
esfregar, duas de pgpeito e a animação baternabunda. Esta última pertence à mesma
ação já oferecida por tapabunda1/tapabunda2, ficando disponível em ambos sem
mudar suas legendas, aliases ou criar um comando baternabunda.

| Comando existente | Arquivos em assets/gifs/ |
|---|---|
| `arrancarcalcinha` | `arrancarcalcinha/arrancarcalcinha.gif` |
| `atirar1` | `atirar/atirar.mp4` |
| `atirar2` | `atirar/atirar2.mp4` |
| `beijogostoso` | `beijogostoso/beijogostoso.mp4` |
| `beijolesbico` | `beijolesbico/beijo-lesbico.mp4` |
| `blow1` | `blow/blow1.mp4` |
| `blow2` | `blow/blow2.mp4` |
| `caranopeito` | `caranopeito/caranopeito.mp4` |
| `cartasecreta` | `cartasecreta/cartasecreta.mp4` |
| `chuparpeito1` | `chuparpeito/chuparpeito.gif` |
| `chuparpeito2` | `chuparpeito/chuparpeito2.gif` |
| `chutar1` | `chutar/chutar.mp4` |
| `chutar2` | `chutar/chutar2.mp4` |
| `comer1` | `comer/comer.gif` |
| `comer2` | `comer/comer2.gif` |
| `comer3` | `comer/comer3.gif` |
| `comer4` | `comer/comer4.gif` |
| `comer5` | `comer/comer5.gif` |
| `esfregar` | `esfregar/seesfregar.gif`, `esfregar/seesfregar1.gif`, `esfregar/seesfregar2.gif`, `esfregar/seesfregar3.gif`, `esfregar/seesfregar4.gif` |
| `lambida1` | `lambida/lambida1.gif` |
| `lambida2` | `lambida/lambida2.gif` |
| `lambidarosto1` | `lambidarosto/lambidanorosto.mp4` |
| `lambidarosto2` | `lambidarosto/lambidanorosto2.mp4` |
| `mamar` | `mamar/mamar.mp4` |
| `matar1` | `matar/matar.mp4` |
| `matar2` | `matar/matar2.mp4` |
| `morder` | `morder/morder.mp4` |
| `mostrapeito` | `mostrarpeito/mostrarpeito.mp4` |
| `pgpeito` | `pgpeito/pegarnopeito.mp4`, `pgpeito/pegarnopeito2.gif`, `pgpeito/pegarnopeito3.gif` |
| `rebolar1` | `rebolar/rebolar.gif` |
| `rebolar2` | `rebolar/rebolar2.mp4` |
| `risada` | `risada/risada.mp4` |
| `sentada1` | `sentada/sentada.gif` |
| `sentada2` | `sentada/sentada1.gif` |
| `sentada3` | `sentada/sentada2.mp4` |
| `sentar1` | `sentar/sentar.gif` |
| `sentar2` | `sentar/sentar2.gif` |
| `soco` | `soco/soco.mp4` |
| `tapa` | `tapa/tapa.mp4` |
| `tapabunda1` | `tapabunda/tapanabunda.mp4`, `baternabunda/baternabunda.gif` |
| `tapabunda2` | `tapabunda/tapanabunda2.mp4`, `baternabunda/baternabunda.gif` |
| `tesourar` | `tesourar/tesourar.gif` |

## Envio manual à LatamHost

Todos os caminhos são relativos à raiz do projeto. Enviar estes cinco arquivos
JavaScript, criando as pastas que ainda não existirem:

```text
dados/casamento-olimpo.js
dados/comandos-adulto.js
comandos/menu-adulto/comandos-adulto.js
dados/animacoes-relacionamentos.js
func/animacoes-locais.js
```

Os dois últimos são módulos novos. Os três primeiros substituem somente os
respectivos arquivos da funcionalidade; bot.js não precisa de alteração.

Enviar também estes 21 arquivos de mídia novos, mantendo as 42 mídias anteriores:

```text
assets/gifs/baternabunda/baternabunda.gif
assets/gifs/casamento/aceitar1.mp4
assets/gifs/casamento/aceitar2.mp4
assets/gifs/casamento/aceitar3.mp4
assets/gifs/casamento/casar1.mp4
assets/gifs/casamento/casar2.mp4
assets/gifs/casamento/casar3.mp4
assets/gifs/casamento/casar4.mp4
assets/gifs/casamento/divorciar.mp4
assets/gifs/casamento/recusar.mp4
assets/gifs/esfregar/seesfregar1.gif
assets/gifs/esfregar/seesfregar2.gif
assets/gifs/esfregar/seesfregar3.gif
assets/gifs/esfregar/seesfregar4.gif
assets/gifs/namoro/aceitarnamoro.mp4
assets/gifs/namoro/namorar.mp4
assets/gifs/namoro/recusarnamoro1.mp4
assets/gifs/namoro/recusarnamoro2.gif
assets/gifs/namoro/terminar.mp4
assets/gifs/pgpeito/pegarnopeito2.gif
assets/gifs/pgpeito/pegarnopeito3.gif
```

O inventário acima contém todas as 63 mídias esperadas. Caso alguma das 42
anteriores não esteja na hospedagem, enviar também o arquivo correspondente
sem renomear. Os testes e este documento são apenas de desenvolvimento.

## Validação e limites

- `node scripts/teste-animacoes-locais.js`: caminhos, sorteio, MP4, conversão de GIF,
  limpeza, falhas, concorrência e ausência de retry; inclui FFmpeg real local.
- `node scripts/teste-animacoes-comandos.js`: oito comandos de relacionamento,
  permissões, estado, replay, mensagens/menções, evolução namoro-casamento e os
  42 comandos adultos com modo desligado, ligado e uso privado.
- Regressões: casamento, menus, ON/OFF, proteção, loader, Arcontes, histórico,
  prefixo e conexão, com rede e MongoDB reais bloqueados.

A validação local não confirma exibição em um WhatsApp real, entrega na rede ou
disponibilidade do FFmpeg na LatamHost. Sob concorrência de conversões há fallback,
sem acumular processos na hospedagem. SIGKILL/OOM pode deixar um temporário, pois
nenhum finally é garantido em encerramento forçado. Não há nova variável de ambiente.
