const COOLDOWN_ESTUDO_MS = 60 * 60 * 1000
const ENERGIA_ESTUDO = 10
const CURSOS = Object.freeze([
  ['medicina', 'Medicina', 35, ['medico', 'pediatra']],
  ['direito', 'Direito', 25, ['advogado']],
  ['engenharia', 'Engenharia', 25, ['engenheiro']],
  ['enfermagem', 'Enfermagem', 20, ['enfermagem']],
  ['ciencia_computacao', 'Ciência da Computação', 20, ['desenvolvedor_apps']],
  ['fisica', 'Física', 20, ['fisico']],
  ['administracao', 'Administração', 20, ['marketing', 'bancario']],
  ['economia', 'Economia', 20, ['corretor_bolsa']],
  ['pedagogia', 'Pedagogia', 20, ['professor']],
  ['medicina_veterinaria', 'Medicina Veterinária', 20, ['veterinaria']]
].map(([id, nome, sessoes, carreiras]) => Object.freeze({ id, nome, sessoes, carreiras: Object.freeze(carreiras) })))
const normalizar = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
function cursoPorId(id) { return CURSOS.find(c => c.id === id) || null }
function resolverCurso(texto) { return CURSOS.find(c => normalizar(c.id) === normalizar(texto) || normalizar(c.nome) === normalizar(texto)) || null }
function cursoDaCarreira(id) { return CURSOS.find(c => c.carreiras.includes(id)) || null }
module.exports = { CURSOS, COOLDOWN_ESTUDO_MS, ENERGIA_ESTUDO, cursoPorId, resolverCurso, cursoDaCarreira }
