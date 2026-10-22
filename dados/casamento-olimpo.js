const { createHash } = require('node:crypto')
const { normalizeMessageContent } = require('@whiskeysockets/baileys')
const { criarResolvedor } = require('./casamento-identidade')
const { criarRepositorio } = require('./casamento-olimpo-mongo')
const prefixo = require('../prefixo')

function erro(codigo) { return Object.assign(new Error(codigo), { codigo }) }
function chave(tipo, jid, numero, msg) {
  if (!msg?.key?.id) throw erro('mensagem')
  return `${tipo}:` + createHash('sha256').update(JSON.stringify([jid, numero, msg.key.id])).digest('hex')
}
function diasCompletos(inicio, fim) {
  if (!(inicio instanceof Date) || !(fim instanceof Date) ||
      !Number.isFinite(+inicio) || !Number.isFinite(+fim) || fim < inicio) throw erro('dados')
  return Math.floor((fim - inicio) / 86400000)
}
function formatarData(data) {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: '2-digit', year: 'numeric' }).format(data)
}
function jidMencao(pessoa, fallback) {
  return String(pessoa?.participante?.id || fallback).replace(/:\d+(?=@)/, '')
}
function lerDataHistorica(texto) {
  const partes = String(texto || '').trim().split(/\s+/)
  const m = partes.length === 2 && partes[1].match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (!m) throw erro('data')
  const dia = Number(m[1]), mes = Number(m[2]), ano = Number(m[3])
  const data = new Date(Date.UTC(ano, mes - 1, dia, 12))
  if (ano < 1900 || data.getUTCFullYear() !== ano || data.getUTCMonth() !== mes - 1 || data.getUTCDate() !== dia) throw erro('data')
  return data
}
function criarServico(repo = criarRepositorio()) {
  async function resolver(sock, jid, msg, exigeGrupo) {
    const grupo = String(jid || '').endsWith('@g.us')
    if (exigeGrupo && !grupo) throw erro('grupo')
    let participantes = []
    if (grupo) {
      try {
        participantes = (await sock.groupMetadata(jid))?.participants || []
        if (!Array.isArray(participantes)) throw erro('metadados')
      }
      catch { participantes = []; if (exigeGrupo) throw erro('metadados') }
    }
    const sender = msg?.key?.participant || msg?.key?.remoteJid
    const resolvedor = criarResolvedor(participantes)
    const autor = await resolvedor.buscar(sender)
    if (!autor.numero) throw erro('identidade')
    if (exigeGrupo && !autor.participante) throw erro('membro')
    return { buscar: resolvedor.buscar, conferir: resolvedor.conferir, autor,
      numero: autor.numero, sender: jidMencao(autor, sender) }
  }
  async function executar(acao, sock, jid, msg, texto) {
    const namoro = ['namorar', 'aceitarnamoro', 'recusarnamoro', 'namoro', 'terminar'].includes(acao)
    const modalidade = namoro ? 'namoro' : 'casamento'
    const aceitar = ['aceitar', 'aceitarnamoro'].includes(acao)
    const encerrar = ['divorciar', 'terminar'].includes(acao)
    const c = await resolver(sock, jid, msg, ['casar', 'aceitar', 'recusar', 'namorar', 'aceitarnamoro', 'recusarnamoro'].includes(acao))
    const op = ['casamento', 'namoro'].includes(acao) ? null : chave(acao, jid, c.numero, msg)
    if (acao === 'ajustardatacasamento') {
      const numeroDono = await require('../estado-bot').obterNumeroDono(sock, jid, msg?.key?.participant || msg?.key?.remoteJid)
      if (!numeroDono || numeroDono !== c.numero || !c.conferir(c.autor).numero) throw erro('dono')
      const data = lerDataHistorica(texto)
      const doc = await repo.consultar(c.numero)
      if (!doc) throw erro('semUniao')
      const filtro = { participantes: c.numero, estado: 'ativo', bloqueiaParticipantes: true, modalidade: { $ne: 'namoro' } }
      const vinculado = await repo.vincular(op, filtro)
      if (!vinculado || vinculado._id !== doc._id) throw erro('mudou')
      if (!(await repo.ajustarInicio(doc._id, c.numero, op, data))) throw erro('data')
      return { text: '📜 Data histórica do teu relacionamento registrada. A data original do casamento foi preservada.' }
    }
    if (acao === 'casar' || acao === 'namorar') {
      const conteudo = normalizeMessageContent(msg?.message) || {}
      const contexto = (conteudo.extendedTextMessage || conteudo.imageMessage ||
        conteudo.videoMessage || conteudo.documentMessage)?.contextInfo
      const mencoes = contexto?.mentionedJid || []
      if (mencoes.length !== 1) throw erro('mencao')
      const alvo = await c.buscar(mencoes[0])
      if (!alvo.numero) throw erro('identidade')
      if (!alvo.participante) throw erro('membro')
      if (!c.conferir(c.autor).numero) throw erro('identidade')
      if (alvo.numero === c.numero) throw erro('proprio')
      const alvoJid = jidMencao(alvo, mencoes[0])
      await repo.expirar([c.numero, alvo.numero])
      const doc = await repo.pedir({ _id: op, versao: 1, tipo: 'uniao', modalidade,
        participantes: [c.numero, alvo.numero], solicitante: c.numero, destinatario: alvo.numero,
        // Pistas para evitar varrer o grupo no aceite; nunca substituem prova atual.
        jidsParticipantes: [c.sender, alvoJid],
        grupoOrigem: jid, estado: 'pendente', bloqueiaParticipantes: true,
        casadoEm: null, encerradoEm: null, encerradoPor: null })
      if (!doc) throw erro('ocupado')
      if (doc.estado !== 'pendente') return { text: '🌙 Este pedido já teve seu destino escrito pelas Moiras.' }
      return { text: `${namoro ? '💞 *NAMORO DO OLIMPO*' : '💍 *CASAMENTO DO OLIMPO*'}\n\n@${c.sender.split('@')[0]} ${namoro ? 'oferece seu coração' : 'oferece sua mão'} a @${alvoJid.split('@')[0]}.\nSob o olhar de ${namoro ? 'Afrodite' : 'Hera'}, o destinatário tem *5 minutos* para usar *${prefixo.prefixoSincrono()}${namoro ? 'aceitarnamoro' : 'aceitar'}* ou *${prefixo.prefixoSincrono()}${namoro ? 'recusarnamoro' : 'recusar'}* neste grupo.`,
        mentions: [c.sender, alvoJid] }
    }
    if (acao === 'casamento' || acao === 'namoro') {
      const doc = await repo.consultar(c.numero, modalidade)
      if (!doc) return { text: '🌙 Nenhum laço de Hera une tua alma neste momento.' }
      const conjuge = doc.participantes.find(n => n !== c.numero)
      const pessoa = await c.buscar(`${conjuge}@s.whatsapp.net`)
      const mencao = jidMencao(pessoa, `${conjuge}@s.whatsapp.net`)
      const inicio = namoro ? doc.namoradoEm : doc.casadoEm
      const dias = diasCompletos(inicio, doc.consultadoEm)
      const anterior = doc.namoroAnterior
      const historico = doc.inicioRelacionamentoEm ? `\nInício histórico do relacionamento: *${formatarData(doc.inicioRelacionamentoEm)}*.` : ''
      const tempoNamoro = anterior?.estado === 'convertido' ? `\nNamoro anterior: *${formatarData(anterior.iniciadoEm)}* a *${formatarData(anterior.convertidoEm)}* (${diasCompletos(anterior.iniciadoEm, anterior.convertidoEm)} dias completos).` : ''
      return { text: `${namoro ? '💞 *NAMORO DO OLIMPO*' : '💍 *CASAMENTO DO OLIMPO*'}\n\nHipnos guarda vosso laço sob as bênçãos de ${namoro ? 'Afrodite' : 'Hera'}.\n${namoro ? 'Parceiro' : 'Cônjuge'}: @${mencao.split('@')[0]}\n${namoro ? 'Namorando' : 'Casados'} desde: *${formatarData(inicio)}*\nTempo de união: *${dias} ${dias === 1 ? 'dia completo' : 'dias completos'}*.${tempoNamoro}${historico}`, mentions: [mencao] }
    }
    if (!encerrar) await repo.expirar([c.numero])
    let filtro = encerrar
      ? { participantes: c.numero, estado: 'ativo', bloqueiaParticipantes: true }
      : { destinatario: c.numero, grupoOrigem: jid, estado: 'pendente', bloqueiaParticipantes: true }
    filtro.modalidade = namoro ? 'namoro' : { $ne: 'namoro' }
    const doc = await repo.vincular(op, filtro, !namoro && !encerrar)
    if (!doc) throw erro(encerrar ? 'semUniao' : 'semPedido')
    if (doc.ultimaOperacao === op) return { text: '🌙 Hipnos já registrou tua decisão. O destino deste laço permanece guardado.' }
    let valores
    if (doc.conversao) {
      filtro = { modalidade: 'namoro', estado: 'ativo', bloqueiaParticipantes: true,
        'pedidoCasamento._id': doc.pedidoCasamentoId, 'pedidoCasamento.estado': 'pendente',
        'pedidoCasamento.destinatario': c.numero, 'pedidoCasamento.grupoOrigem': jid }
    }
    if (aceitar) {
      const mentions = [], pessoas = []
      for (const numero of doc.participantes) {
        const indice = doc.participantes.indexOf(numero)
        let pessoa = await c.buscar(doc.jidsParticipantes?.[indice] || `${numero}@s.whatsapp.net`)
        if (pessoa.numero !== numero || !pessoa.participante) pessoa = await c.buscar(`${numero}@s.whatsapp.net`)
        if (!pessoa.numero) throw erro('identidade')
        if (!pessoa.participante) throw erro('membro')
        pessoas.push(pessoa)
        mentions.push(jidMencao(pessoa, `${numero}@s.whatsapp.net`))
      }
      if (!c.conferir(c.autor).numero || pessoas.some(p => !c.conferir(p).numero)) throw erro('identidade')
      valores = { estado: 'ativo', [namoro ? 'namoradoEm' : 'casadoEm']: '$$NOW', ultimaOperacao: op,
        mencoesAceite: { $literal: mentions } }
      filtro.$expr = { $gt: [doc.conversao ? '$pedidoCasamento.expiraEm' : '$expiraEm', '$$NOW'] }
    } else {
      valores = { estado: encerrar ? (namoro ? 'terminado' : 'divorciado') : 'recusado',
        bloqueiaParticipantes: false, encerradoEm: '$$NOW', encerradoPor: c.numero, ultimaOperacao: op }
      if (!encerrar) filtro.$expr = { $gt: [doc.conversao ? '$pedidoCasamento.expiraEm' : '$expiraEm', '$$NOW'] }
    }
    if (doc.conversao) {
      const historico = `pedidosCasamento.${doc.pedidoCasamentoId.split(':')[1]}`
      if (aceitar) Object.assign(valores, { modalidade: 'casamento',
        namoroAnterior: { estado: 'convertido', iniciadoEm: '$namoradoEm', convertidoEm: '$$NOW' } })
      else valores = { ultimaOperacao: op }
      Object.assign(valores, { 'pedidoCasamento.estado': aceitar ? 'aceito' : 'recusado',
        'pedidoCasamento.ultimaOperacao': op, 'pedidoCasamento.encerradoEm': '$$NOW',
        [`${historico}.estado`]: aceitar ? 'aceito' : 'recusado', [`${historico}.ultimaOperacao`]: op,
        [`${historico}.encerradoEm`]: '$$NOW' })
    }
    if (acao === 'terminar') {
      // Não cancelar acidentalmente um pedido de conversão criado após a leitura.
      filtro['pedidoCasamento._id'] = doc.pedidoCasamento?._id || { $exists: false }
      if (doc.pedidoCasamento?.estado === 'pendente') {
        filtro['pedidoCasamento.estado'] = 'pendente'
        const historico = `pedidosCasamento.${doc.pedidoCasamento._id.split(':')[1]}`
        Object.assign(valores, { 'pedidoCasamento.estado': 'cancelado', 'pedidoCasamento.encerradoEm': '$$NOW',
          [`${historico}.estado`]: 'cancelado', [`${historico}.encerradoEm`]: '$$NOW' })
      }
    }
    const resultado = await repo.transicionar(doc._id, filtro, valores)
    if (!resultado) throw erro('mudou')
    if (aceitar) {
      const mentions = resultado.mencoesAceite
      return { text: `${namoro ? '💞 *AFRODITE ABENÇOOU VOSSO NAMORO!*' : '💍 *HERA ABENÇOOU VOSSA UNIÃO!*'}\n\n${mentions.map(j => '@' + j.split('@')[0]).join(' e ')} agora compartilham um laço no Olimpo.\nHipnos guardará vossos sonhos desde *${formatarData(namoro ? resultado.namoradoEm : resultado.casadoEm)}*.`, mentions }
    }
    return { text: encerrar
      ? `🌙 As Moiras desfizeram vosso laço. O ${namoro ? 'namoro' : 'casamento'} foi encerrado; Hipnos preserva a memória dos sonhos vividos.`
      : '🌙 O pedido foi recusado. Afrodite respeita tua vontade; que Hipnos te conceda sonhos serenos.' }
  }
  return { executar }
}
const mensagens = {
  dono: '🌑 Somente o dono pode ajustar a data histórica do próprio casamento.',
  data: '📜 Use ajustardatacasamento DD/MM/AAAA com uma data válida, a partir de 1900 e sem data futura.',
  grupo: '🏛️ Este rito de Hera deve acontecer em um grupo.',
  metadados: '🌫️ Não consegui consultar os membros deste grupo. Tente novamente em instantes.',
  identidade: '🪪 O véu de Hipnos ocultou uma identidade. Não consegui comprovar o número real; tente novamente quando o WhatsApp sincronizar.',
  membro: '🏛️ As duas almas precisam estar comprovadamente neste grupo para o rito.',
  mencao: '💍 Mencione exatamente uma pessoa do grupo para oferecer tua mão.',
  proprio: '🪞 Nem Narciso pode celebrar este rito consigo mesmo. Escolha outra alma.',
  ocupado: '💍 Uma dessas almas já possui relacionamento ou pedido pendente no Olimpo. Somente o mesmo casal pode evoluir de namoro para casamento.',
  semPedido: '⌛ Não há pedido válido para ti neste grupo. Ele pode ter expirado ou já recebido uma decisão.',
  semUniao: '🌙 Nenhum relacionamento ativo foi encontrado para este rito.',
  mudou: '⌛ As Moiras já mudaram o destino deste pedido ou casamento. Consulte novamente.'
}
let servico = criarServico()
function comando(nome) {
  return { nome, descricao: `Relacionamentos do Olimpo: ${nome}.`, async executar(sock, jid, msg, texto) {
    let resposta
    try { resposta = await servico.executar(nome, sock, jid, msg, texto) }
    catch (err) {
      if (!mensagens[err.codigo]) console.error('[casamento-olimpo] operacao_indisponivel')
      const consulta = ['namorar', 'aceitarnamoro', 'recusarnamoro', 'namoro', 'terminar'].includes(nome) ? 'namoro' : 'casamento'
      resposta = { text: mensagens[err.codigo] || `🌫️ Os pergaminhos do Olimpo estão indisponíveis ou o resultado não pôde ser confirmado. Consulte ${prefixo.prefixoSincrono()}${consulta} antes de tentar outra ação.` }
    }
    // Não propagar ao roteador, que anunciaria erro genérico após um rito salvo.
    // Sem retry automático: o WhatsApp pode ter recebido a primeira resposta.
    try { return await sock.sendMessage(jid, resposta, { quoted: msg }) }
    catch { console.error('[casamento-olimpo] confirmacao_nao_entregue') }
  } }
}
function __definirRepositorioTeste(repo) { servico = criarServico(repo) }
module.exports = { criarServico, comando, diasCompletos, formatarData, __definirRepositorioTeste }
