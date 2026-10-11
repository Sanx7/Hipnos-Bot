const ads = require('../../anuncios')
const midia = require('../../dados/ads-midia')
const storage = require('../../dados/ads-storage')
const { autorizado, identificar } = require('../../dados/advertencias-contexto')
const { extrairTextoComando } = require('../../dados/texto-comando')
const { obterPrefixo } = require('../../prefixo')
module.exports = {
  nome: 'setads', aliases: ['ads', 'anuncios', 'anuncioauto'], descricao: 'Anúncios automáticos persistentes neste grupo.',
  async executar(sock, jid, msg, text) {
    const responder = text => sock.sendMessage(jid, { text })
    try {
      if (!ads.GRUPO.test(jid)) return await responder('🌑 Os anúncios do Olimpo pertencem somente a grupos.')
      const meta = await sock.groupMetadata(jid), sender = msg?.key?.participant || msg?.key?.remoteJid
      if (!await autorizado(meta, sender, true)) return await responder('🔒 Apenas administradores, dono do grupo ou donos do Hipnos podem gerir anúncios.')
      const autor = (await identificar(meta.participants || [], sender)).numero
      const entrada = String(text ?? extrairTextoComando(msg)).replace(/^\s*\S+\s*/, '')
      const [acao, id, valor, ...extras] = entrada.trim().split(/\s+/)
      const p = await obterPrefixo()
      if (!acao) return await responder(`🌙 *ANÚNCIOS DO OLIMPO*\n${p}setads criar texto (ou respondendo a foto/vídeo)\n${p}setads listar/status\n${p}setads ver <id>\n${p}setads intervalo <id> <15–1440 minutos>\n${p}setads horario <id> <HH:MM>\n${p}setads pausar/retomar/excluir <id>\n\nAté 5 anúncios. Novos anúncios ficam pausados: configure e retome. Horários de São Paulo. Fotos: 8 MB; vídeos: 16 MB; texto/legenda: 3000 caracteres. O OFF mantém anúncios ativos.`)
      if (acao === 'criar') {
        const conteudo = await midia.extrair(sock, jid, msg, entrada.replace(/^criar(?:\s+|$)/, ''))
        const doc = await ads.criar(jid, conteudo, autor)
        return await responder(`🌙 Anúncio #${doc.id} guardado e pausado. Configure intervalo/horario e use ${p}setads retomar ${doc.id}.`)
      }
      if (['listar','status'].includes(acao) && !id) {
        const docs = await ads.listar(jid)
        return await responder(`📜 *ANÚNCIOS DO OLIMPO* (${docs.length}/5)\n\n${docs.map(ads.resumo).join('\n\n') || 'Nenhum anúncio.'}\n\nAnúncios ativos continuam durante OFF. Horários perdidos não são reenviados.`)
      }
      if (acao === 'ver' && id && !valor) {
        const doc = await ads.obter(jid, id), conteudo = await midia.preparar(doc, await storage.obter())
        await sock.sendMessage(jid, conteudo)
        return await responder(`📜 Prévia de #${doc.id}.\n${ads.resumo(doc)}`)
      }
      if (['intervalo','horario','pausar','retomar'].includes(acao) && id && !extras.length && (['intervalo','horario'].includes(acao) ? Boolean(valor) : !valor)) {
        const doc = await ads.alterar(jid, id, acao, valor, autor)
        return await responder(`🌙 ${ads.resumo(doc)}${['intervalo','horario'].includes(acao) ? `\nUse ${p}setads retomar ${id} para ativar.` : ''}`)
      }
      if (acao === 'excluir' && id && !extras.length) {
        const token = await ads.excluir(jid, id, autor, valor)
        return await responder(token ? `⚖️ Confirme em até 60 segundos: ${p}setads excluir ${id} ${token}. O anúncio e sua mídia serão apagados.` : '🌙 Anúncio excluído. Se o armazenamento estiver indisponível, a limpeza da mídia será retomada automaticamente.')
      }
      await responder(`📜 Opções inválidas. Use ${p}setads para consultar os comandos.`)
    } catch (e) {
      console.info('[setads]', 'comando_falhou')
      await responder(`🌫️ ${e.publico ? e.message : 'Não consegui concluir o anúncio. Confira o banco, a mídia e a conexão; tente novamente.'}`).catch(() => {})
    }
  }
}
