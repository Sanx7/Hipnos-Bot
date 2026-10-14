const { v2: sdk } = require('cloudinary')
const axios = require('axios')
const erro = require('./ads-erro')
const prazo = require('./ads-prazo')
const TIMEOUT = 20000
const LIMITE = 8 * 1024 * 1024
const PASTA = 'hipnos/gartic'
const idSeguro = id => /^hipnos\/gartic\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(String(id || ''))

function criarCloudinary(cliente = sdk, http = axios, ambiente = process.env) {
  function configurar() {
    const cloud = String(ambiente.CLOUDINARY_CLOUD_NAME || '').trim()
    if (!/^[a-zA-Z0-9_-]+$/.test(cloud) || !ambiente.CLOUDINARY_API_KEY || !ambiente.CLOUDINARY_API_SECRET) {
      throw erro('Configure CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY e CLOUDINARY_API_SECRET no ambiente para usar o catálogo.')
    }
    // Não usa CLOUDINARY_URL nem loga o objeto de configuração.
    cliente.config({ cloud_name: cloud, api_key: ambiente.CLOUDINARY_API_KEY, api_secret: ambiente.CLOUDINARY_API_SECRET, secure: true })
    return cloud
  }
  function validarUrl(url, cloud) {
    let u
    try { u = new URL(url) } catch (_) { throw erro('Resposta de imagem inválida.') }
    if (u.protocol !== 'https:' || u.hostname !== 'res.cloudinary.com' || u.username || u.password || u.port || !u.pathname.startsWith(`/${cloud}/image/upload/`)) throw erro('URL de imagem inválida.')
    return u.href
  }
  return {
    configurar,
    async upload(buffer, publicId) {
      const cloud = configurar()
      if (!idSeguro(publicId) || !Buffer.isBuffer(buffer) || !buffer.length || buffer.length > LIMITE) throw erro('Imagem ou identificador inválido.')
      let stream
      const operacao = new Promise((resolve, reject) => {
        try {
          stream = cliente.uploader.upload_stream({ public_id: publicId, asset_folder: PASTA,
            resource_type: 'image', type: 'upload', overwrite: false, unique_filename: false,
            use_filename: false, allowed_formats: ['jpg', 'png'], timeout: TIMEOUT }, (e, r) => e ? reject(new Error('Upload falhou')) : resolve(r))
          stream.on('error', () => reject(new Error('Upload falhou')))
          stream.end(buffer)
        } catch (_) { reject(new Error('Upload falhou')) }
      })
      let resultado
      try { resultado = await prazo(operacao, TIMEOUT + 1000) }
      catch (_) { stream?.destroy?.(); throw new Error('Upload não confirmado') }
      if (resultado?.public_id !== publicId || resultado.resource_type !== 'image' || !['jpg', 'png'].includes(resultado.format) || !Number.isSafeInteger(Number(resultado.version)) || Number(resultado.version) <= 0) throw erro('Cloudinary retornou metadados inválidos.')
      return { publicId, secureUrl: validarUrl(resultado.secure_url, cloud), version: Number(resultado.version) }
    },
    async destruir(publicId, cloudEsperado) {
      const cloud = configurar()
      if (!cloudEsperado || cloudEsperado !== cloud) throw erro('A conta Cloudinary não corresponde ao cadastro. Exclusão bloqueada.')
      if (!idSeguro(publicId)) throw erro('Identificador fora da pasta do Gartic. Exclusão bloqueada.')
      const resultado = await prazo(cliente.uploader.destroy(publicId, { resource_type: 'image', type: 'upload', invalidate: true, timeout: TIMEOUT }), TIMEOUT + 1000)
      if (!['ok', 'not found'].includes(resultado?.result)) throw new Error('Exclusão não confirmada')
      return resultado.result
    },
    async baixar(doc) {
      const cloud = configurar()
      if (!idSeguro(doc?.publicId) || !Number.isSafeInteger(doc.version) || doc.version <= 0) throw erro('Imagem cadastrada inválida.')
      validarUrl(doc.secureUrl, cloud)
      const url = cliente.url(doc.publicId, { secure: true, resource_type: 'image', type: 'upload', version: doc.version,
        format: 'jpg', transformation: [{ width: 1280, height: 1280, crop: 'limit', quality: 'auto', fetch_format: 'jpg' }] })
      validarUrl(url, cloud)
      const resposta = await http.get(url, { responseType: 'arraybuffer', timeout: TIMEOUT, maxContentLength: LIMITE,
        maxBodyLength: LIMITE, maxRedirects: 0 })
      const buffer = Buffer.from(resposta.data)
      if (!buffer.length || buffer.length > LIMITE || !buffer.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) throw erro('A imagem do catálogo está indisponível ou inválida.')
      return buffer
    }
  }
}
module.exports = { criarCloudinary, idSeguro, PASTA, LIMITE, TIMEOUT }
