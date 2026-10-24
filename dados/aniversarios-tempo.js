const FUSO = 'America/Sao_Paulo'
const formato = new Intl.DateTimeFormat('en-CA', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit' })
function calendario(agora = Date.now()) {
  const p = Object.fromEntries(formato.formatToParts(new Date(agora)).map(x => [x.type, x.value]))
  return { ano: Number(p.year), mes: Number(p.month), dia: Number(p.day), chave: `${p.year}-${p.month}-${p.day}` }
}
function bissexto(ano) { return ano % 4 === 0 && (ano % 100 !== 0 || ano % 400 === 0) }
function validar(dia, mes) {
  return Number.isInteger(dia) && Number.isInteger(mes) && mes >= 1 && mes <= 12 && dia >= 1 &&
    dia <= [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mes - 1]
}
function lerData(texto) {
  const m = /^(\d{2})\/(\d{2})$/.exec(String(texto))
  if (!m || !validar(Number(m[1]), Number(m[2]))) return null
  return { dia: Number(m[1]), mes: Number(m[2]) }
}
function dataEfetiva(doc, ano) { return { mes: doc.mes, dia: doc.mes === 2 && doc.dia === 29 && !bissexto(ano) ? 28 : doc.dia } }
function ocorre(doc, hoje) {
  if (!validar(doc?.dia, doc?.mes)) return false
  const d = dataEfetiva(doc, hoje.ano)
  return d.dia === hoje.dia && d.mes === hoje.mes
}
function proxima(doc, hoje) {
  let ano = hoje.ano, d = dataEfetiva(doc, ano)
  if (d.mes * 100 + d.dia < hoje.mes * 100 + hoje.dia) { ano++; d = dataEfetiva(doc, ano) }
  return { ...d, ano, ordem: ano * 10000 + d.mes * 100 + d.dia }
}
function exibir(doc) { return `${String(doc.dia).padStart(2, '0')}/${String(doc.mes).padStart(2, '0')}` }
module.exports = { FUSO, calendario, bissexto, validar, lerData, ocorre, proxima, exibir }
