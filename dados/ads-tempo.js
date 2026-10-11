const erro = require('./ads-erro')
const FUSO = 'America/Sao_Paulo'
const formato = new Intl.DateTimeFormat('en-CA', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
function partes(ms) { return Object.fromEntries(formato.formatToParts(ms).filter(p => p.type !== 'literal').map(p => [p.type, Number(p.value)])) }
function proxima(doc, agora) {
  if (doc.modo === 'intervalo' && Number.isInteger(doc.minutos) && doc.minutos >= 15 && doc.minutos <= 1440) return agora + doc.minutos * 60000
  if (doc.modo !== 'diario' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(doc.horario || '')) throw erro('Configure intervalo ou horário válido.')
  const p = partes(agora), [hora, minuto] = doc.horario.split(':').map(Number)
  // Calendário local via Intl, sem depender do fuso do servidor nem fixar UTC-3.
  for (let dia = 0; dia < 3; dia++) {
    const alvo = Date.UTC(p.year, p.month - 1, p.day + dia, hora, minuto)
    let instante = alvo
    for (let i = 0; i < 4; i++) {
      const a = partes(instante)
      instante += alvo - Date.UTC(a.year, a.month - 1, a.day, a.hour, a.minute, a.second)
    }
    const a = partes(instante)
    if (instante > agora && a.hour === hora && a.minute === minuto) return instante
  }
  throw erro('Horário local indisponível.')
}
function exibir(ms) { return ms ? new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, dateStyle: 'short', timeStyle: 'short' }).format(ms) : '—' }
module.exports = { FUSO, proxima, partes, exibir }
