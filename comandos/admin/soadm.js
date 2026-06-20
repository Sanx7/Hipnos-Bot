const fs = require('fs');
const path = require('path');

const BANCO_CONFIG = path.join(__dirname, '..', 'dados', 'antias.json');

function lerConfiguracoes() {
  try {
    const pastaDados = path.dirname(BANCO_CONFIG);
    if (!fs.existsSync(pastaDados)) {
      fs.mkdirSync(pastaDados, { recursive: true });
    }
    if (!fs.existsSync(BANCO_CONFIG)) {
      const padrao = { antiAudio: [], antiDocument: [], antiEvent: [], antiLink: [], antiPayment: [], antiStatus: [], onlyAdmin: [] };
      fs.writeFileSync(BANCO_CONFIG, JSON.stringify(padrao, null, 2));
      return padrao;
    }
    const dados = fs.readFileSync(BANCO_CONFIG, 'utf-8');
    const json = JSON.parse(dados);
    if (!json.onlyAdmin) json.onlyAdmin = [];
    return json;
  } catch (err) {
    console.error("Erro ao ler antias.json:", err);
    return { antiAudio: [], antiDocument: [], antiEvent: [], antiLink: [], antiPayment: [], antiStatus: [], onlyAdmin: [] };
  }
}

function salvarConfiguracoes(config) {
  try {
    fs.writeFileSync(BANCO_CONFIG, JSON.stringify(config, null, 2));
  } catch (err) {
    console.error("Erro ao salvar antias.json:", err);
  }
}

module.exports = {
  nome: "soadm", // Alterado para o novo atalho!
  async executar(sock, jid, msg, text) {
    try {
      const ehGrupo = jid.endsWith('@g.us');
      if (!ehGrupo) {
        return await sock.sendMessage(jid, { 
          text: '🌑 Hipnos não gerencia hierarquias fora de um territory coletivo. Use este comando em um grupo.' 
        }, { quoted: msg });
      }

      // Validação do Dono (O Soberano)
      const sender = msg.key.participant || msg.key.remoteJid;
      const numeroDoSender = sender.split('@')[0].split(':')[0].replace(/\D/g, '');
      const SEU_LID = '177060848861240';

      if (numeroDoSender !== SEU_LID) {
        return await sock.sendMessage(jid, { 
          text: '🌑 Hipnos ignora sua petição... você não possui a coroa para ditar quem fala com o bot.' 
        }, { quoted: msg });
      }

      const args = text.split(' ').slice(1);
      if (!args.length) {
        return await sock.sendMessage(jid, { 
          text: '❌ O ritual exige uma escolha. Digite 1 para restringir os comandos apenas a administradores ou 0 para liberar a todos.' 
        }, { quoted: msg });
      }

      const opcao = args[0].trim();
      let configs = lerConfiguracoes();

      if (opcao === '1') {
        if (configs.onlyAdmin.includes(jid)) {
          return await sock.sendMessage(jid, { 
            text: '💀 O bloqueio de plebeus já está ativo. Apenas generais comandam o bot.' 
          }, { quoted: msg });
        }
        
        configs.onlyAdmin.push(jid);
        salvarConfiguracoes(configs);
        
        return await sock.sendMessage(jid, { 
          text: '🌑⚖️ REINO PRIVILEGIADO\n\n⚙️ Hipnos silenciou os mortais comuns.\n🛡️ A partir de agora, apenas os administradores do recinto possuem autoridade para invocar meus comandos.' 
        }, { quoted: msg });
      
      } else if (opcao === '0') {
        if (!configs.onlyAdmin.includes(jid)) {
          return await sock.sendMessage(jid, { 
            text: '⚠️ O bot já responde a qualquer alma por aqui. Não há restrição ativa.' 
          }, { quoted: msg });
        }
        
        configs.onlyAdmin = configs.onlyAdmin.filter(id => id !== jid);
        salvarConfiguracoes(configs);
        
        return await sock.sendMessage(jid, { 
          text: '🌑⚙️ Portões abertos. Hipnos estende sua atenção e volta a escutar a voz de todos os membros do grupo.' 
        }, { quoted: msg });
      
      } else {
        return await sock.sendMessage(jid, { 
          text: '❌ Comando inválido... Decida-se: 1 para trancar os comandos ou 0 para liberá-los.' 
        }, { quoted: msg });
      }

    } catch (err) {
      console.error('Erro no comando soadm:', err);
    }
  }
};