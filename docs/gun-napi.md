# Migração Canvas — etapa 1: /gun

Somente `/gun` usa `@napi-rs/canvas`, inclusive com `DISABLE_CANVAS=true`.
Os outros 23 comandos dependentes do Canvas antigo continuam bloqueados nesse
modo. Com a flag falsa, os demais comandos mantêm o backend original; `/gun`
usa o novo backend nos dois modos. Não é necessário alterar a flag.

## Implementação

- `func/renderizador-canvas.js`: adaptador CommonJS com uma reserva ativa e
  **nenhuma fila**. A reserva cobre download, desenho, miniatura e envio. Chamadas
  extras são recusadas antes de baixar mídia. O decoder Skia roda somente em
  `func/renderizador-canvas-worker.js`, processo descartável sem credenciais.
- O worker encerra antes de começar o FFmpeg. O sistema recupera suas alocações
  nativas ao encerrar. Buffers de entrada/saída não são guardados pelo adaptador;
  arquivos temporários são apagados em `finally`, inclusive após falha/timeout.
- O `/gun` baixa para arquivo por streaming com backpressure, limite aplicado
  durante o recebimento de 20 MiB e permissão 0600. Usa um filho de download
  descartável (Baileys original), encerrado antes do worker de renderização.
  Isso permite cancelar o transporte HTTP mesmo nesta versão do Baileys, cujo
  `getHttpStream` ignora AbortSignal. Timeout de download: 30 s incluindo abertura.
  O pai não concatena nem lê a foto original; recebe apenas o PNG final 480×480.
- `/gun`: preserva saída PNG 480×480, escala cover centralizada, posição da mira
  baseada no tamanho do buffer ORIGINAL, vermelho, espessura 5, raios 70/40/6 e
  segmentos de 95 pixels. Mantém reply ou legenda de foto, caption, quoted,
  validações e miniatura explícita pelo FFmpeg existente.
- Nenhum fallback para o Canvas antigo. Binding novo ausente/quebrado é tratado
  na execução; não impede o loader de registrar os outros comandos.

Apenas o `/gun` usa essa reserva completa. Sua miniatura limita FFmpeg a uma
thread, com timeout e limite de log; os outros comandos mantêm seus parâmetros.
Não há mudanças em dependências, `.env`, sessão, dados persistidos ou painel.

Para o orçamento de memória de 512 MiB, `/gun` verifica cabeçalhos antes de
decodificar e aceita até 8.388.608 pixels, 8192 pixels por lado e 20 MiB de entrada.
SVG não é aceito como foto. A geometria e os formatos raster usuais são preservados
dentro desses limites; imagens maiores recebem aviso em vez de serem decodificadas.
`image-size` já é uma dependência declarada do formatter e é resolvida a partir
desse pacote, sem adicionar dependências ou depender do hoisting.

A operação é recusada se o RSS do bot superar 320 MiB ou se
`process.availableMemory()` informar menos de 160 MiB livres. A checagem ocorre
antes do download, antes do worker e antes do FFmpeg. Isso é admissão conservadora,
não uma reserva de RAM do sistema. O heap JS do worker tem teto de 64 MiB, que
**não** limita a memória nativa; o teste Linux continua limitado por cgroup.

O tamanho/pixels/SVG são verificados no filho antes de carregar Skia; a inspeção
completa não limita headers a 512 KiB. O adaptador espera o evento `close` de
cada filho antes da próxima fase, da limpeza e da liberação da reserva.

Plano de implantação e reversão: [gun-latamhost.md](gun-latamhost.md).

## Dependências

Adicionada a dependência direta exata `@napi-rs/canvas@1.0.11`, mais os registros
dos seus binários opcionais por plataforma no lock. No desenvolvimento Windows
foi instalado somente o binding `canvas-win32-x64-msvc@1.0.11` junto ao pacote JS.
As entradas de TODOS os pacotes preexistentes do lock foram comparadas e
permaneceram idênticas, incluindo Sharp, FFmpeg, Baileys e MongoDB.

A preparação local gerou o lock sem scripts/instalação da árvore atual. O pacote
novo foi instalado em diretório temporário isolado e somente seus dois diretórios
foram copiados para `node_modules/@napi-rs`, sem reinstalar dependências existentes.

Manter `canvas` e o shell seletivo atual: TikTok ainda declara o peer original e
os demais comandos ainda dependem dele. Não omitir dependências opcionais, pois
o novo renderizador também distribui seus bindings por esse mecanismo.

## Testes offline

Na raiz do checkout de desenvolvimento, com as dependências já preparadas:

```sh
node scripts/teste-gun-napi.js
node scripts/teste-gun-capacidade.js
node scripts/teste-compatibilidade-canvas.js
node scripts/teste-on-off.js
```

