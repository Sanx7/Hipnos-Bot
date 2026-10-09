const nativa = require('../../dados/enquetes-nativas')
// Enquete nativa: um voto por pessoa, apuração por 2 minutos no registro existente.
// Votos chegam como pollUpdateMessage, sem consumir números de outros jogos.
const { TIPOS, rotuloDoTipo, registrarJogo, removerJogo, obterJogo, registrarOuvinteTexto } = require('../../dados/jogos-ativos')
const { normalizar } = require('../../dados/comparacao-palavras')

const TIPO_JOGO = TIPOS.ENQUETE

// ⏱️ Duração da enquete (ms) — configurável aqui
let DURACAO_ENQUETE_MS = 2 * 60 * 1000

// 🎯 Limites de opções
const MAX_OPCOES = 12
const MIN_OPCOES = 2

// 🔢 Emojis de número para citar as opções no texto da mensagem
const EMOJIS_NUMERO = Array.from({ length: 12 }, (_, i) => `${i + 1}.`)

// ─── ✉️ Mensagens ───
const AVISO_USO =
  '📊 *ENQUETE DO LIMBO* — monte assim:\n\n' +
  '`/enquete pergunta | opção 1 | opção 2 | ...`\n\n' +
  'Ex.: `/enquete Pedro ou Ana? | Pedro | Ana | Não sei`\n\n' +
  `ℹ️ De ${MIN_OPCOES} a ${MAX_OPCOES} opções. Quem chamar, pode ser qualquer pessoa do grupo.\n` +
  '🗳️ Para votar, toque na opção da enquete nativa do WhatsApp.\n' +
  '⏱️ A enquete dura 2 minutos (ou até alguém usar /encerrar-enquete).'

const AVISO_ERRO = '⛔ A enquete se desfez nas sombras... Tente novamente em instantes.'

// ─── 📋 Estado (ganchos p/ testes offline) ───
let agendar = (fn, ms) => setTimeout(fn, ms)
let limparTimer = (id) => clearTimeout(id)

// ─── 🔓 Encerra a rodada ───
function encerrarEnquete (jid) {
  const jogo = obterJogo(jid)
  if (!jogo || jogo.tipo !== TIPO_JOGO) return null
  const dados = jogo.dados || {}
  if (dados.timer) {
    limparTimer(dados.timer)
    dados.timer = null
  }
  removerJogo(jid, TIPO_JOGO)
  return dados
}

// ─── 📊 Apura o resultado (contagem + vencedora/empate) ───
function apurar (dados) {
  const contagem = dados.opcoes.map((texto, indice) => ({
    indice,
    texto,
    votos: (dados.votos.get(indice) || new Set()).size
  }))
  const total = contagem.reduce((soma, c) => soma + c.votos, 0)

  if (total === 0) {
    return { contagem, total, vencedoras: [], empate: false, semVotos: true }
  }

  const maximo = Math.max(...contagem.map((c) => c.votos))
  const vencedoras = contagem.filter((c) => c.votos === maximo)
  return {
    contagem,
    total,
    maximo,
    vencedoras,
    empate: vencedoras.length > 1,
    semVotos: false
  }
}

// ─── 📤 Monta o texto do resultado ───
function textoResultado (dados, motivo) {
  const r = apurar(dados)
  const linhas = []

  linhas.push(motivo === 'tempo' ? '⏱️ *TEMPO ESGOTADO!* Votação encerrada.' : '🏁 *ENQUETE ENCERRADA!*')
  linhas.push(`📊 *${dados.pergunta}*\n`)

  for (const c of r.contagem) {
    const barra = '█'.repeat(c.votos).padEnd(r.total, '░')
    linhas.push(`${EMOJIS_NUMERO[c.indice]} ${c.texto} — *${c.votos}* voto(s) \`${barra}\``)
  }

  linhas.push(`\n🗳️ Total: *${r.total}** voto(s)`)

  if (r.semVotos) {
    linhas.push('\n🌙 Ninguém votou... o limbo ficou em silêncio.')
  } else if (r.empate) {
    linhas.push(`\n🤝 *EMPATE!* Venceu (n)m... empataram: *${r.vencedoras.map((c) => c.texto).join(' e ')}* (${r.maximo} voto(s) cada).`)
  } else {
    linhas.push(`\n🏆 *VENCEDORA:* ${r.vencedoras[0].texto} (${r.vencedoras[0].votos} voto(s))`)
  }

  linhas.push(`\n🌙 Digite \`/enquete pergunta | ...\` para a próxima.`)
  return linhas.join('\n')
}

