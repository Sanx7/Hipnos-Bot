const base = require('./colecao-figurinhas-fake')
module.exports = function fake() {
  const col = base()
  col.updateOne = async (f, u, opcoes) => {
    if (col.falhar) throw new Error('Mongo offline')
    let d = col.docs.find(d => d._id === f._id)
    if (d && ((f.ate && d.ate > f.ate.$lte) || (f.excecoes?.$ne && d.excecoes.includes(f.excecoes.$ne)) ||
        (f.$expr && d.excecoes.length >= f.$expr.$lt[1]))) return { modifiedCount: 0 }
    if (!d && !opcoes?.upsert) return { modifiedCount: 0 }
    if (!d) { d = { _id: f._id, ...u.$setOnInsert }; col.docs.push(d) }
    Object.assign(d, u.$set)
    if (Array.isArray(d.excecoes)) d.excecoes = [...d.excecoes]
    if (u.$push) d.excecoes.push(u.$push.excecoes)
    if (u.$pull) d.excecoes = d.excecoes.filter(t => t !== u.$pull.excecoes)
    return { modifiedCount: 1 }
  }
  return col
}
