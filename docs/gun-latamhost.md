# /gun na LatamHost: implantação e reversão propostas

Nada neste plano foi executado na hospedagem. Não houve instalação, commit,
push ou deploy. Não alterar `.env`, sessões, MongoDB ou dados persistentes.
Manter `DISABLE_CANVAS=true`; os outros 23 comandos continuam bloqueados.

## O que muda nesta revisão

- Uma reserva por processo cobre todo `/gun`, desde antes de baixar até terminar
  o envio/limpeza. Não há fila. Solicitações adicionais recebem aviso imediatamente.
- Header de imagem é inspecionado sem decodificação completa: no máximo 20 MiB,
  8.388.608 pixels e 8192 pixels por lado. SVG é recusado. As fotos raster válidas
  mantêm o PNG 480×480, recorte, cores e posição baseada no buffer original.
- Skia é carregado apenas em um filho descartável, sem herdar credenciais nem
  `NODE_OPTIONS` da produção. Timeout de 15 s com SIGKILL; erros e término fatal
  tornam-se aviso ao usuário, sem importar o binding no processo do bot.
- O filho termina antes do FFmpeg; miniatura usa uma thread, timeout de 30 s e
  fallback JPEG existente. O PNG não depende do sucesso da miniatura.
- Entrada temporária com permissão 0600, pasta exclusiva, remoção em `finally`.
  Após encerramento do filho, a memória nativa é liberada pelo SO; buffers no
  pai deixam de ser referenciados, sem forçar GC global do bot.

## Orçamento de memória

O valor informado de 287 MB é aproximado. Para planejar, tratar como 287 MiB
(mais conservador se o painel usa MB decimais): sobram nominalmente 225 MiB.

| Parcela | Evidência / orçamento inicial |
| --- | --- |
| Bot Node.js já em execução | 287 MiB informados, não medidos nesta sessão |
| Aumento de RSS do pai no ensaio local | aproximadamente 0,96 MiB; imagens reais comprimidas podem usar mais |
| Worker Node.js + Skia no limite de pixels | 94,75 MiB de pico medidos no Windows |
| FFmpeg do `/gun` | 64 MiB provisionais; medir em Linux |
| Margem adicional | 32 MiB |

O worker e o FFmpeg desse comando não coexistem. Fórmula usada pelo teste:

`287 + aumento_RSS_pai + max(pico_worker, pico_FFmpeg, 64) + 32`

No ensaio Windows resultou em **414,71 MiB**, com cerca de 97 MiB até o teto.
É uma estimativa, não uma soma de resultados Linux de produção. Inclui heap,
buffers e alocações nativas representados pelo RSS; não permite prever todo
cache de arquivos, fragmentação ou outros comandos concorrentes.

Admissão em runtime: recusar quando RSS do pai >320 MiB ou memória disponível
para o processo <160 MiB. Reavaliar antes do download, do worker e do FFmpeg.
Essas verificações não reservam RAM nem impedem outro comando de consumir memória
logo em seguida. Teto de heap JS de 64 MiB no filho também não é teto de RSS.
OOM do cgroup pode matar qualquer processo, inclusive o pai: isolamento do filho
contém falhas nativas locais, não oferece garantia absoluta contra OOM global.

## Critérios antes de autorizar a implantação

1. Executar novamente o workflow manual na branch com **esta revisão**. A aprovação
   anterior informada pelo usuário validava a implementação antes destas mudanças.
   Exigir testes verdes, cgroup 512 MiB sem swap e eventos OOM zerados.
2. Conferir os 16 casos visuais, nenhuma fila/download extra, limites de pixels,
   reserva até o envio, recuperação após erro/timeout/término fatal e limpeza.
3. Ler as métricas Linux do teste `memoria`: RSS conjunto amostrado, pico do
   worker, pico FFmpeg e estimativa com base 287 MiB. Investigar resultado acima
   de 448 MiB ou crescimento persistente; não liberar se não houver margem.
4. Em cópia descartável Linux, repetir com fotos detalhadas próximas de 8 MP e
   do limite de bytes e com outras tarefas de mídia sintéticas concorrentes.
   O teste atual usa fotos sintéticas simples; não representa todas as entradas.
5. Validar Node.js 24, arquitetura e libc do destino e o carregamento do binding
   correspondente em ambiente equivalente. Não copiar binários do Windows.

## Implantação futura, somente após autorização

1. Guardar o pacote da versão atual e uma lista/hash dos arquivos de código que
   serão substituídos. Não copiar credenciais ou dados para logs/artefatos de CI.
2. Preparar fora da LatamHost um pacote revisado com o código do `/gun`, adaptador
   e worker. Se o backend ainda não estiver disponível no destino, preparar em
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