// ─── 🗳️ Monta a mensagem da enquete (pergunta + opções numeradas) ───
function textoDaEnquete (dados) {
  const minutos = Math.max(1, Math.round(dados.duracaoMs / 60000))
  const linhas = [`📊 *ENQUETE DO LIMBO*\n\n❓ *${dados.pergunta}*\n`]
  dados.opcoes.forEach((opcao, indice) => {
    linhas.push(`${EMOJIS_NUMERO[indice]} ${opcao}`)
  })
  linhas.push(
    '\n🗳️ *Vote na enquete nativa do WhatsApp.*' +
    '\n⏱️ A enquete fecha em ~' + minutos + ' minuto(s) — ou antes, com /encerrar-enquete.' +
    `\n🔎 Quem criou: @${String(dados.autor).split('@')[0]}`
  )
  return linhas.join('\n')
}

// ─── 📊 Cria a enquete ───
async function criar (sock, jid, msg, autor, pergunta, opcoes) {
  if (!String(jid || '').endsWith('@g.us')) {
    return await sock.sendMessage(jid, {
      text: '🌙 *A enquete é coisa de grupo...*\n\nChame os amigos e rode `/enquete pergunta | opção 1 | opção 2` lá dentro.'
    }, { quoted: msg })
  }

  const invalida = nativa.validar(pergunta, opcoes)
  if (invalida) return await sock.sendMessage(jid, { text: `${invalida}\n\n${AVISO_USO}` }, { quoted: msg })

  // 🔒 Uma enquete por grupo. O registro compartilhado SÓ bloqueia tipos
  // diferentes (o mesmo tipo pode ser re-registrado — é assim que o /forca e
  // o /gartic tratam "já tem jogo meu aqui"), então a própria enquete ativa
  // precisa ser conferida ANTES.
  const atual = obterJogo(jid)
  if (atual && atual.tipo === TIPO_JOGO) {
    const d = atual.dados || {}
    return await sock.sendMessage(jid, {
      text: `🔒 Já tem uma enquete rolando neste grupo!\n\n❓ *${d.pergunta}*\n` +
        d.opcoes.map((o, i) => `${EMOJIS_NUMERO[i]} ${o}`).join('\n') +
        '\n\n🗳️ Vote na enquete nativa ou use /encerrar-enquete para fechar.'
    }, { quoted: msg })
  }

  const registro = registrarJogo(jid, TIPO_JOGO, {})
  if (!registro.ok) {
    return await sock.sendMessage(jid, {
      text: `🔒 Já tem um *${rotuloDoTipo(registro.conflito?.tipo)}* rolando neste grupo. Termine (ou cancele) ele antes.`
    }, { quoted: msg })
  }

  const dados = {
    pergunta,
    opcoes,
    // votos: índice da opção → Set de JIDs (um voto por pessoa)
    votos: new Map(opcoes.map((_, i) => [i, new Set()])),
    autor,
    inicio: Date.now(),
    duracaoMs: DURACAO_ENQUETE_MS,
    timer: null,
    sock
  }
  // registraJogo já criou o registro vazio: agora guardamos os dados reais
  const jogo = obterJogo(jid)
  if (jogo) jogo.dados = dados

  try {
    dados.mensagemEnquete = await sock.sendMessage(jid, nativa.montarEnquete(pergunta, opcoes))
    dados.timer = agendar(() => aoExpirar(jid), dados.duracaoMs)
    dados.timer?.unref?.()
    return dados.mensagemEnquete
  } catch (erro) {
    encerrarEnquete(jid)
    throw erro
  }
}

// ─── ⏱️ Expirou: apura e anuncia ───
function aoExpirar (jid) {
  try {
    const dados = encerrarEnquete(jid)
    if (!dados || !dados.sock) return
    console.log(`[enquete] ⌛ enquete expirada em ${jid}: ${dados.pergunta}`)
    dados.sock.sendMessage(jid, { text: textoResultado(dados, 'tempo') }).catch(() => {})
  } catch (err) {
    console.error('[enquete] 💥 erro ao encerrar por tempo:', err?.stack || err)
  }
}

// ─── 🏁 Encerramento manual (/encerrar-enquete) ───
async function encerrar (sock, jid, msg, autor) {
  const jogo = obterJogo(jid)
  if (jogo?.tipo === TIPOS.ENQUETE_ADMIN) return require('../admin/enquete-admin')[0].encerrarManual(sock, jid, msg, autor)
  if (!jogo || jogo.tipo !== TIPO_JOGO) {
    return await sock.sendMessage(jid, {
      text: '❌ Não tem nenhuma enquete rolando neste grupo para encerrar.'
    }, { quoted: msg })
  }

  // 🔒 Só quem criou encerra antes da hora (conforme a regra do comando)
  if (jogo.dados?.autor && autor && jogo.dados.autor !== autor) {
    return await sock.sendMessage(jid, {
      text: '🔒 Só quem criou a enquete pode encerrá-la antes da hora.'
    }, { quoted: msg })
  }

  const dados = encerrarEnquete(jid)
  return await sock.sendMessage(jid, { text: textoResultado(dados, 'manual') }, { quoted: msg })
}

