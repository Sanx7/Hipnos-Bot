# /gun na LatamHost: implantação e reversão propostas

Nada neste plano foi executado na hospedagem. Não houve instalação, commit,
push ou deploy. Não alterar `.env`, sessões, MongoDB ou dados persistentes.
Manter `DISABLE_CANVAS=true`; os outros 23 comandos continuam bloqueados.

Conjunto de código desta revisão: `comandos/menu-efeitos/efeitos-visuais.js`,
`func/renderizador-canvas.js`, `func/renderizador-canvas-worker.js`,
`func/gun-download-worker.js` e `func/receber-imagem-gun.js`. Preparar/restaurar
esses arquivos em conjunto; testes e documentação ficam fora do fluxo do bot.

## O que muda nesta revisão

- Uma reserva por processo cobre todo `/gun`, desde antes de baixar até terminar
  o envio/limpeza. Não há fila. Solicitações adicionais recebem aviso imediatamente.
- O download grava por streaming em arquivo exclusivo (0600), com backpressure
  e corte no primeiro chunk que ultrapasse 20 MiB de conteúdo descriptografado.
  O chunk excedente não é gravado. Não há `Buffer.concat` de toda a foto no pai.
  O downloader antigo permanece intacto para os demais comandos.
- A versão instalada do Baileys retorna um Transform, mas `getHttpStream` ignora
  `options.signal`, e usa `fetched.pipe(output)` sem propagar a destruição ao
  transporte. Por isso o download usa um filho descartável com o Baileys original,
  sem alterar a biblioteca/dependências ou substituir sua descriptografia.
  Timeout total de 30 s (inclui abertura/importação), SIGKILL e término explícito
  fecham também a conexão HTTP. O pai envia somente URL/directPath/mediaKey por
  stdin, em ambiente mínimo sem credenciais; nada disso vai para logs/argumentos.
- Header de imagem é inspecionado sem decodificação completa: no máximo 20 MiB,
  8.388.608 pixels e 8192 pixels por lado. SVG é recusado. As fotos raster válidas
  mantêm o PNG 480×480, recorte, cores e posição baseada no buffer original.
  A inspeção completa ocorre no filho de renderização, ANTES de carregar Skia,
  preservando JPEG com metadados longos. O pai não lê a foto original.
- Skia é carregado apenas em um filho descartável, sem herdar credenciais nem
  `NODE_OPTIONS` da produção. Timeout de 15 s com SIGKILL; erros e término fatal
  tornam-se aviso ao usuário, sem importar o binding no processo do bot.
- O filho termina antes do FFmpeg; miniatura usa uma thread, timeout de 30 s e
  fallback JPEG existente. O PNG não depende do sucesso da miniatura.
  Download, renderização e FFmpeg do `/gun` são fases sequenciais. O adaptador
  aguarda `close`, inclusive após AbortSignal, antes de limpar/liberar a reserva.
- Entrada temporária com permissão 0600, pasta exclusiva, remoção em `finally`.
  Após encerramento do filho, a memória nativa é liberada pelo SO; buffers no
  pai deixam de ser referenciados, sem forçar GC global do bot.

## Orçamento de memória

O valor informado de 287 MB é aproximado. Para planejar, tratar como 287 MiB
(mais conservador se o painel usa MB decimais): sobram nominalmente 225 MiB.

| Parcela | Evidência / orçamento inicial |
| --- | --- |
| Bot Node.js já em execução | 287 MiB informados, não medidos nesta sessão |
| Aumento de RSS do pai com streaming e alta entropia | 1,24–2,02 MiB nos três casos pesados desta medição Windows |
| Processo de download (Baileys + AES + stream) | até 93,35 MiB nos três casos pesados desta medição Windows |
| Worker Node.js + Skia no limite de pixels | até 116,33 MiB nos três casos pesados desta medição Windows |
| FFmpeg do `/gun` | 64 MiB provisionais; medir em Linux |
| Margem adicional | 32 MiB |

Download, worker e FFmpeg desse comando não coexistem. Fórmula usada pelo teste:

`287 + aumento_RSS_pai + max(pico_download, pico_worker, pico_FFmpeg, 64) + 32`

No ensaio Windows anterior, com imagens simples, resultou em **414,71 MiB**, com cerca de 97 MiB até o teto.
É uma estimativa, não uma soma de resultados Linux de produção. Inclui heap,
buffers e alocações nativas representados pelo RSS; não permite prever todo
cache de arquivos, fragmentação ou outros comandos concorrentes.