O primeiro bloqueia conexões de rede e usa sockets falsos. Compara 16 casos
contra uma cópia congelada do compositor antigo: PNG, JPEG, JPEG com EXIF de
orientação e PNG transparente em quatro proporções. Confirma dimensões e
coordenadas da mira, diferença média por canal inferior a 0,5/255 e menos de
1,5% dos pixels com diferença acima de 16. Tolera diferenças pequenas de
antialiasing; não exige PNGs ou pixels idênticos entre Cairo e Skia.

Também verifica envio com reply/legenda, quoted/caption/miniatura, falta de foto,
mídia errada, entrada acima de 20 MiB, imagem corrompida, binding ausente,
recuperação da reserva, recusa imediata sem download extra, bloqueio até o envio,
dimensões e pouca memória, falha fatal/timeout do filho e limpeza. O Canvas antigo é proibido
nesses cenários e usado apenas como referência no teste visual. Miniaturas usam
FFmpeg real local, sem conexões externas.

O cenário de memória roda em processo separado com `--expose-gc`: 20 fluxos
completos, incluindo cinco JPEG de 4096×2048 (limite de pixels), miniatura por
FFmpeg real e envio simulado. Sem GC forçado entre chamadas. Reporta pico do
worker e RSS inicial/final do pai; no Linux amostra também RSS do pai + filhos
Node/FFmpeg em `/proc`. O cgroup do workflow cobre o conjunto, inclusive cache
de arquivos e picos não capturados pela amostragem.

Também estima o total com base conservadora de 287 MiB para o bot, aumento do RSS
do pai e maior pico entre worker/FFmpeg (não coexistem no `/gun`), mais 32 MiB de
margem. Reserva 64 MiB estimados para FFmpeg se a medição não estiver disponível.
Na suíte de capacidade, a fórmula inclui também o pico do downloader no máximo
entre fases sequenciais. Os resultados atuais com streaming e imagens detalhadas,
incluindo os riscos restantes, estão em [gun-latamhost.md](gun-latamhost.md).
Resultado local Windows/Node.js 24.17.0: pico do worker 94,75 MiB; estimativa total
414,71 MiB. FFmpeg não teve RSS medido no Windows. As comparações visuais tiveram
diferença média máxima inferior a 0,20/255. Esses números não são garantia de
consumo real na LatamHost e devem ser revalidados em Linux nesta revisão.

O teste de compatibilidade executa o loader e a inicialização em VM com
fronteiras externas mockadas: Canvas ausente/quebrado, modo normal e comparação
de todos os metadados/executores. Confirma exatamente 23 comandos bloqueados,
aliases preservados e `/gun` renderizando nos dois cenários sem Canvas.

Regressão complementar em ambiente de desenvolvimento com Canvas antigo válido:

```sh
# Linux, somente ambiente isolado de desenvolvimento/teste:
DISABLE_CANVAS=false node scripts/teste-efeitos-visuais.js
DISABLE_CANVAS=false node scripts/teste-loader.js
DISABLE_CANVAS=true node scripts/teste-loader.js
```

No PowerShell, definir `$env:DISABLE_CANVAS` apenas no processo de teste antes
de executar o script. Isso não grava `.env` nem configura a hospedagem.

## Antes de publicar

1. Preparar uma cópia descartável em Linux com Node.js 24, mesma CPU/libc da
   hospedagem e limite de 512 MB. Qualquer instalação futura de teste deve
   acontecer nessa cópia, nunca na LatamHost nesta etapa.
2. Confirmar o binding Linux correspondente no lock e seu carregamento. Para a
   variante GNU, o projeto do renderizador informa glibc mínima 2.18; conferir
   os requisitos do binário escolhido. Não copiar `node_modules` do Windows.
3. Repetir as suítes acima e inspecionar exemplos visuais com imagens sintéticas
   detalhadas. A suíte visual requer Canvas antigo funcional apenas no ambiente
   de referência; `comando`, `falha-backend` e `memoria` podem ser executados
   separadamente sem esse binding, por exemplo:
   `node --expose-gc scripts/teste-gun-napi.js memoria`.
4. Medir o consumo TOTAL do ambiente de teste, incluindo bot e FFmpeg, em repouso
   e com chamadas concorrentes. GC forçado e processo isolado não representam
   a produção. Conferir erros, limites, limpeza dos temporários e os 23 bloqueios.

O teto de pixels agora limita a imagem aceita antes da decodificação. Processo
descartável protege o bot de falhas nativas do renderizador, mas não torna um OOM
global impossível. Outros comandos podem iniciar subprocessos simultaneamente;
essa carga deve fazer parte da validação de capacidade antes da publicação.

Não houve teste na LatamHost, WhatsApp ou MongoDB reais, commit, push ou deploy.
