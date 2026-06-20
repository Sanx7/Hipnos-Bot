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
      const padrao = { antiAudio: [], antiDocument: [], antiEvent: [], antiLink: [], antiPayment: [], antiStatus: [], onlyAdmin: [], welcome: [] };
      fs.writeFileSync(BANCO_CONFIG, JSON.stringify(padrao, null, 2));
      return padrao;
    }
    const dados = fs.readFileSync(BANCO_CONFIG, 'utf-8');
    const json = JSON.parse(dados);
    if (!json.welcome) json.welcome = []; // Garante a propriedade
    return json;
  } catch (err) {
    console.error("Erro ao ler antias.json:", err);
    return { antiAudio: [], antiDocument: [], antiEvent: [], antiLink: [], antiPayment: [], antiStatus: [], onlyAdmin: [], welcome: [] };
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
  nome: "bemvindo",
  async executar(sock, jid, msg, text) {
    try {
      const ehGrupo = jid.endsWith('@g.us');
      if (!ehGrupo) {
        return await sock.sendMessage(jid, { 
          text: '🌑 Hipnos não saúda almas fora de um território coletivo. Use este comando em um grupo.' 
        }, { quoted: msg });
      }

      // Validação do Dono (O Soberano)
      const sender = msg.key.participant || msg.key.remoteJid;
      const numeroDoSender = sender.split('@')[0].split(':')[0].replace(/\D/g, '');
      const SEU_LID = '177060848861240';

      if (numeroDoSender !== SEU_LID) {
        return await sock.sendMessage(jid, { 
          text: '🌑 Hipnos ignora sua petição... você não dita as regras de recepção deste reino.' 
        }, { quoted: msg });
      }

      const args = text.split(' ').slice(1);
      if (!args.length) {
        return await sock.sendMessage(jid, { 
          text: '❌ O ritual exige uma escolha. Digite 1 para ativar as boas-vindas ou 0 para desativar.' 
        }, { quoted: msg });
      }

      const opcao = args[0].trim();
      let configs = lerConfiguracoes();

      if (opcao === '1') {
        if (configs.welcome.includes(jid)) {
          return await sock.sendMessage(jid, { 
            text: '💀 O feitiço de recepção já está ativo neste recinto.' 
          }, { quoted: msg });
        }
        
        configs.welcome.push(jid);
        salvarConfiguracoes(configs);
        
        return await sock.sendMessage(jid, { 
          text: '🌑⚖️ PORTÃO DOS SONHOS\n\n⚙️ Hipnos agora vigia as entradas do grupo. Novos mortais serão devidamente recebidos e alertados.' 
        }, { quoted: msg });
      
      } else if (opcao === '0') {
        if (!configs.welcome.includes(jid)) {
          return await sock.sendMessage(jid, { 
            text: '⚠️ As boas-vindas já estão desativadas por aqui.' 
          }, { quoted: msg });
        }
        
        configs.welcome = configs.welcome.filter(id => id !== jid);
        salvarConfiguracoes(configs);
        
        return await sock.sendMessage(jid, { 
          text: '🌑⚙️ Hipnos recolheu as saudações. Os novos membros entrarão no limbo em absoluto silêncio.' 
        }, { quoted: msg });
      
      } else {
        return await sock.sendMessage(jid, { 
          text: '❌ Comando inválido... Decida-se: 1 para ativar as boas-vindas ou 0 para desativar.' 
        }, { quoted: msg });
      }

    } catch (err) {
      console.error('Erro no comando bemvindo:', err);
    }
  }
};