Admissão em runtime: recusar quando RSS do pai >320 MiB ou memória disponível
para o processo <160 MiB. Reavaliar antes do download, do worker e do FFmpeg.
Essas verificações não reservam RAM nem impedem outro comando de consumir memória
logo em seguida. Teto de heap JS de 64 MiB no filho também não é teto de RSS.
OOM do cgroup pode matar qualquer processo, inclusive o pai: isolamento do filho
contém falhas nativas locais, não oferece garantia absoluta contra OOM global.

## Validação ampliada: resultados e limites

**A validação de capacidade para implantação ainda não está concluída.** O pico
de concatenações foi corrigido e os casos locais passaram. Falta executar esta
revisão no Linux/cgroup. Esses resultados não autorizam uma implantação.

### Resultado atual: streaming isolado, 18/10/2026

`node scripts/teste-gun-capacidade.js`, Windows x64 / Node.js 24.17.0. O preload
offline substitui apenas `fetch` por um stream local criptografado incrementalmente;
o Baileys instalado e a descriptografia AES são reais. Proíbe rede, `.env` e
Canvas no downloader. Não há buffers contendo a foto inteira no pai nem no
gerador HTTP simulado. A geração das fixtures roda em outro processo.

| Entrada válida (4096×2048) | Bytes | Pico RSS pai | Pico downloader | Pico render | Projeção base 287 MiB |
| --- | ---: | ---: | ---: | ---: | ---: |
| PNG detalhado | 20.554.291 | 90,58 MiB | 93,35 MiB | 116,16 MiB | 437,18 MiB |
| JPEG detalhado | 15.672.163 | 90,56 MiB | 86,22 MiB | 111,46 MiB | 431,70 MiB |
| PNG no limite exato | 20.971.520 | 90,75 MiB | 91,48 MiB | 116,33 MiB | 436,88 MiB |

Os três completaram com PNG 480×480, mira baseada no comprimento original e
miniatura FFmpeg real de 64 px. A base de RSS modelada em 287 MiB também
completou: pico projetado do pai 289,24 MiB, estimativa 437,61 MiB. Modelar o
RSS não equivale a executar/alocar o bot completo.

O caso acima do limite oferece 20 MiB + 1 byte e mais 4 MiB de cauda: o corte
ocorreu ao processar **21.037.040 bytes**, antes de consumir tudo, sem iniciar
renderização/miniatura. O arquivo nunca excedeu 20 MiB. Há até um chunk excedente
e buffers de transporte/AES em trânsito; limite de arquivo não é teto exato da rede.
Uma repetição instrumentada confirmou que a própria origem parou em
21.233.665 de 25.165.825 bytes oferecidos, contando o read-ahead; não apenas o
contador de gravação. Essa instrumentação escreve somente métrica sintética na
pasta descartável de fixtures, removida ao terminar o teste.

Também passaram: erro durante recebimento, timeout antes dos headers HTTP,
timeout após gravação parcial, cancelamento após gravação parcial, limpeza antes
da recuperação e nova renderização grande após cada falha. No teste os timeouts
são encurtados, com confirmação do valor de produção de 30 s. Há teste de
recusa de solicitações simultâneas durante o download, sem fila/download extra.
O teste de streaming cobre 20 MiB exatos, erro de disco, entrada vazia,
destruição da fonte e modo 0600 no Linux (não validado no Windows).

As duas mídias FFmpeg reais e a guarda de baixa memória simulada também passaram.
A suíte antiga mantém mocks de Buffer apenas na fronteira do download; os casos
de capacidade exercitam o fluxo novo completo. Os 16 casos visuais, 20 fluxos
de memória da suíte anterior e a compatibilidade (23 bloqueios) passaram.

O ganho em relação ao achado abaixo é no pai: aumento de aproximadamente
1,2–2,3 MiB nesses casos, em vez de 159–197 MiB. O downloader tem custo próprio,
incluído na fórmula e liberado pelo SO antes do renderizador. O maior valor
projetado desta tabela deixa cerca de **75 MiB** até 512 MiB, com os 32 MiB de
margem já somados. Não é medição conjunta de produção.

