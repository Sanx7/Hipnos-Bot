// Genera el avatar padrão del /perfil (JPEG 480x480) y su thumbnail 64px.
// Tema oscuro + borde púrpura (Hipnos). Salidas:
//   comandos/dados/avatar-perfil.txt  (base64 del JPEG grande)
//   comandos/dados/avatar-perfil-thumb.txt (base64 del thumbnail 64px)
const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const ffmpeg = require('@ffmpeg-installer/ffmpeg').path

const tmp = path.join(__dirname, '..', 'comandos', 'dados', 'temp')
if (!fs.existsSync(tmp)) fs.mkdirSync(tmp, { recursive: true })
const grande = path.join(tmp, 'avatar_perfil.jpg')
const thumb = path.join(tmp, 'avatar_perfil_thumb.jpg')

execSync(`"${ffmpeg}" -y -nostdin -f lavfi -i color=c=#141228:s=480x480 -vf "drawbox=x=14:y=14:w=452:h=452:color=#7b2ffb@0.85:t=10:replace=1" -frames:v 1 "${grande}"`)
execSync(`"${ffmpeg}" -y -nostdin -i "${grande}" -vf "scale=64:-1" -frames:v 1 "${thumb}"`)

fs.writeFileSync(path.join(__dirname, '..', 'comandos', 'dados', 'avatar-perfil.txt'), fs.readFileSync(grande).toString('base64'))
fs.writeFileSync(path.join(__dirname, '..', 'comandos', 'dados', 'avatar-perfil-thumb.txt'), fs.readFileSync(thumb).toString('base64'))
console.log('ok grande:', fs.statSync(grande).size, 'bytes | thumb:', fs.statSync(thumb).size, 'bytes')
try { fs.unlinkSync(grande) } catch (e) {}
try { fs.unlinkSync(thumb) } catch (e) {}