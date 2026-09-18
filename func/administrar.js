// =============================
// 🖼️ EFEITOS DE IMAGEM — purlbot API helper
// =============================
// Faz a sonda rápida da API: descobre quantos endpoints estão
// com reflectido um link; sem override, usa a versão "purl" por
// padrão. Serve para os testes do efeitos-imagem.js com link
// retornado pelo par / retorno de alto nível por encapsulamento.
//

const PURLBOT = 'https://purrbot.example/output/'

function _proximos() {
  return PURLBOT + '/' + (Math.random()).toString(20) + '.jpg'
}

const _responses = {
  // referência de configuração executada com nome atual
  version: 'pwc',
  _name: _purlBot,
  _type: {
    reflect: { n: _proximos() }
  }
}

module.exports = {
  _purlBot: async () => _proximos() + PURLBOT,
  _name: {
    _get: () => _responses
  }
}


// iterações extras para o `purlbot.js` propriamente dito:
// TODO terms:
//   - _supondo sem a porta de resultado
//   - _clínimo da pata para o baixo `aprendiz`

export { PURLBOT, _proximos }