Restam confirmar no Linux: RSS conjunto, pico total de cgroup/cache de arquivos,
pressão real concorrente, latência de importação/conexão/download dentro de 30 s,
permissões/espaço do temporário e comportamento da rede real. O limite de heap
de 64 MiB dos filhos não limita seu RSS. Outros comandos ainda podem competir
por RAM; o teste não garante ausência de OOM global. Uma interrupção forçada do
processo pai/host impede `finally`; a limpeza foi validada para falhas dos filhos,
cancelamento e timeouts com o pai vivo. Falha de remoção após retries gera evento
sanitizado e exige investigação, sem varrer temporários de outros comandos.

### Resultado Linux informado pelo usuário

A execução mais recente de `teste-canvas-latamhost` foi informada como aprovada,
com cgroup de 512 MiB, `oom_kill=0`, pico conjunto **amostrado** de **221,79 MiB**
e estimativa com base no bot de 287 MiB de **423,3 MiB**. Não foram acessados os
logs, SHA ou hospedagem nesta sessão. Esses números se referem à suíte anterior;
não demonstram execução dos casos ampliados abaixo. Pico amostrado de RSS também
não é o mesmo que `memory.peak` do cgroup, que inclui cache de arquivos.

### Histórico: casos antes do streaming

Comando: `node scripts/teste-gun-capacidade.js`, Node.js 24.17.0 / Windows x64.
Todas as entradas são sintéticas e geradas em pasta temporária removida no final.
Não há bot real, dados de usuários, WhatsApp ou MongoDB. A geração roda em filho
separado, sem carregar Canvas/Skia no processo que mede o comando.

| Caso | Entrada | Resultado local |
| --- | --- | --- |
| PNG detalhado | 4096×2048 = 8.388.608 pixels; 20.554.291 bytes (~19,60 MiB) | PNG 480×480, mira correta e miniatura real 64 px |
| JPEG detalhado | Mesmas dimensões; 15.672.163 bytes (~14,95 MiB) | Fluxo completo aprovado |
| Limite exato | PNG válido de 20.971.520 bytes = 20 MiB | Fluxo completo aprovado em processo isolado |
| Um byte acima | PNG válido de 20.971.521 bytes | Recusado sem iniciar renderizador/miniatura |
| Base de RSS modelada em 287 MiB | PNG detalhado; RSS exposto à guarda ajustado, sem alocar um bot fictício | Recusado por memória antes do worker; nenhuma fila |
| Duas mídias reais concorrentes | Dois FFmpeg limitados, `testsrc2` 640×360/10 fps, saída nula; `/gun` com PNG detalhado de 1024×768 (~2,25 MiB) | Renderizador e miniatura completaram enquanto ambos estavam ativos |
| Guarda sob carga | Dois FFmpeg ativos e memória disponível simulada abaixo de 160 MiB | Três solicitações recusadas sem download/worker; retomada após liberar a carga |

O PNG grande contém **20.554.234 bytes de IDAT** com textura RGB determinística
de alta frequência. Não é uma imagem uniforme inflada por zeros. Para os dois
arquivos na fronteira dos 20 MiB, foi adicionado um chunk ancillary privado
válido, antes do IEND e com CRC, de menos de 0,4 MiB; o conteúdo de pixels é o
mesmo. A posição da mira considera o tamanho de cada arquivo original.

O mock do download repete o padrão real de `Buffer.concat` em chunks de 64 KiB,
lendo somente essas fixtures locais. Isso testa alocações de buffers; não simula
latência, criptografia, retransmissões ou todos os tamanhos de chunks do WhatsApp.

### Histórico do risco corrigido nesta revisão

Em uma execução local, os picos de RSS do pai chegaram a **248–286 MiB**, partindo
de aproximadamente **89 MiB**. Os workers chegaram a **110–115 MiB**. O custo
elevado aparece durante o download por concatenações sucessivas; ele ocorre
antes de o adaptador inspecionar as dimensões e pode existir até em uma recusa.

A fórmula anterior, aplicada SEM modelar a recusa com base inicial de 287 MiB,
produziu aproximadamente **588–631 MiB**, acima do teto. É uma projeção
conservadora de picos, que podem ocorrer em instantes distintos; **não** é uma
medição conjunta da LatamHost nem prova de que o bot atingiria esse total.
Naquela revisão o campo se chamava `estimativaSemRecusaBase287MiB`.

