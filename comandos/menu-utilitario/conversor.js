// ============================================
// 🔄 CONVERSOR — Conversor de unidades 100% local (/conversor)
// ============================================
// Uso LIVRE, sem API externa (é só matemática):
//   /conversor 10 km em milhas
//   /conversor 30 c em f
//   /conversor 5 kg em lb
// Separadores flexíveis: "em", "para", "->", "to", ":" ou nada entre elas.
// Categorias (p/ expandir, basta acrescentar a unidade no mapa da categoria):
//   - distancia (base: m): km, m, milhas, pés
//   - peso (base: kg): kg, g, lb, oz
//   - temperatura (fórmulas próprias): °C, °F, K
//   - volume (base: litro): litros, galões, ml
//   - velocidade (base: km/h): km/h, mph
// ============================================

const { RODAPE_MENU } = require('../../config')

function normalizar(texto) {
  return String(texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/°/g, '')
    .replace(/\//g, 'barra')
    .replace(/\s+/g, ' ')
    .trim()
}

const CATEGORIAS = {
  distancia: {
    titulo: 'Distância',
    base: 'm',
    unidades: {
      km: { rotulo: 'km', fator: 1000 },
      m: { rotulo: 'm', fator: 1 },
      milha: { rotulo: 'mi', fator: 1609.344 },
      pe: { rotulo: 'ft', fator: 0.3048 }
    }
  },
  peso: {
    titulo: 'Peso',
    base: 'kg',
    unidades: {
      kg: { rotulo: 'kg', fator: 1 },
      g: { rotulo: 'g', fator: 0.001 },
      lb: { rotulo: 'lb', fator: 0.45359237 },
      oz: { rotulo: 'oz', fator: 0.028349523125 }
    }
  },
  temperatura: {
    titulo: 'Temperatura',
    base: 'c',
    unidades: {
      c: { rotulo: 'C' },
      f: { rotulo: 'F' },
      k: { rotulo: 'K' }
    }
  },
  volume: {
    titulo: 'Volume',
    base: 'l',
    unidades: {
      l: { rotulo: 'L', fator: 1 },
      ml: { rotulo: 'mL', fator: 0.001 },
      gal: { rotulo: 'gal', fator: 3.78541 }
    }
  },
  velocidade: {
    titulo: 'Velocidade',
    base: 'kmh',
    unidades: {
      kmh: { rotulo: 'km/h', fator: 1 },
      mph: { rotulo: 'mph', fator: 1.609344 }
    }
  }
}

const ALIASES_UNIDADE = {
  km: 'km', quilometro: 'km', quilometros: 'km', kilometro: 'km', kilometros: 'km',
  m: 'm', metro: 'm', metros: 'm',
  milha: 'milha', milhas: 'milha', mile: 'milha', miles: 'milha', mi: 'milha',
  pe: 'pe', pes: 'pe', foot: 'pe', feet: 'pe', ft: 'pe',
  kg: 'kg', quilo: 'kg', quilos: 'kg', quilograma: 'kg', quilogramas: 'kg',
  g: 'g', grama: 'g', gramas: 'g',
  lb: 'lb', libra: 'lb', libras: 'lb', lbs: 'lb',
  oz: 'oz', onca: 'oz', oncas: 'oz', ounce: 'oz', ounces: 'oz',
  c: 'c', celsius: 'c', graus: 'c', centigrados: 'c',
  f: 'f', fahrenheit: 'f',
  k: 'k', kelvin: 'k',
  l: 'l', litro: 'l', litros: 'l', lt: 'l',
  ml: 'ml', mililitro: 'ml', mililitros: 'ml',
  gal: 'gal', galao: 'gal', galoes: 'gal', gallon: 'gal', gallons: 'gal',
  kmh: 'kmh', kph: 'kmh', 'km/h': 'kmh', kmbarrah: 'kmh',
  mph: 'mph', milhaporhora: 'mph', milhasporhora: 'mph'
}

function resolverUnidade(texto) {
  const chave = ALIASES_UNIDADE[normalizar(texto)]
  if (!chave) return null
  const cats = Object.keys(CATEGORIAS)
  for (let i = 0; i < cats.length; i++) {
    const dados = CATEGORIAS[cats[i]]
    if (dados.unidades[chave]) {
      return { categoria: cats[i], chave: chave, rotulo: dados.unidades[chave].rotulo }
    }
  }
  return null
}

function tempParaCelsius(valor, chave) {
  if (chave === 'c') return valor
  if (chave === 'f') return (valor - 32) * 5 / 9
  return valor - 273.15
}

function celsiusParaTemp(valorC, chave) {
  if (chave === 'c') return valorC
  if (chave === 'f') return valorC * 9 / 5 + 32
  return valorC + 273.15
}

function converter(valor, origem, destino) {
  if (origem.categoria === 'temperatura') {
    return celsiusParaTemp(tempParaCelsius(valor, origem.chave), destino.chave)
  }
  const fO = CATEGORIAS[origem.categoria].unidades[origem.chave].fator
  const fD = CATEGORIAS[origem.categoria].unidades[destino.chave].fator
  return (valor * fO) / fD
}

function parsear(argumento) {
  const texto = String(argumento || '').trim()
  if (!texto) return { erro: 'vazio' }
  const adaptado = texto.replace(/->/g, ' para ').replace(/:/g, ' para ')
  const comSep = adaptado.match(/^\s*([+-]?[\d.,]+)\s*(.+?)\s+(?:em|para|to)\s+(.+?)\s*$/i)
  let vBruto = null
  let oBruto = null
  let dBruto = null
  if (comSep) {
    vBruto = comSep[1]
    oBruto = comSep[2]
    dBruto = comSep[3]
  } else {
    const semV = texto.match(/^\s*([+-]?[\d.,]+)\s*(.+?)\s*$/)
    if (!semV) return { erro: 'valor' }
    const partes = String(semV[2]).trim().split(/\s+/)
    let achou = false
    for (let i = 1; i < partes.length; i++) {
      const cO = partes.slice(0, i).join(' ')
      const cD = partes.slice(i).join(' ')
      if (resolverUnidade(cO) && resolverUnidade(cD)) {
        oBruto = cO
        dBruto = cD
        achou = true
        break
      }
    }
    if (!achou) return { erro: 'formato' }
    vBruto = semV[1]
  }
  const valor = Number(String(vBruto).replace(',', '.'))
  if (!Number.isFinite(valor)) return { erro: 'valor' }
  const origem = resolverUnidade(oBruto)
  if (!origem) return { erro: 'origem', texto: String(oBruto).trim() }
  const destino = resolverUnidade(dBruto)
  if (!destino) return { erro: 'destino', texto: String(dBruto).trim() }
  if (origem.categoria !== destino.categoria) return { erro: 'categoria', origem: origem, destino: destino }
  return { valor: valor, origem: origem, destino: destino }
}

function formatarNumero(valor) {
  return Number(valor).toLocaleString('pt-BR', { maximumFractionDigits: 4 })
}

function ajudaUso() {
  const linhas = Object.keys(CATEGORIAS).map(function (cat) {
    const uns = CATEGORIAS[cat].unidades
    const rots = Object.keys(uns).map(function (k) { return uns[k].rotulo })
    const unicos = rots.filter(function (r, i) { return rots.indexOf(r) === i })
    return CATEGORIAS[cat].titulo + ': ' + unicos.join(', ')
  })
  return 'Conversor do Limbo\n\nMe diga o valor e as unidades que eu calculo na hora. Exemplos:\n/conversor 10 km em milhas\n/conversor 30 c em f\n/conversor 5 kg para lb\n\nUnidades que eu conheco:\n' + linhas.map(function (l) { return '- ' + l }).join('\n')
}


module.exports = {
  nome: 'conversor',
  aliases: ['converter'],
  descricao: 'Converte unidades (distancia, peso, temperatura, volume, velocidade). Ex.: /conversor 10 km em milhas.',
  categoria: 'utilitario',

  executar: async function (sock, jid, msg, text) {
    try {
      const argumento = String(text || '').replace(/^\/\S+\s*/, '').trim()
      const parsed = parsear(argumento)
      if (parsed.erro === 'vazio' || parsed.erro === 'formato') {
        return await sock.sendMessage(jid, { text: ajudaUso() }, { quoted: msg })
      }
      if (parsed.erro === 'valor') {
        return await sock.sendMessage(jid, {
          text: 'Esse valor nao parece um numero... me diga um valor numerico (ex.: 10 ou 10,5).\n\n' + ajudaUso()
        }, { quoted: msg })
      }
      if (parsed.erro === 'origem' || parsed.erro === 'destino') {
        return await sock.sendMessage(jid, {
          text: 'Nao reconheci a unidade "' + parsed.texto + '"... confira a escrita e tente de novo.\n\n' + ajudaUso()
        }, { quoted: msg })
      }
      if (parsed.erro === 'categoria') {
        return await sock.sendMessage(jid, {
          text: 'Essas duas unidades sao de tipos diferentes (' + parsed.origem.rotulo + ' e ' + parsed.destino.rotulo + ')... escolha duas do mesmo tipo.\n\n' + ajudaUso()
        }, { quoted: msg })
      }
      const resultado = converter(parsed.valor, parsed.origem, parsed.destino)
      return await sock.sendMessage(jid, {
        text: 'Conversor do Limbo\n\n' + formatarNumero(parsed.valor) + ' ' + parsed.origem.rotulo + ' = ' + formatarNumero(resultado) + ' ' + parsed.destino.rotulo
      }, { quoted: msg })
    } catch (err) {
      console.error('[conversor] erro:', err)
      await sock.sendMessage(jid, { text: 'Nao consegui converter agora. Tente de novo em instantes.' }, { quoted: msg }).catch(function () {})
    }
  },

  CATEGORIAS: CATEGORIAS,
  normalizar: normalizar,
  resolverUnidade: resolverUnidade,
  converter: converter,
  parsear: parsear,
  formatarNumero: formatarNumero
}


