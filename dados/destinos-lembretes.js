// Cache por listagem: inclui falhas e compartilha a consulta usada para
// resolver o remetente LID. Não persiste nomes nem altera lembretes.
function criarConsultaMetadados(sock) {
  const cache = new Map()
  return grupoId => {
    if (!cache.has(grupoId)) {
      cache.set(grupoId, Promise.resolve().then(() => sock.groupMetadata(grupoId)).catch(erro => {
        console.error('[meuslembretes] grupo indisponível:', erro?.message || erro)
        return null
      }))
    }
    return cache.get(grupoId)
  }
}

async function resolverDestinos(pendentes, consultarMetadados) {
  const grupos = [...new Set(pendentes.map(doc => doc.grupo_id).filter(Boolean))]
  const destinos = await Promise.all(grupos.map(async grupoId => {
    const metadados = await consultarMetadados(grupoId)
    const nome = typeof metadados?.subject === 'string' ? metadados.subject.trim() : ''
    return [grupoId, nome ? `👥 Grupo: ${nome}` : '👥 Grupo indisponível']
  }))
  return new Map(destinos)
}

function destinoDoLembrete(doc, destinos) {
  return doc.grupo_id ? destinos.get(doc.grupo_id) || '👥 Grupo indisponível' : '💬 Conversa privada'
}

module.exports = { criarConsultaMetadados, resolverDestinos, destinoDoLembrete }