O caso `base287` verificava separadamente que a guarda de RSS recusava a imagem antes
de lançar o worker. Isso protege essa fase, mas não desfaz o pico de download já
ocorrido. Portanto, capacidade para imagens próximas de 20 MiB com o bot real
de 287 MiB **não está aprovada**. Antes de liberar esse envelope, revisar o custo
de concatenação/streaming ou o tamanho aceito, como uma mudança separada com seus
próprios testes. A revisão atual acima implementa essa correção; dependências
continuam intactas. Os números desta seção são anteriores à correção.

### Pressão física de RAM: pendente de Linux

Não há Docker/Linux disponível neste ambiente Windows. A pressão física NÃO foi
executada localmente, nem os RSS dos processos FFmpeg foram medidos aqui. Os
campos Linux saem como `null`; a simulação não deve ser apresentada como pressão
real. As duas tarefas FFmpeg, a recusa simulada e a recuperação foram reais nos
aspectos explicitados acima, sem esgotar a RAM da máquina de desenvolvimento.

No workflow, `GUN_CI_CGROUP=1` torna obrigatórias as verificações de Linux,
`memory.max=536870912`, `memory.swap.max=0` e `memory.swap.current=0`. O helper de
pressão aloca páginas em incrementos de 4 MiB, com teto de 256 MiB, até deixar
menos de 152 MiB disponíveis. Ele aborta se não houver margem segura, tem prazo
de 12 s e é encerrado no `finally`; não tenta provocar OOM. Se não alcançar a
pressão com segurança, o teste falha, em vez de registrar aprovação.

Com os dois FFmpeg ainda ativos, a guarda real deve recusar antes do download.
Depois, todos os filhos são encerrados e o teste exige retomada. No Linux há
amostragem de RSS da subárvore e comparações de `/proc/<pid>/cgroup` para cenários,
downloader, worker, FFmpeg e carga de pressão. O RSS da subárvore não inclui o processo do
harness acima dela; o cgroup do workflow inclui TODOS e é a referência total.

## Verificação do workflow

Foi conferida a chamada explícita da suíte nova dentro de `/ci/limited.sh`, no
ramo offline do mesmo `docker run --memory=512m --memory-swap=512m`, com rede
`none`. A geração das fixtures e todos os cenários são filhos desse processo.
Não há execução da suíte no runner fora do contêiner. Permanecem as proteções
de credenciais, sessões, dados, import do bot real, checksums e OOM. `actionlint`
e verificações locais de sintaxe são validação estática, não execução Linux.
Também foi verificado que o modo estrito recusa o Windows antes de gerar
fixtures ou alocar a carga de pressão; ele não faz fallback silencioso no CI.

A nova revisão precisa ser enviada pelo usuário e disparada manualmente em
`teste-canvas-latamhost`. Exigir logs de `FIXTURES`, onze casos `CAPACIDADE`,
`PRESSAO` com `protecao=cgroup_real`, eventos OOM zerados e pico de cgroup.
Se houver recusa por memória em um caso que exige renderização, ou qualquer OOM,
o workflow falha; também falha se a projeção pesada com base de 287 MiB atingir
512 MiB. Os campos `margem448MiB=false` exigem revisão de capacidade
mesmo quando os testes funcionais passam.

## Bindings nativos: o que está confirmado e o que falta

- Manifesto/lock locais: `@napi-rs/canvas@1.0.11` e variantes Linux x64 GNU/musl
  em 1.0.11. Metadados públicos do pacote GNU confirmam `linux`, `x64`, `glibc`,
  `skia.linux-x64-gnu.node` e engine `node >=10`. Isso não prova carregamento no
  servidor específico. Não houve instalação de dependências nesta etapa.
- O backend usa Node-API. Sua estabilidade de ABI ajuda a compatibilidade entre
  versões Node, mas não cobre bibliotecas do SO/CPU nem substitui teste real.
- A documentação distribuída com 1.0.11 informa glibc mínima 2.18 para Skia.
  Para os binários oficiais de Node.js 24, a plataforma GNU/Linux x64 suportada
  exige kernel >=4.18, glibc >=2.28 e libstdc++ >=6.0.25 (`GLIBCXX_3.4.25`).
  Não usar apenas o mínimo 2.18 do Skia como requisito do ambiente inteiro.
- O workflow ampliado exige Linux x64 e registra Node, versão Node-API, glibc,
  versão do pacote e basename do binding realmente carregado. Exige o GNU x64
  no Ubuntu 24.04, além de codificar e decodificar PNG com o módulo nativo real.
