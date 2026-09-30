// ============================================================
// 🕵️ PROCURADO (/procurado) — o cartaz do líder do ranking
// ============================================================
// Mostra o #1 do ranking de mensagens do grupo como um CARTAZ DE PROCURADO:
// a moldura ilustrada (assets/quadros/cartaz-procurado.png) com a foto da
// pessoa no círculo, o nome, a alcunha, a contagem de mensagens e a data.
//
// 🗄️ Os dados vêm do MESMO ranking do /ranking (../database.js `buscarRanking`,
// filtrado pelo grupo atual) e do VIP (vip.js) para o nome custom e a
// alcunha custom. Nada de collection nova.
//
// 🎲 ALCUNHA: a do VIP (`alcunhaCustom`) quando existir; senão a alcunha
// PADRÃO do número (dados/alcunhas.js, hash FNV-1a) — determinística, não
// muda sozinha e vale para qualquer pessoa, VIP ou não.
//
// 📅 "no topo desde": ⚠️ SIMPLIFICAÇÃO DELIBERADA. O banco de mensagens
// (database.js) guarda só o total acumulado por usuário — não existe
// histórico de "desde quando essa pessoa está no topo". Então a data
// impressa é a de HOJE, no fuso de São Paulo. Quando (e se) existir o
// histórico, é só trocar `dataDeHoje()` pela leitura dele; o resto do
// desenho não muda.
//
// 🛟 Se a imagem falhar por qualquer motivo (moldura ausente, Jimp, download
// da foto, envio), o comando cai no TEXTO de sempre com a mesma informação —
// ninguém fica sem saber quem está liderando.
//
// 📸 Foto: `sock.profilePictureUrl` + download (o mesmo caminho do /perfil).
// Sem foto/privacidade → o cartaz sai com o disco dourado vazio.
// ============================================================

const { buscarRanking, normalizarId } = require('../../database')
// 💠 Nome custom + alcunha custom do VIP (campos `nomeCustom` e
// `alcunhaCustom` do MESMO documento de VIP).
const vip = require('../../vip')
// ⚔️ A alcunha padrão (hash do número) — vale para quem não é VIP.
const alcunhas = require('../../dados/alcunhas')
// 📜 A arte do cartaz (desenho em Jimp + miniatura do preview).
const { comporCartazProcurado, miniaturaDoCartaz } = require('../../dados/cartaz-procurado')
// Formatação legível dos números (fonte única: ../../config).
const { formatarNumero } = require('../../config')
// 🪪 O banco do ranking guarda o `usuario_id` como o bot.js o recebeu do
// Baileys (LID cru quando o grupo tem LID habilitado), enquanto o documento
// de VIP é gravado pelo NÚMERO REAL (/darvip). Mesmo do /ranking: o módulo
// compartilhado ../../ranking-registro.js resolve os identificadores
// (resolverNumeros) e AGRUPA as linhas da MESMA pessoa (agruparPorNumero —
// LID + telefone = 1 candidato com a SOMA), garantindo o líder certo.
const {
  LIMITE_BUSCA_AGRUPAMENTO,
  resolverNumeros,
  agruparPorNumero
} = require('../../ranking-registro')

// 📜 Frase de rodapé do cartaz (a mesma do humor do /ranking).
const RODAPE_CARTAZ = 'Quem linger mais no chat, mais aparece aqui.'

// ⏱️ Download da foto: mesmo contrato do /perfil (NUNCA lança, devolve null).
async function baixarFoto (url, limiteBytes = 8 * 1024 * 1024, timeoutMs = 15000) {
  if (typeof url !== 'string' || !url.startsWith('https://')) return null
  if (typeof globalThis.fetch !== 'function') return null
  let temporizador = null
  try {
    const resposta = await Promise.race([
      globalThis.fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'WhatsApp/2.24.6.77' } }),
      new Promise((_, rej) => {
        temporizador = setTimeout(() => rej(new Error('timeout ao baixar a foto')), timeoutMs)
      })
    ]).finally(() => {
      if (temporizador) clearTimeout(temporizador)
    })
    if (!resposta.ok) return null
    const bytes = new Uint8Array(await resposta.arrayBuffer())
    if (bytes.length === 0 || bytes.length > limiteBytes) return null
    return Buffer.from(bytes)
  } catch (err) {
    console.error('[procurado] ⚠️ não foi possível baixar a foto:', err?.message || err)
    return null
  }
}

// 📅 "30/09/2026" no fuso de São Paulo. (Ver a nota sobre a simplificação do
// "desde" no cabeçalho deste arquivo.)
function dataDeHoje (agora) {
  const d = agora || new Date()
  const partes = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).formatToParts(d)
  const valor = (tipo) => partes.find((p) => p.type === tipo)?.value || ''
  return `${valor('day')}/${valor('month')}/${valor('year')}`
}

