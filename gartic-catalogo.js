const { randomUUID, randomBytes, createHash } = require('node:crypto')
const { PALAVRAS, normalizar } = require('./dados/palavras-anagrama')
const prefixo = require('./prefixo')
const estado = require('./estado-bot')
const { identificar, identidade } = require('./dados/identidade-participante')
const socket = require('./dados/socket-seguro')
const erro = require('./dados/ads-erro')
const midia = require('./dados/gartic-midia')
const { criarRepositorio } = require('./dados/gartic-mongo')
const { criarCloudinary } = require('./dados/gartic-cloudinary')

function palavraValida(texto) {
  const palavra = String(texto || '').normalize('NFC').trim().replace(/\s+/g, ' ')
  if (palavra.length < 2 || palavra.length > 60 || !/^[\p{L}]+(?:[ -][\p{L}]+)*$/u.test(palavra)) throw erro('Use uma palavra ou expressão de 2 a 60 letras, espaços ou hífens, sem números nem símbolos.')
  const palavraChave = normalizar(palavra)
  // O comparador original do jogo aceita letras A-Z, ignorando acentos.
  if (!/^[a-z]+(?:[ -][a-z]+)*$/.test(palavraChave)) throw erro('Use letras compatíveis com os palpites do jogo (acentos em português são aceitos).')
  const categoria = PALAVRAS.find(p => normalizar(p.palavra) === palavraChave)?.categoria || 'catálogo'
  return { palavra, palavraChave, categoria }
}
function argumentos(texto) { return prefixo.removerPrefixo(String(texto || '')).replace(/^\S+\s*/, '').trim() }
async function verificarDono(sock, jid, autor) {
  if (!identidade(autor)) return null
  if (identidade(autor).startsWith('lid:') && String(jid).endsWith('@g.us')) {
    try {
      const meta = await sock.groupMetadata(jid)
      const alvo = await identificar(meta?.participants || [], autor)
      const pn = alvo.numero && `pn:${alvo.numero}`
      if (pn && (meta?.participants || []).filter(p => [p.id, p.phoneNumber].some(id => identidade(id) === pn)).length > 1) return null
      return alvo.participante && alvo.dono ? alvo.numero : null
    } catch (_) { return null }
  }
  return estado.obterNumeroDono(sock, jid, autor)
}
function criarCatalogo(injetadas = {}) {
  const deps = { repo: criarRepositorio(), cloud: criarCloudinary(), extrair: midia.extrair,
    dono: verificarDono, disponivel: socket.disponivel,
    agora: Date.now, agendar: setTimeout, limpar: clearTimeout, codigo: () => randomBytes(6).toString('hex'), ...injetadas }
  const previas = new Map()
  let ocupado = false
  async function autorizar(sock, jid, msg) {
    if (!deps.disponivel(sock)) return null
    const autor = msg?.key?.fromMe ? sock.user?.id : (msg?.key?.participant || jid)
    if (!identidade(autor)) return null
    return deps.dono(sock, jid, autor)
  }
  async function enviar(sock, jid, msg, text) {
    if (deps.disponivel(sock)) await sock.sendMessage(jid, { text }, { quoted: msg })
  }
  async function mutacao(fn) {
    if (ocupado) throw erro('Já existe uma alteração do catálogo em andamento. Tente novamente depois.')
    ocupado = true
    const token = randomUUID()
    let travou = false
    try {
      travou = await deps.repo.travar(token)
      if (!travou) throw erro('O catálogo está ocupado ou possui uma operação pendente de revisão. Tente novamente depois.')
      return await fn()
    } finally {
      if (travou) try { await deps.repo.destravar(token) } catch (_) { console.warn('[gartic-catalogo]', { evento: 'trava_pendente' }) }
      ocupado = false
    }
  }
  // Só apaga um asset reservado por ESTA operação após confirmar que não está ativo.
  async function limparUpload(doc) {
    try {
      await deps.repo.alterar(doc._id, { ativo: false, estado: 'limpeza_pendente' })
      await deps.cloud.destruir(doc.publicId, doc.cloudName)
      await deps.repo.apagar(doc._id)
      return true
    } catch (_) { console.warn('[gartic-catalogo]', { evento: 'limpeza_pendente' }); return false }
  }
  async function adicionar(sock, jid, msg, texto) {
    const palavra = palavraValida(argumentos(texto))
    await mutacao(async () => {
      const cloudName = deps.cloud.configurar()
      const foto = await deps.extrair(sock, jid, msg)
      if (!await autorizar(sock, jid, msg)) throw erro('Não consegui reconfirmar sua autorização.')
      const cadastroId = randomUUID()
      const doc = { _id: foto.hash, hash: foto.hash, ...palavra, cadastroId, cloudName,
        publicId: `hipnos/gartic/${cadastroId}`, secureUrl: null, dataCadastro: new Date(deps.agora()),
        ativo: false, estado: 'upload_pendente', width: foto.width, height: foto.height }
      try { await deps.repo.reservar(doc) }
      catch (e) { if (e.code === 11000) throw erro('Essa mesma imagem já está cadastrada ou possui cadastro pendente.'); throw e }
      let upload
      try { upload = await deps.cloud.upload(foto.buffer, doc.publicId) }
      catch (_) {
        // Timeout de upload é ambíguo: mantém reserva inativa para revisão/remoção.
        await deps.repo.alterar(doc._id, { ativo: false, estado: 'upload_incerto' }).catch(() => {})
        throw erro('O upload não foi confirmado. O cadastro permanece inativo; consulte /gartic-lista e use /gartic-remover para revisar a limpeza.')
      }
      try {
        await deps.repo.alterar(doc._id, { ...upload, ativo: true, estado: 'ativo' })
      } catch (_) {
        // Primeiro reconfirma/desativa no Mongo; não destrói um asset que pode estar ativo.
        const limpo = await limparUpload(doc)
        throw erro(limpo ? 'Não consegui gravar o cadastro. A imagem enviada foi removida com segurança.' : 'Não consegui confirmar o cadastro nem a limpeza. Há uma pendência para revisão em /gartic-lista; não repita o upload.')
      }
      await enviar(sock, jid, msg, `✅ Imagem cadastrada para *${palavra.palavra}*.\n📂 Categoria: ${palavra.categoria}\n🎨 Use ${prefixo.prefixoSincrono()}gartic no grupo para jogar.`)
    })
  }
  async function listar(sock, jid, msg, texto) {
    const resto = argumentos(texto)
    if (resto && !/^[1-9]\d{0,5}$/.test(resto)) throw erro('Use /gartic-lista ou /gartic-lista 2.')
    const pagina = Number(resto || 1), resumo = await deps.repo.listar(pagina)
    const paginas = Math.max(1, Math.ceil(resumo.palavras / 10))
    if (pagina > paginas) throw erro(`Página inválida. O catálogo tem ${paginas} página(s).`)
    const linhas = resumo.itens.map(p => `• ${p.palavra}: ${p.imagens} imagem(ns), ${p.ativas} ativa(s)`)
    await enviar(sock, jid, msg, `🎨 *CATÁLOGO DO GARTIC*\n\nPalavras: ${resumo.palavras}\nImagens: ${resumo.imagens}\nAtivas: ${resumo.ativas}\nInativas/pendentes: ${resumo.imagens - resumo.ativas}\n\n${linhas.join('\n') || 'O catálogo está vazio.'}\n\nPágina ${pagina}/${paginas}. Use ${prefixo.prefixoSincrono()}gartic-lista <página>.`)
  }
  async function resumirPalavra(palavraChave) {
    const hash = createHash('sha256')
    let quantidade = 0, ativas = 0
    for await (const doc of deps.repo.porPalavra(palavraChave)) {
      hash.update(JSON.stringify([doc._id, doc.cadastroId, doc.publicId, doc.cloudName, doc.estado, doc.ativo]))
      quantidade++; if (doc.ativo) ativas++
    }
    return { quantidade, ativas, resumoHash: hash.digest('hex') }
  }
  function apagarPrevia(chave) {
    const p = previas.get(chave)
    if (p) deps.limpar(p.timer)
    previas.delete(chave)
  }
  async function remover(sock, jid, msg, texto, dono) {
    const resto = argumentos(texto), chave = JSON.stringify([jid, dono])
    if (resto === 'cancelar') { apagarPrevia(chave); return enviar(sock, jid, msg, '🌙 Prévia de remoção cancelada.') }
    if (/^confirmar\s/i.test(resto)) {
      const p = previas.get(chave)
      if (!p || p.expira <= deps.agora() || resto !== `confirmar ${p.codigo}`) throw erro('Confirmação inválida ou expirada. Peça uma nova prévia nesta conversa.')
      // Consome uma vez; outra confirmação não pode iniciar exclusão concorrente.
      apagarPrevia(chave)
      return mutacao(async () => {
        if (!await autorizar(sock, jid, msg)) throw erro('Não consegui reconfirmar sua autorização.')
        deps.cloud.configurar()
        const atual = await resumirPalavra(p.palavraChave)
        if (atual.resumoHash !== p.resumoHash || atual.quantidade !== p.quantidade) throw erro('O catálogo mudou desde a prévia. Peça uma nova prévia antes de confirmar.')
        // Todos ficam inativos ANTES de qualquer efeito no Cloudinary.
        await deps.repo.desativarPalavra(p.palavraChave)
        let removidas = 0, pendentes = 0
        for await (const doc of deps.repo.porPalavra(p.palavraChave)) {
          if (!deps.disponivel(sock)) { pendentes++; continue }
          try {
            const incerto = ['upload_pendente', 'upload_incerto'].includes(doc.estado)
            await deps.repo.alterar(doc._id, { ativo: false, estado: incerto ? 'upload_incerto' : 'removendo' })
            const resultado = await deps.cloud.destruir(doc.publicId, doc.cloudName)
            // Um timeout de upload pode ainda criar o asset depois de um "not found".
            // Não esquecer a reserva: mantém o ID conhecido e a deduplicação.
            if (incerto && resultado === 'not found') { pendentes++; continue }
            await deps.repo.apagar(doc._id)
            removidas++
          } catch (_) { pendentes++; console.warn('[gartic-catalogo]', { evento: 'remocao_pendente' }) }
        }
        await enviar(sock, jid, msg, `🎨 Remoção de *${p.palavra}*: ${removidas} imagem(ns) removida(s); ${pendentes} pendente(s).` +
          (pendentes ? '\nAs pendentes estão inativas. Peça outra prévia e confirme novamente para tentar a limpeza.' : ''))
      })
    }
    const palavra = palavraValida(resto)
    await mutacao(async () => {
      const resumo = await resumirPalavra(palavra.palavraChave)
      if (!resumo.quantidade) throw erro('Não há imagens cadastradas para essa palavra.')
      apagarPrevia(chave)
      if (previas.size >= 1000) throw erro('Limite de prévias atingido. Tente novamente em dois minutos.')
      const p = { ...palavra, ...resumo, codigo: deps.codigo(), expira: deps.agora() + 120000 }
      previas.set(chave, p)
      p.timer = deps.agendar(() => apagarPrevia(chave), 120000); p.timer?.unref?.()
      await enviar(sock, jid, msg, `⚠️ *PRÉVIA DE REMOÇÃO*\n\nPalavra: *${p.palavra}*\nImagens: ${p.quantidade} (${p.ativas} ativas).\nSerão removidos os arquivos do Cloudinary e seus registros.\n\nConfirme nesta conversa em até 2 minutos:\n${prefixo.prefixoSincrono()}gartic-remover confirmar ${p.codigo}\n\nCancelar: ${prefixo.prefixoSincrono()}gartic-remover cancelar`)
    })
  }
  async function executar(acao, sock, jid, msg, texto) {
    try {
      const dono = await autorizar(sock, jid, msg)
      if (!dono) return enviar(sock, jid, msg, '🔒 Somente o dono do bot pode gerenciar o catálogo do Gartic.')
      if (acao === 'add') return await adicionar(sock, jid, msg, texto)
      if (acao === 'lista') return await listar(sock, jid, msg, texto)
      if (acao === 'remover') return await remover(sock, jid, msg, texto, dono)
    } catch (e) {
      console.warn('[gartic-catalogo]', { evento: 'operacao_falhou', acao })
      const publico = e?.publico ? e.message.replace(/\/gartic/g, `${prefixo.prefixoSincrono()}gartic`) : 'O catálogo está indisponível. Nenhuma conclusão foi presumida; tente novamente depois.'
      await enviar(sock, jid, msg, `⛔ ${publico}`).catch(() => {})
    }
  }
  return { executar, sortear: (categoria, excluidas) => deps.repo.sortear(categoria, excluidas), baixar: doc => deps.cloud.baixar(doc),
    __teste: { previas }, fechar() { for (const chave of previas.keys()) apagarPrevia(chave) } }
}
const catalogo = criarCatalogo()
module.exports = { ...catalogo, criarCatalogo, palavraValida, argumentos }
