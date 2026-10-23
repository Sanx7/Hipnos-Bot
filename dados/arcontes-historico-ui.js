const { randomBytes } = require('node:crypto')
const { criarResolvedorNomes } = require('./arcontes-nomes')
const GRUPO = /^\d+(?:-\d+)?@g\.us$/
const REFERENCIA = /^(g|op|rv)-[A-Za-z0-9_-]{16}$/
const AJUDA = 'Use /historicoarconte grupo "Nome completo" [página|pendentes|revisoes|operacao referência|resolver referência CONFIRMO motivo].'
const LINHA = '━━━━━━━━━━━━━━'
const datas = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo',
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'longOffset' })
function formatarData(valor) {
  if (valor == null) return 'Data não disponível'
  const data = new Date(valor)
  if (!Number.isFinite(data.getTime())) return 'Data não disponível'
  const partes = Object.fromEntries(datas.formatToParts(data).map(p => [p.type, p.value]))
  return `${partes.day}/${partes.month}/${partes.year} às ${partes.hour}:${partes.minute} (${partes.timeZoneName.replace('GMT', 'UTC')})`
}
function negar(resposta) { throw Object.assign(new Error('HISTORICO_BLOQUEADO'), { resposta }) }
function normalizar(texto) {
  return String(texto || '').normalize('NFKC').normalize('NFD').replace(/\p{M}/gu, '')
    .replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR')
}
function textoSeguro(valor, padrao = 'Não informado', limite = 500) {
  const texto = String(valor || '').replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g, ' ')
    .replace(/[\w:.-]+@(?:g\.us|s\.whatsapp\.net|lid)\b/gi, '[identificador oculto]')
    .replace(/\b[a-f0-9]{64}\b/gi, '[referência interna]')
    .replace(/\b[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\b/gi, '[referência interna]')
    .replace(/\+?\d[\d\s().-]*\d/g, valor => valor.replace(/\D/g, '').length >= 7 ? '[identificador oculto]' : valor)
    .trim().slice(0, limite)
  return texto || padrao
}
function nomeSeguro(valor, padrao) {
  const nome = textoSeguro(valor, '', 120)
  return !nome || !nome.replace(/\[(?:identificador oculto|referência interna)\]/g, '').trim() || /^[@\d\s+().-]+$/.test(nome) ? padrao : nome
}
function criarApresentacaoHistorico({ agora = Date.now } = {}) {
  const porSocket = new WeakMap(), TTL = 15 * 60 * 1000, MAX = 2048
  function referencias(sock) {
    let mapa = porSocket.get(sock)
    if (!mapa) { mapa = new Map(); porSocket.set(sock, mapa) }
    for (const [token, dado] of mapa) if (dado.expira <= agora()) mapa.delete(token)
    return mapa
  }
  function referencia(sock, autor, grupo, tipo, valor) {
    const mapa = referencias(sock)
    for (const [token, dado] of mapa) {
      if (dado.autor === autor && dado.grupo === grupo && dado.tipo === tipo && dado.valor === valor) return token
    }
    if (mapa.size >= MAX) mapa.delete(mapa.keys().next().value)
    const token = `${tipo}-${randomBytes(12).toString('base64url')}`
    mapa.set(token, { autor, grupo, tipo, valor, expira: agora() + TTL })
    return token
  }
  function consultar(sock, token, tipo, autor, grupo) {
    const dado = referencias(sock).get(token)
    if (!dado || dado.tipo !== tipo || (autor && dado.autor !== autor) || (grupo && dado.grupo !== grupo)) {
      negar('Referência inválida ou expirada. Consulte novamente pelo nome do grupo.')
    }
    return dado
  }
  async function selecionar(sock, entrada, autorizar) {
    if (!entrada || entrada.length > 1500) negar(AJUDA)
    // Formato antigo por ID e referências são aceitos como entrada, nunca exibidos.
    const [primeiro, ...resto] = entrada.trim().split(/\s+/)
    if (GRUPO.test(primeiro) || REFERENCIA.test(primeiro)) {
      const dado = GRUPO.test(primeiro) ? null : consultar(sock, primeiro, 'g')
      const grupo = dado?.grupo || primeiro, c = await autorizar(grupo)
      if (dado && dado.autor !== c.autor.numero) negar('Referência inválida ou expirada. Consulte novamente pelo nome do grupo.')
      return { grupo, c, args: resto }
    }
    let nomeExato, argsExatos
    if (entrada.startsWith('"')) {
      const trecho = entrada.match(/^"(?:\\.|[^"\\])*"/u)?.[0]
      if (!trecho) negar(AJUDA)
      try { nomeExato = JSON.parse(trecho) } catch (_) { negar(AJUDA) }
      const sufixo = entrada.slice(trecho.length)
      if (sufixo && !/^\s/.test(sufixo)) negar(AJUDA)
      argsExatos = sufixo.trim().split(/\s+/).filter(Boolean)
    }
    const todos = await sock.groupFetchAllParticipating()
    if (!todos || typeof todos !== 'object' || Array.isArray(todos)) negar('Não foi possível consultar os grupos agora.')
    const nomes = []
    let completo = true
    for (const [grupo, meta] of Object.entries(todos)) {
      if (!GRUPO.test(grupo)) continue
      let subject = meta?.subject
      if (typeof subject !== 'string') {
        try { subject = (await sock.groupMetadata(grupo))?.subject } catch (_) { completo = false; continue }
      }
      if (typeof subject === 'string') nomes.push({ grupo, nome: normalizar(subject) })
      else completo = false
    }
    const opcoes = []
    if (nomeExato !== undefined) opcoes.push({ nome: normalizar(nomeExato), args: argsExatos })
    else {
      // Nome completo tem precedência sobre sufixos que também sejam palavras do nome.
      opcoes.push({ nome: normalizar(entrada), args: [] })
      const delimitador = entrada.indexOf(' -- ')
      if (delimitador >= 0) opcoes.push({ nome: normalizar(entrada.slice(0, delimitador)), args: entrada.slice(delimitador + 4).trim().split(/\s+/) })
      const partes = entrada.trim().split(/\s+/)
      for (let i = partes.length - 1; i > 0; i--) {
        if (/^(?:[1-9]\d{0,3}|pendentes|revisoes|operacao|resolver)$/.test(partes[i])) {
          opcoes.push({ nome: normalizar(partes.slice(0, i).join(' ')), args: partes.slice(i) })
        }
      }
    }
    for (const opcao of opcoes) {
      const candidatos = nomes.filter(n => n.nome === opcao.nome)
      if (!candidatos.length) continue
      const autorizados = []
      for (const candidato of candidatos) {
        try {
          const c = await autorizar(candidato.grupo)
          if (normalizar(c.meta.subject) === opcao.nome) autorizados.push({ grupo: candidato.grupo, c, args: opcao.args })
        } catch (_) { /* Não revelar a existência de grupos sem autorização. */ }
      }
      if (!autorizados.length) negar('Grupo não encontrado ou acesso não autorizado.')
      if (autorizados.length === 1) return { ...autorizados[0], inventario: nomes, completo }
      return { escolhas: autorizados.slice(0, 20) }
    }
    negar('Grupo não encontrado ou acesso não autorizado.')
  }
  function vista(sock, grupo, c) {
    const autor = c.autor.numero
    const ref = (tipo, valor) => referencia(sock, autor, grupo, tipo, valor)
    const grupoRef = ref('g', grupo)
    const nomeGrupo = nomeSeguro(c.meta.subject, 'Grupo sem nome disponível')
    let resolverNomes
    const pessoa = numero => {
      resolverNomes ||= criarResolvedorNomes(sock, grupo, c.meta.participants, nomeSeguro)
      return resolverNomes(numero)
    }
    const papel = op => op.responsavelTipo === 'arconte' ? '👑 *Arconte:*' : op.responsavelTipo === 'administrador' ? '🛡️ *Administrador:*' : op.responsavelTipo === 'dono' ? '👑 *Dono do bot:*' : '👤 *Responsável:*'
    async function comando(base, selecionado = {}) {
      const fallback = `${base} grupo ${grupoRef}`
      const original = c.meta.subject
      // Nunca inserir no comando um nome truncado, ocultado ou modificado.
      if (typeof original !== 'string' || !original || nomeGrupo !== original || original.length > 120) return fallback
      try {
        let inventario = selecionado.inventario
        if (!inventario) {
          const todos = await sock.groupFetchAllParticipating()
          if (!todos || typeof todos !== 'object' || Array.isArray(todos)) return fallback
          inventario = []
          for (const [id, meta] of Object.entries(todos)) {
            if (!GRUPO.test(id)) continue
            // Não fazer uma consulta por grupo só para simplificar o texto.
            if (typeof meta?.subject !== 'string') return fallback
            inventario.push({ grupo: id, nome: normalizar(meta.subject) })
          }
        } else if (!selecionado.completo) return fallback
        const iguais = inventario.filter(g => g.nome === normalizar(original))
        return iguais.length === 1 && iguais[0].grupo === grupo ? `${base} grupo ${JSON.stringify(original)}` : fallback
      } catch (_) { return fallback }
    }
    function montar(titulo, pagina, blocos, rodape = '') {
      const cabecalho = `🏛️ *ARQUIVOS DO OLIMPO* 🏛️\n\n📜 *Grupo:* ${nomeGrupo}\n\n${titulo}${pagina ? `\n📖 *Página:* ${pagina}` : ''}\n🕰️ *Fuso:* Brasília (America/Sao_Paulo)\n\n`
      const fim = `${rodape ? `\n\n${rodape}` : ''}\n\n⏳ Referências válidas por 15 minutos.`
      const partes = [], margem = cabecalho.length + fim.length + 80
      let atual = ''
      for (const bloco of blocos) {
        const trecho = `${atual ? `\n\n${LINHA}\n\n` : ''}${bloco}`
        if (atual && atual.length + trecho.length + margem > 3800) { partes.push(atual); atual = bloco }
        else atual += trecho
      }
      partes.push(atual)
      return partes.map((parte, i) => `${cabecalho}${partes.length > 1 ? `📦 *Parte:* ${i + 1}/${partes.length}\n\n` : ''}${LINHA}\n\n${parte}\n\n${LINHA}${i === partes.length - 1 ? fim : '\n\nContinua na próxima mensagem.'}`)
    }
    async function resumo(op) {
      return `🔖 *Operação:* ${ref('op', op._id)}\n⚖️ *Estado original:* ${textoSeguro(op.estado)}\n${papel(op)} ${pessoa(op.responsavel)}\n🎯 *Alvo:* ${pessoa(op.alvo)}\n📅 *Data:* ${formatarData(op.criadoEm)}\n📝 *Motivo:* ${textoSeguro(op.motivo)}`
    }
    async function revisao(r, incluirOperacao = false) {
      return `📚 *Revisão:* ${ref('rv', r._id)}${incluirOperacao ? `\n🔖 *Operação:* ${ref('op', r.operacao)}` : ''}\n⚖️ *Estado:* ${textoSeguro(r.estado)}\n🧑‍⚖️ *Revisor (${textoSeguro(r.responsavelTipo)}):* ${pessoa(r.responsavel)}\n📅 *Data:* ${formatarData(r.criadoEm)}\n📝 *Motivo:* ${textoSeguro(r.motivo)}`
    }
    async function expulsao(p) {
      return `${papel(p)} ${pessoa(p.responsavel)}\n🎯 *Alvo:* ${pessoa(p.alvo)}\n📅 *Data:* ${formatarData(p.confirmadoEm)}\n📝 *Motivo:* ${textoSeguro(p.motivo)}`
    }
    return { grupoRef, nomeGrupo, resumo, revisao, expulsao, comando, montar, refOperacao: id => ref('op', id),
      operacao(valor) {
        if (/^[a-f0-9]{64}$/.test(valor || '')) return valor
        return consultar(sock, valor, 'op', autor, grupo).valor
      } }
  }
  return { selecionar, vista }
}
module.exports = { criarApresentacaoHistorico, normalizar, textoSeguro, formatarData, AJUDA }