// O fluxo sem prefixo também entrega pollUpdateMessage; texto livre não é voto.
async function registrarVoto (sock, jid, msg) {
  const jogo = obterJogo(jid)
  if (!jogo || jogo.tipo !== TIPO_JOGO) return false
  return nativa.registrarVotoNativo(sock, jid, msg, jogo.dados)
}

registrarOuvinteTexto(TIPO_JOGO, registrarVoto)

// ─── ✂️ Separar pergunta e opções (o separador é o "|") ───
function parse (texto) { return nativa.parse(texto) }

// ---- EXPORTAÇÃO PRINCIPAL (mesmo contrato do loader) ----
// 📦 ARRAY de 2 comandos, como o /acoes faz: o loader percorre cada item do
// array e registra um comando (é assim que /encerrar-enquete entra no bot
// sem precisar de um arquivo só para ele).
const cmdEnquete = {
  nome: 'enquete',
  aliases: ['enquete-opiniao'],
  descricao: 'Enquete nativa de opinião no grupo: /enquete pergunta | opção 1 | opção 2 (2 minutos de apuração).',

  executar: async function (sock, jid, msg, texto) {
    try {
      const autor = msg.key?.participant || msg.key?.remoteJid
      const bruto = require('../../prefixo').removerPrefixo(String(texto || '')).replace(/^\S+\s*/, '').trim()
      const normalizado = normalizar(bruto)

      // /encerrar-enquete escrito dentro do /enquete também funciona
      if (normalizado === 'encerrar-enquete' || normalizado === 'encerrar enquete') {
        return await encerrar(sock, jid, msg, autor)
      }

      const { pergunta, opcoes } = parse(texto)

      if (!String(texto).includes('|')) {
        // Sem "|" → mostra a ativa (se houver) ou as instruções
        const jogo = obterJogo(jid)
        if (jogo && jogo.tipo === TIPO_JOGO && ['', 'status'].includes(bruto.toLowerCase())) {
          return await sock.sendMessage(jid, { text: textoDaEnquete(jogo.dados) }, { quoted: msg })
        }
        return await sock.sendMessage(jid, { text: AVISO_USO }, { quoted: msg })
      }

      return await criar(sock, jid, msg, autor, pergunta, opcoes)
    } catch (err) {
      // 🛡️ Nada escapa para o socket
      console.error('[enquete] 💥 erro capturado (o bot segue vivo):', err?.stack || err)
      await sock.sendMessage(jid, { text: AVISO_ERRO }, { quoted: msg }).catch(() => {})
    }
  }
}

// 🏁 /encerrar-enquete — delega para a MESMA lógica de encerramento
const cmdEncerrar = {
  nome: 'encerrar-enquete',
  descricao: 'Encerra a enquete do grupo antes da hora (só quem criou).',

  executar: async function (sock, jid, msg) {
    try {
      const autor = msg.key?.participant || msg.key?.remoteJid
      return await encerrar(sock, jid, msg, autor)
    } catch (err) {
      console.error('[enquete] 💥 erro no /encerrar-enquete (o bot segue vivo):', err?.stack || err)
      await sock.sendMessage(jid, { text: AVISO_ERRO }, { quoted: msg }).catch(() => {})
    }
  }
}

// 🧪 Extras internos para os testes offline (mesmo padrão do /acoes e do
// /desenharpalavra) — anexados aos DOIS itens para dar acesso a partir
// de qualquer um deles.
const EXTRAS = {
  TIPO_JOGO,
  MAX_OPCOES,
  MIN_OPCOES,
  EMOJIS_NUMERO,
  parse,
  apurar,
  textoResultado,
  textoDaEnquete,
  criar,
  aoExpirar,
  encerrar,
  encerrarEnquete,
  registrarVoto,
  _definirDuracao: (ms) => { DURACAO_ENQUETE_MS = Number(ms) > 0 ? Number(ms) : 2 * 60 * 1000 },
  _injetarAgendador: (fnAgendar, fnLimpar) => {
    agendar = fnAgendar || ((fn, ms) => setTimeout(fn, ms))
    if (typeof fnLimpar === 'function') limparTimer = fnLimpar
  },
  _enqueteAtiva: (jid) => {
    const j = obterJogo(jid)
    return j && j.tipo === TIPO_JOGO ? j.dados : null
  }
}

module.exports = [
  Object.assign(cmdEnquete, EXTRAS),
  Object.assign(cmdEncerrar, EXTRAS)
]
