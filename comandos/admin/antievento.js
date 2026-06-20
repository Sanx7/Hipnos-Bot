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
      const padrao = { antiAudio: [], antiDocument: [], antiEvent: [] };
      fs.writeFileSync(BANCO_CONFIG, JSON.stringify(padrao, null, 2));
      return padrao;
    }
    const dados = fs.readFileSync(BANCO_CONFIG, 'utf-8');
    const json = JSON.parse(dados);
    if (!json.antiEvent) json.antiEvent = []; // Garante a propriedade
    return json;
  } catch (err) {
    console.error("Erro ao ler antias.json:", err);
    return { antiAudio: [], antiDocument: [], antiEvent: [] };
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
  nome: "antievento",
  async executar(sock, jid, msg, text) {
    try {
      const ehGrupo = jid.endsWith('@g.us');
      if (!ehGrupo) {
        return await sock.sendMessage(jid, { 
          text: '🌑 Hipnos não desperdiça feitiços fora de um território coletivo. Use este comando em um grupo.' 
        }, { quoted: msg });
      }

      // Validação do Dono (O Soberano)
      const sender = msg.key.participant || msg.key.remoteJid;
      const numeroDoSender = sender.split('@')[0].split(':')[0].replace(/\D/g, '');
      const SEU_LID = '177060848861240';

      if (numeroDoSender !== SEU_LID) {
        return await sock.sendMessage(jid, { 
          text: '🌑 Hipnos recusa sua invocação... você não possui domínio sobre as linhas do tempo deste reino.' 
        }, { quoted: msg });
      }

      const args = text.split(' ').slice(1);
      if (!args.length) {
        return await sock.sendMessage(jid, { 
          text: '❌ O ritual exige uma escolha. Digite 1 para barrar a criação de eventos ou 0 para permiti-los.' 
        }, { quoted: msg });
      }

      const opcao = args[0].trim();
      let configs = lerConfiguracoes();

      if (opcao === '1') {
        if (configs.antiEvent.includes(jid)) {
          return await sock.sendMessage(jid, { 
            text: '💀 O bloqueio cronológico já está ativo. Nenhum evento ou celebração será marcado.' 
          }, { quoted: msg });
        }
        
        configs.antiEvent.push(jid);
        salvarConfiguracoes(configs);
        
        return await sock.sendMessage(jid, { 
          text: '🌑⚖️ ESTAGNAGEM DO TEMPO\n\n⚙️ Hipnos baniu a criação de eventos.\n📅 Qualquer tentativa de agendar ou criar eventos por meros mortais será deletada no esquecimento.' 
        }, { quoted: msg });
      
      } else if (opcao === '0') {
        if (!configs.antiEvent.includes(jid)) {
          return await sock.sendMessage(jid, { 
            text: '⚠️ O tempo flui normalmente aqui. Não há travas de eventos ativas.' 
          }, { quoted: msg });
        }
        
        configs.antiEvent = configs.antiEvent.filter(id => id !== jid);
        salvarConfiguracoes(configs);
        
        return await sock.sendMessage(jid, { 
          text: '🌑⚙️ O selo cronológico foi quebrado. Hipnos permite que o calendário volte a andar.' 
        }, { quoted: msg });
      
      } else {
        return await sock.sendMessage(jid, { 
          text: '❌ Comando inválido... Decida-se: 1 para congelar os eventos ou 0 para liberá-los.' 
        }, { quoted: msg });
      }

    } catch (err) {
      console.error('Erro no comando antievento:', err);
    }
  }
};