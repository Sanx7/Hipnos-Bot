// Renderização local com Skia. Não importa node-canvas, config ou serviços.
// Uma tarefa ativa e até duas aguardando: limita concorrência e buffers retidos.
let backend
let ocupadas = 0
let fila = Promise.resolve()
const MAX_TAREFAS = 3

async function renderizarPng(largura, altura, bufferImagem, desenhar) {
  if (ocupadas >= MAX_TAREFAS) throw new Error('Renderizador ocupado.')
  ocupadas++
  const anterior = fila
  let liberar
  fila = new Promise(resolve => { liberar = resolve })
  let canvas
  try {
    await anterior
    // Lazy: pacote/binding ausente não impede o loader nem outros comandos.
    backend ||= require('@napi-rs/canvas')
    const imagem = await backend.loadImage(bufferImagem)
    canvas = backend.createCanvas(largura, altura)
    await desenhar(canvas.getContext('2d'), imagem)
    return canvas.toBuffer('image/png')
  } finally {
    // Libera a superfície de saída sem depender do próximo ciclo de GC.
    if (canvas) { canvas.width = 1; canvas.height = 1 }
    ocupadas--
    liberar()
  }
}

module.exports = { renderizarPng }
