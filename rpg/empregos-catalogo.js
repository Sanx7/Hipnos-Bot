// Catálogo oficial: IDs são permanentes; nomes e sequências são do usuário.
// Remunerações são propostas fictícias por jornada (não salários reais).
const NIVEIS_CARREIRA = Object.freeze({ INICIAL: 1, INTERMEDIARIA: 2, AVANCADA: 3 })
const XP_POR_NIVEL_PROFISSIONAL = 100
const XP_MINIMO_POR_NIVEL_CARREIRA = Object.freeze({ 1: 0, 2: 500, 3: 1500 })
const XP_PROMOCAO_POR_CARGO = Object.freeze([0, 100, 300])
const XP_POR_JORNADA = 25
const ENERGIA_POR_JORNADA = 10
const COOLDOWN_JORNADA_MS = 60 * 60 * 1000
const RECUPERACAO_ENERGIA_MS = 6 * 60 * 1000 // 1 ponto por 6 minutos.
const LINHAS = [
  ['entregador', 1, ['Entregador'], [120]],
  ['revendedor_jaboticario', 1, ['Revendedor da Jaboticário'], [110]],
  ['revendedor_je_kiti_ke', 1, ['Revendedor da Je-Kiti-Ke'], [110]],
  ['uber', 1, ['Uber', 'Motorista de Fuga'], [140, 220]],
  ['repositor_acai', 1, ['Repositor do Açaí', 'Gerente de Reposição'], [110, 190]],
  ['telemarketing', 1, ['Telemarketing', 'Gerente de Telemarketing'], [100, 180]],
  ['gari', 1, ['Gari', 'Lixeiro Chefe', 'Piloto de Caminhão do Lixo'], [120, 180, 260]],
  ['pedreiro', 1, ['Ajudante de Pedreiro', 'Pedreiro', 'Mestre de Obra'], [100, 170, 260]],
  ['jardineiro', 1, ['Jardineiro', 'Jardineiro Chefe', 'Escultor de Jardins'], [100, 170, 250]],
  ['cozinha', 1, ['Aprendiz de Cozinha', 'Cozinheiro', 'Chefe de Cozinha'], [100, 170, 260]],
  ['confeiteiro', 1, ['Confeiteiro Aprendiz', 'Confeiteiro', 'Mestre Confeiteiro'], [100, 170, 260]],
  ['faxineiro', 1, ['Faxineiro'], [100]],
  ['passeador_caes', 1, ['Passeador de Cães'], [50]],
  ['eletricista', 2, ['Eletricista Júnior', 'Eletricista Chefe', 'Mestre Eletricista'], [240, 360, 500]],
  ['recepcionista', 2, ['Recepcionista', 'Secretária', 'Secretária Chefe'], [220, 320, 450]],
  ['encanador', 2, ['Encanador', 'Mestre dos Canos'], [240, 400]],
  ['mecanico', 2, ['Mecânico', 'Mecânico Chefe'], [260, 440]],
  ['vidraceiro', 2, ['Vidraceiro', 'Mestre dos Vidros'], [240, 400]],
  ['porteiro', 2, ['Porteiro', 'Zelador', 'Síndico'], [220, 330, 480]],
  ['enfermagem', 2, ['Técnico de Enfermagem', 'Enfermeiro', 'Chefe de Enfermagem'], [250, 400, 550]],
  ['dev', 2, ['Dev Júnior', 'Dev', 'Dev Pro'], [280, 420, 600]],
  ['cabeleireiro', 2, ['Aprendiz de Cabeleireiro', 'Cabeleireiro', 'Mestre Cabeleireiro'], [220, 340, 480]],
  ['engenheiro', 3, ['Engenheiro Júnior', 'Engenheiro', 'Engenheiro Chefe'], [800, 1100, 1500]],
  ['desenvolvedor_apps', 3, ['Desenvolvedor de Apps'], [1000]],
  ['medico', 3, ['Médico', 'Cirurgião', 'Chefe de Cirurgia'], [1000, 1400, 1800]],
  ['advogado', 3, ['Advogado', 'Juiz', 'Mestre'], [850, 1200, 1600]],
  ['fisico', 3, ['Físico', 'Astrofísico'], [850, 1250]],
  ['marketing', 3, ['Marketing', 'Chefe de Marketing'], [800, 1200]],
  ['bancario', 3, ['Bancário'], [850]],
  ['corretor_bolsa', 3, ['Corretor da Bolsa de Valores'], [1000]],
  ['pediatra', 3, ['Pediatra', 'Chefe da Pediatria'], [950, 1350]],
  ['veterinaria', 3, ['Veterinária', 'Veterinária Chefe'], [900, 1300]],
  ['professor', 3, ['Professor', 'Subdiretor', 'Diretor'], [800, 1100, 1500]],
  ['jogador', 3, ['Jogador de Base', 'Jogador Profissional', 'Ídolo do Clube'], [800, 1200, 1800]]
]
const CARREIRAS = Object.freeze(LINHAS.map(([id, nivelCarreira, nomes, salarios], i) =>
  Object.freeze({ id, ordem: i + 1, nivelCarreira,
    xpTotalMinimo: XP_MINIMO_POR_NIVEL_CARREIRA[nivelCarreira],
    cargos: Object.freeze(nomes.map((nome, j) => Object.freeze({
      numero: j + 1, nome, salario: salarios[j], xpMinimo: XP_PROMOCAO_POR_CARGO[j],
      exigeFaculdade: (nivelCarreira === 3 && id !== 'jogador') || (id === 'enfermagem' && j > 0)
    }))) })))
function carreiraPorId(id) { return CARREIRAS.find(c => c.id === id) || null }
function nivelProfissional(xpTotal) { return 1 + Math.floor(xpTotal / XP_POR_NIVEL_PROFISSIONAL) }
module.exports = { CARREIRAS, NIVEIS_CARREIRA, XP_POR_NIVEL_PROFISSIONAL,
  XP_MINIMO_POR_NIVEL_CARREIRA, XP_PROMOCAO_POR_CARGO, XP_POR_JORNADA,
  ENERGIA_POR_JORNADA, COOLDOWN_JORNADA_MS, RECUPERACAO_ENERGIA_MS,
  carreiraPorId, nivelProfissional }