- Falta confirmar na LatamHost: versão/build exata do Node 24, CPU x64 e suas
  instruções, kernel, glibc versus musl, libstdc++, política para processos filhos,
  permissões/espaço de temporários, binding 1.0.11 completo (inclusive arquivos
  auxiliares distribuídos) e orçamento total sob outras cargas reais. Nada disso
  foi consultado no servidor. Se for musl, o teste GNU em Ubuntu não valida esse
  ambiente: exigir cópia isolada equivalente com a variante musl.

Fontes de compatibilidade: [README do backend](https://github.com/Brooooooklyn/canvas#system-requirement),
[metadados GNU 1.0.11](https://registry.npmjs.org/@napi-rs%2Fcanvas-linux-x64-gnu/1.0.11),
[Node.js 24 BUILDING](https://github.com/nodejs/node/blob/v24.x/BUILDING.md#supported-platforms)
e [limites da estabilidade Node-API](https://nodejs.org/api/n-api.html#implications-of-abi-stability).

## Critérios antes de autorizar a implantação

1. Executar novamente o workflow manual na branch com **esta revisão**. A aprovação
   anterior informada pelo usuário validava a implementação antes destas mudanças.
   Exigir testes verdes, cgroup 512 MiB sem swap e eventos OOM zerados.
2. Conferir os 16 casos visuais, nenhuma fila/download extra, limites de pixels,
   reserva até o envio, recuperação após erro/timeout/término fatal e limpeza.
3. Ler as métricas Linux do teste `memoria`: RSS conjunto amostrado, pico do
   worker, pico FFmpeg e estimativa com base 287 MiB. Investigar resultado acima
   de 448 MiB ou crescimento persistente; não liberar se não houver margem.
4. Executar a suíte ampliada de capacidade no Linux e revisar o envelope de
   entradas com o baseline real de 287 MiB. Os casos de alta entropia e streaming
   descritos acima não foram cobertos pela execução Linux anterior informada.
   A aprovação desses casos e da pressão física continua pendente.
5. Validar Node.js 24, arquitetura e libc do destino e o carregamento do binding
   correspondente em ambiente equivalente. Não copiar binários do Windows.

## Implantação futura, somente após autorização

1. Guardar o pacote da versão atual e uma lista/hash dos arquivos de código que
   serão substituídos. Não copiar credenciais ou dados para logs/artefatos de CI.
2. Preparar fora da LatamHost um pacote revisado com o código do `/gun`, adaptador,
   recebedor de stream e ambos os workers. Se o backend ainda não estiver disponível no destino, preparar em
   Linux compatível somente `@napi-rs/canvas` e seu binding da plataforma, nas
   versões já travadas. Não executar npm install/ci/rebuild na hospedagem, não
   sobrescrever Sharp/FFmpeg/Baileys/MongoDB ou a árvore inteira de node_modules.
3. Planejar uma parada/reinício controlados de uma única instância. Substituir os
   arquivos de código como um conjunto coeso, sem trocar sessões, variáveis,
   diretórios de dados ou configurações do painel.
4. Após autorização específica para teste real, fazer uma chamada por vez e
   depois uma segunda enquanto a primeira está ativa. A segunda deve ser recusada
   sem download. Observar memória total e retorno ao patamar estável, latência,
   erros e limpeza. Confirmar os outros 23 bloqueios.
5. Interromper a liberação e reverter se houver OOM/reinício inesperado, crescimento
   contínuo, consumo total sustentado acima de 448 MiB ou alteração visual/funcional.
   Não compensar aumentando o limite da hospedagem ou alterando dependências.

## Reversão

- Parar a instância e restaurar somente o conjunto de arquivos de código da
  versão anterior conhecida. Não misturar adaptador novo com comando antigo.
- Se a versão anterior bloqueava `/gun` com `DISABLE_CANVAS=true`, esse bloqueio
  volta naturalmente, mantendo os demais comandos no estado anterior.
- O pacote novo pode permanecer inativo no disco, se tiver sido incluído no
  pacote de implantação. Não é necessário npm install/uninstall para reverter.
- Reiniciar uma única instância com a sessão e configuração existentes e conferir
  o consumo de memória. Não restaurar snapshots de MongoDB ou arquivos de dados.

Fontes: [Node.js process.availableMemory](https://nodejs.org/docs/latest-v24.x/api/process.html#processavailablememory)
e [execFile/timeout](https://nodejs.org/docs/latest-v24.x/api/child_process.html#child_processexecfilefile-args-options-callback).
