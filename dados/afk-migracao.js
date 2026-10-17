// Migração por isolamento de esquema: nenhuma escrita/apagamento na origem.
function nomesAfk(base = 'afks') { return { legado: base, ativo: `${base}_por_grupo` } }

async function prepararColecaoAfk(db, base) {
  const colecao = db.collection(nomesAfk(base).ativo)
  await colecao.createIndex({ grupo_id: 1, numero: 1 }, { unique: true, name: 'idx_afks_grupo_numero' })
  return colecao
}

async function auditarAfk(db, base) {
  const nomes = nomesAfk(base)
  const resultado = { estrategia: 'colecao_versionada_sem_atribuir_grupos', registros_copiados: 0, registros_apagados: 0 }
  for (const [tipo, nome] of Object.entries(nomes)) {
    const existe = await db.listCollections({ name: nome }, { nameOnly: true }).hasNext()
    resultado[tipo] = existe ? {
      registros: await db.collection(nome).countDocuments({}),
      indices: (await db.collection(nome).listIndexes().toArray()).map(i => ({ nome: i.name, chave: i.key, unico: i.unique === true || i.name === '_id_' }))
    } : { registros: 0, indices: [] }
  }
  resultado.legados_pendentes = resultado.legado.registros
  return resultado
}

module.exports = { nomesAfk, prepararColecaoAfk, auditarAfk }
