const { Writable } = require('node:stream')
function valor(doc, expr) {
  if (typeof expr === 'string' && expr.startsWith('$')) return doc[expr.slice(1)]
  if (expr?.$cond) return valor(doc, expr.$cond[0]) ? expr.$cond[1] : expr.$cond[2]
  return expr
}
function casa(doc, filtro) {
  return Object.entries(filtro).every(([k, v]) => v?.$nin ? !v.$nin.includes(doc[k]) : doc[k] === v)
}
function projetar(doc, campos) {
  if (!campos) return { ...doc }
  return Object.fromEntries(Object.keys(campos).filter(k => campos[k] && k in doc).map(k => [k, doc[k]]))
}
function criarMongo() {
  const dados = { pipelines: [], random: () => 0, falhar: null }
  function collection() {
    const docs = new Map()
    function falha(acao, doc) { dados.falhar?.(acao, doc) }
    function pipeline(lista, etapas) {
      let saida = lista.map(d => ({ ...d }))
      for (const e of etapas) {
        if (e.$match) saida = saida.filter(d => casa(d, e.$match))
        if (e.$group) {
          const grupos = new Map()
          for (const d of saida) {
            const id = valor(d, e.$group._id)
            if (!grupos.has(id)) grupos.set(id, { _id: id })
            const g = grupos.get(id)
            for (const [k, op] of Object.entries(e.$group)) {
              if (k === '_id') continue
              if ('$sum' in op) g[k] = (g[k] || 0) + valor(d, op.$sum)
              if ('$first' in op && !(k in g)) g[k] = valor(d, op.$first)
            }
          }
          saida = [...grupos.values()]
        }
        if (e.$sample) saida = saida.length ? [saida[Math.floor(dados.random() * saida.length)]] : []
        if (e.$sort) { const key = Object.keys(e.$sort)[0]; saida.sort((a, b) => String(a[key]).localeCompare(String(b[key]))) }
        if (e.$skip) saida = saida.slice(e.$skip)
        if (e.$limit) saida = saida.slice(0, e.$limit)
        if (e.$project) saida = saida.map(d => projetar(d, e.$project))
        if (e.$facet) saida = [Object.fromEntries(Object.entries(e.$facet).map(([k, etapas]) => [k, pipeline(saida, etapas)]))]
      }
      return saida
    }
    return { docs,
      async insertOne(doc) {
        falha('insert', doc)
        if (docs.has(doc._id)) throw Object.assign(new Error('duplicado'), { code: 11000 })
        docs.set(doc._id, { ...doc }); return { acknowledged: true, insertedId: doc._id }
      },
      async findOne(filtro) { falha('read'); return [...docs.values()].find(d => casa(d, filtro)) || null },
      async updateOne(filtro, mudanca) {
        falha('update', mudanca.$set)
        const d = [...docs.values()].find(d => casa(d, filtro))
        if (d) Object.assign(d, mudanca.$set)
        return { acknowledged: true, matchedCount: d ? 1 : 0 }
      },
      async updateMany(filtro, mudanca) {
        falha('updateMany', mudanca.$set);let n=0
        for (const d of docs.values()) if (casa(d, filtro)) { Object.assign(d, mudanca.$set); n++ }
        return { acknowledged: true, matchedCount: n }
      },
      async deleteOne(filtro) {
        falha('delete', filtro);const d=[...docs.values()].find(d=>casa(d,filtro))
        if(d)docs.delete(d._id);return {acknowledged:true,deletedCount:d?1:0}
      },
      aggregate(etapas, opcoes) {
        dados.pipelines.push({ etapas, opcoes });falha('aggregate')
        return {async toArray(){return pipeline([...docs.values()],etapas)}}
      },
      find(filtro, opcoes) {
        let lista=[...docs.values()].filter(d=>casa(d,filtro)).map(d=>projetar(d,opcoes?.projection))
        return {sort(){lista.sort((a,b)=>a._id.localeCompare(b._id));return this},batchSize(){return this},async close(){},
          async *[Symbol.asyncIterator](){for(const d of lista)yield {...d}}}
      }
    }
  }
  dados.imagens=collection();dados.controles=collection()
  return dados
}
function criarSdk(buffer) {
  const f={uploads:[],destroy:[],requests:[],configs:[],falharUpload:false,falharDelete:false}
  f.sdk={config:o=>f.configs.push(o),url:(id,o)=>{f.urlOptions=o;return `https://res.cloudinary.com/teste/image/upload/v${o.version}/${id}.jpg`},
    uploader:{
      upload_stream(o,callback){f.uploads.push(o);return new Writable({write(c,e,done){done()},final(done){
        if(f.falharUpload)callback(new Error('segredo ficticio deve ficar oculto'))
        else callback(null,{public_id:o.public_id,secure_url:`https://res.cloudinary.com/teste/image/upload/v1/${o.public_id}.jpg`,version:1,resource_type:'image',format:'jpg'})
        done()
      }})},
      async destroy(id,o){f.destroy.push({id,o});if(f.falharDelete)throw new Error('falha externa');return {result:'ok'}}
    }}
  f.http={async get(url,o){f.requests.push({url,o});if(f.falharDownload)throw new Error('rede');return {data:f.buffer||buffer}}}
  f.ambiente={CLOUDINARY_CLOUD_NAME:'teste',CLOUDINARY_API_KEY:'key-fake',CLOUDINARY_API_SECRET:'secret-fake'}
  return f
}
module.exports={criarMongo,criarSdk}
