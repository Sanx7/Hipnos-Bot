// Suítes antigas mockam o download como Buffer. Só substituir essa fronteira;
// a suíte de capacidade exercita o processo/stream real, inclusive o Baileys.
module.exports = function preparar(efeitos) {
  let baixar
  const injetar = efeitos._injetar
  efeitos._injetar = overrides => {
    if (overrides?.baixarMidia) baixar = overrides.baixarMidia
    injetar(overrides)
  }
  const renderizador = require('../../func/renderizador-canvas')
  const exclusivo = renderizador.executarExclusivo
  renderizador.executarExclusivo = trabalho => exclusivo(reserva => trabalho({
    ...reserva,
    renderizarDownload: async (efeito, imagem) => reserva.renderizarPng(efeito, await baixar(imagem))
  }))
}