// Normaliza um participante (objeto ou JID) para comparar com o banco.
function normalizarParticipante (participante) {
  if (!participante) return ''
  const idStr = typeof participante === 'object'
    ? participante.id || participante.jid || ''
    : String(participante)
  return idStr.split('@')[0].split(':')[0].replace(/\D/g, '')
}

// 🏛️ O gerador do cartaz fica numa variável porque os testes trocam por um
// gerador que falha de propósito (para exercitar o fallback em texto).
let comporCartaz = comporCartazProcurado
let gerarMiniatura = miniaturaDoCartaz

// 👥 O líder ainda faz parte do grupo? (o ranking guarda histórico, então pode
// ter saído desde então). Função PURA sobre a lista de participantes (os
// metadados são lidos UMA vez pelo comando): compara TODOS os identificadores
// do líder agrupado (LID e telefone, via `agruparPorNumero`) e também o número
// real resolvido — num grupo com LID cada lado pode estar no outro formato.
// ⚠️ Falha de metadados NÃO é tratada aqui: quem chama decide (sem lista, o
// cartaz não pode sair com "saiu do grupo" por causa de um erro de rede).
function aindaNoGrupo(participantes, ids, numeroReal) {
  const alvos = (Array.isArray(ids) ? ids : [ids])
    .map((id) => normalizarId(id))
    .filter(Boolean)
  if (numeroReal) alvos.push(normalizarId(numeroReal))
  if (!alvos.length) return true
  const lista = participantes || []
  return lista.some((p) => alvos.includes(normalizarParticipante(p)))
}

// 📸 Foto de perfil do líder: URL pública + download. Devolve null (sem
// lançar) quando não tem foto, a privacidade bloqueou ou a rede falhou — o
// cartaz sai com o disco dourado vazio.
async function buscarFotoDoLider (sock, numero) {
  if (!numero) return null
  const jidLider = numero + '@s.whatsapp.net'
  let url = null
  try {
    url = await sock.profilePictureUrl(jidLider, 'image')
  } catch (err) {
    console.error('[procurado] 📸 sem foto pública (cartaz sai com o disco vazio):', err?.message || err)
    return null
  }
  if (!url) return null
  return await baixarFoto(url)
}

// 💬 Fallback em TEXTO: mesmas informações do cartaz, sem imagem. É o que
// salva o comando quando a arte (ou o envio) falha.
function respostaEmTexto ({ nome, alcunha, total, palavra, desde, saiu }) {
  return (
    '🕵️ *PROCURADO* 🕵️\n\n' +
    `👤 *${nome}*${saiu ? ' *(saiu do grupo)*' : ''}\n` +
    `⚔️ *"${alcunha}"*\n\n` +
    `💬 *${total}* ${palavra} no ranking do grupo\n` +
    `📅 no topo desde: ${desde}`
  )
}

