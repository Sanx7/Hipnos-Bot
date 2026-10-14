// O antigo smoke gravava saldos e apagava uma coleção real. Bloqueado nesta
// fase; integração futura exige ambiente separado aprovado.
console.error('Smoke MongoDB real bloqueado. Execute scripts/teste-rpg-seguranca.js e scripts/teste-rpg-conexao.js para validação offline.')
process.exitCode = 1
