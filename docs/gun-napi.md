# Migração Canvas — etapa 1: /gun

Somente `/gun` usa `@napi-rs/canvas`, inclusive com `DISABLE_CANVAS=true`.
Os outros 23 comandos dependentes do Canvas antigo continuam bloqueados nesse
modo. Com a flag falsa, os demais comandos mantêm o backend original; `/gun`
usa o novo backend nos dois modos. Não é necessário alterar a flag.

## Implementação

- `func/renderizador-canvas.js`: adaptador CommonJS com import sob demanda,
  carregamento de imagem, callback de desenho 2D e exportação PNG. Uma tarefa
  ativa e duas aguardando no máximo; excesso retorna o aviso de falha já usado
  pelo comando. A fila avança também quando o binding, a imagem ou o desenho
  falham. A superfície de saída é reduzida após a exportação para liberar pixels.
- `/gun`: preserva saída PNG 480×480, escala cover centralizada, posição da mira
  baseada no tamanho do buffer ORIGINAL, vermelho, espessura 5, raios 70/40/6 e
  segmentos de 95 pixels. Mantém reply ou legenda de foto, caption, quoted,
  validações e miniatura explícita pelo FFmpeg existente.
- Nenhum fallback para o Canvas antigo. Binding novo ausente/quebrado é tratado
  na execução; não impede o loader de registrar os outros comandos.

O adaptador serializa somente a renderização. Downloads e miniaturas continuam
no fluxo original. Não há mudanças em Baileys, MongoDB, Jimp, Sharp ou FFmpeg.
Não há mudanças em `.env`, sessão, dados persistidos ou painel da hospedagem.

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
recuperação da fila, serialização e recusa de excesso. O Canvas antigo é proibido
nesses cenários e usado apenas como referência no teste visual. Miniaturas usam
FFmpeg real local, sem conexões externas.

O cenário de memória roda em processo separado com `--expose-gc`: 30
renderizações, incluindo seis JPEG de 4000×3000 (12 MP). Reporta RSS inicial,
pico do processo (inclui alocações nativas) e RSS final; exige pico inferior a
512 MiB e crescimento retido inferior a 96 MiB. Não mede heap JS apenas.

Resultado local em Windows/Node.js 24.17.0: picos de 220,48 e 221,68 MiB em dois
ensaios, sem crescimento retido positivo após GC. As comparações
visuais apresentaram diferença média máxima de aproximadamente 0,20/255.
Esses valores são sintéticos e podem variar entre execuções e plataformas.

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

O limite de 20 MiB de entrada comprimida foi preservado; ele não limita pixels
decodificados. A fila reduz concorrência, mas não garante que toda imagem caiba
nos 512 MB junto ao bot. Imagens de dimensões extremas e o consumo do processo
completo ainda precisam de validação Linux antes de liberar publicação. Um teto
de pixels exigiria uma decisão adicional sobre os formatos/entradas aceitos.

Não houve teste na LatamHost, WhatsApp ou MongoDB reais, commit, push ou deploy.
