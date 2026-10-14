// Ponto de entrada conservado, agora SOMENTE diagnóstico.
require('../config')
const rpg = require('../rpg/database')
const conexao = require('../rpg/conexao-mongo')
async function main() {
  try {
    const r = await rpg.corrigirJogadoresComLid()
    console.log('RPG: diagnóstico somente leitura; reconciliação bloqueada.')
    console.log('Total de documentos:', r.total)
    console.log('Registros LID legados para revisão:', r.naoResolviveis)
    console.log('Nenhum jogador foi alterado ou mesclado.')
  } catch {
    console.error('RPG: diagnóstico indisponível; nenhum dado alterado.')
    process.exitCode = 1
  } finally { await conexao.fecharConexaoRpg() }
}
main()