module.exports = {
  nome: 'procurado',
  aliases: ['maisativo', 'wanted', 'lider'],
  descricao: 'Mostra o líder do ranking do grupo num cartaz de procurado com foto, alcunha e contagem.',
  categoria: 'utilitario',

  async executar (sock, jid, msg) {
    try {
      // 1) O /procurado só faz sentido dentro de um grupo (o ranking é por grupo)
      if (!jid.endsWith('@g.us')) {
        return sock.sendMessage(jid, {
          text:
            '💤 *O /procurado só funciona em grupos.*\n\n' +
            'O cartaz é do líder de mensagens do grupo — invoque lá dentro para ver quem está no topo.'
        }, { quoted: msg })
      }

      // 2) 📊 As linhas do ranking deste grupo. 🪪 Busca MAIS do que a posição
      //    que será exibida (LIMITE_BUSCA_AGRUPAMENTO): o agrupamento do passo 3
      //    junta o LID e o telefone da MESMA pessoa, e o documento do telefone
      //    pode estar fora da primeira posição.
      const linhas = await buscarRanking(jid, LIMITE_BUSCA_AGRUPAMENTO)
      if (!linhas.length) {
        return sock.sendMessage(jid, {
          text:
            '🌑 *Ninguém está sendo procurado...*\n\n' +
            'Ainda não há mensagens registradas neste grupo. 💤\n' +
            'Envie algumas mensagens e chame o /procurado novamente.'
        }, { quoted: msg })
      }

      // 3) 🪪 Metadados do grupo UMA única vez (aqui pode: o /procurado é um
      //    comando, não o messages.upsert — que não pode pagar um IQ de rede
      //    por mensagem). Com eles resolvemos os identificadores (LID cru →
      //    telefone) e AGRUPAMOS as linhas da MESMA pessoa: o líder é quem tem
      //    a MAIOR SOMA, e não o maior documento isolado.
      let participantes = []
      let temMetadados = false
      try {
        const metadados = await sock.groupMetadata(jid)
        participantes = metadados?.participants || []
        temMetadados = true
      } catch (errMeta) {
        console.error('[procurado] ⚠️ sem metadados do grupo (seguindo sem eles):', errMeta?.message || errMeta)
      }

      let numeros = new Map()
      try {
        numeros = await resolverNumeros(participantes, linhas.map((i) => i.usuario_id))
      } catch (errResolucao) {
        console.error('[procurado] ⚠️ falha ao resolver os identificadores:', errResolucao?.message || errResolucao)
      }

      let candidatos = []
      try {
        candidatos = agruparPorNumero(linhas, numeros)
      } catch (errAgrupamento) {
        console.error('[procurado] ⚠️ falha ao agrupar por número (usando as linhas cruas):', errAgrupamento?.message || errAgrupamento)
        candidatos = linhas
      }

      const lider = candidatos[0]
      if (!lider) {
        return sock.sendMessage(jid, {
          text:
            '🌑 *Ninguém está sendo procurado...*\n\n' +
            'Ainda não há mensagens registradas neste grupo. 💤\n' +
            'Envie algumas mensagens e chame o /procurado novamente.'
        }, { quoted: msg })
      }

      // 4) 🪪 O `usuario_id` do líder JÁ É o número resolvido, então ele vale
      //    para o VIP, para a alcunha padrão e para o "saiu do grupo".
      const numero = lider.usuario_id

      // 5) Estilo do VIP (nome custom + alcunha custom) e nome exibido.
      //    Falha do banco de VIPs não derruba o cartaz — fica o padrão.
      let nome = lider.nome || formatarNumero(numero)
      let alcunha = alcunhas.alcunhaPadrao(numero)
      try {
        const estilo = await vip.obterEstilosVip([numero])
        const doLider = estilo.get(normalizarId(numero)) || {}
        if (doLider.nome) nome = doLider.nome
        if (doLider.alcunha) alcunha = doLider.alcunha
      } catch (errEstilo) {
        console.error('[procurado] ⚠️ falha ao ler o estilo do VIP (seguindo no padrão):', errEstilo?.message || errEstilo)
      }

      // 6) O "desde" é a data de hoje (ver a nota de simplificação no topo).
      //    O total é a SOMA do grupo (LID + telefone da mesma pessoa).
      const desde = dataDeHoje()
      const total = lider.total
      const palavra = total > 1 ? 'mensagens' : 'mensagem'
      // ⚠️ Sem metadados não dá para saber quem saiu: NÃO marca (a rede não pune).
      const saiu = temMetadados ? !aindaNoGrupo(participantes, lider.ids, numero) : false

      // 7) 📜 O cartaz. Qualquer tropeço (moldura, arte, miniatura, envio)
      //    cai no TEXTO logo abaixo, sem perder a informação.
      const legenda = `🕵️ Procurado: ${nome}${saiu ? ' (saiu do grupo)' : ''}`
      try {
        // 📸 Foto de perfil: pública e baixável? Usa; senão, disco dourado vazio.
        const foto = await buscarFotoDoLider(sock, numero)
        const cartaz = await comporCartaz({
          nome,
          alcunha,
          total,
          palavra,
          desde,
          rodape: RODAPE_CARTAZ,
          foto
        })
        const miniatura = await gerarMiniatura(cartaz)
        const payload = { image: cartaz, caption: legenda }
        if (miniatura) payload.jpegThumbnail = miniatura
        await sock.sendMessage(jid, payload, { quoted: msg })
      } catch (errCartaz) {
        console.error('[procurado] ⚠️ cartaz falhou, segue em texto:', errCartaz?.message || errCartaz)
        await sock.sendMessage(jid, { text: respostaEmTexto({ nome, alcunha, total, palavra, desde, saiu }) }, { quoted: msg })
      }
    } catch (err) {
      console.error('Erro no comando procurado:', err)
      await sock.sendMessage(jid, {
        text: '⛔ As sombras confundiram o /procurado... Tente novamente.'
      }, { quoted: msg })
    }
  },

  // 🧪 Ganchos e peças para os testes offline (não viram comando).
  _injetarCartaz (fn) { comporCartaz = fn },
  _restaurarCartaz () { comporCartaz = comporCartazProcurado; gerarMiniatura = miniaturaDoCartaz },
  _injetarMiniatura (fn) { gerarMiniatura = fn },
  __internos: {
    RODAPE_CARTAZ,
    dataDeHoje,
    normalizarParticipante,
    aindaNoGrupo,
    baixarFoto,
    respostaEmTexto
  }
}
