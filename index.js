
// =====================================
// RR SERVICE BOT - VERSÃO 4.5 ESTÁVEL
// =====================================

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys')

const fs = require('fs')
const path = require('path')
const pino = require('pino')
const qrcode = require('qrcode-terminal')
const PDFDocument = require('pdfkit')

// ================= CONFIG =================

const logoPath = './rrservice.png'

const ARQ_OS = './ordens_servico.json'
const ARQ_CONTADOR = './contador_os.json'

const ARQ_AG = './agendamentos.json'
const ARQ_CONTADOR_AG = './contador_agendamento.json'

const TIMEOUT_MS = 5 * 60 * 1000

const ADMIN_NUMEROS = ['275930274607319']

const STATUS_PADRAO = [
  'Aguardando Avaliação',
  'Em Análise',
  'Aprovado',
  'Em Reparo',
  'Finalizado',
  'Pronto para Retirada',
  'Entregue'
]

// ================= ESTADO =================

const estado = {}
const temp = {}
const timeouts = {}

function resetar(id) {

  delete estado[id]
  delete temp[id]

  if (timeouts[id]) clearTimeout(timeouts[id])

  delete timeouts[id]
}

function iniciarTimeout(id) {

  if (timeouts[id]) clearTimeout(timeouts[id])

  timeouts[id] = setTimeout(() => {

    resetar(id)

  }, TIMEOUT_MS)
}

// ================= UTIL =================

function lerJSONSeguro(arquivo, padrao) {

  try {

    if (!fs.existsSync(arquivo)) return padrao

    return JSON.parse(fs.readFileSync(arquivo))

  } catch {

    return padrao

  }
}

function salvarJSONSeguro(arquivo, dados) {

  fs.writeFileSync(arquivo, JSON.stringify(dados, null, 2))

}

function getTexto(msg) {

  return (
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    msg.message?.imageMessage?.caption ||
    ''
  ).trim()

}

function getId(msg) {

  return (msg.key.participant || msg.key.remoteJid).split('@')[0]

}

// ================= EXTRAIR COMANDOS =================

function extrairNumeroOS(texto) {

  const match = texto.match(/os\s?(\d+)/i)

  return match ? match[1] : null

}

function extrairNumeroAg(texto) {

  const match = texto.match(/ag\s?(\d+)/i)

  return match ? 'AG' + match[1] : null

}

function extrairComandoStatus(texto) {

  const match = texto.match(/^status\s+os\s?(\d+)\s+(\d+)/i)

  if (!match) return null

  return {
    numeroOS: match[1],
    indiceStatus: parseInt(match[2])
  }

}

// ================= SAUDAÇÃO =================

function detectarSaudacao(texto) {

  const msg = texto.toLowerCase().trim()

  const saudacoes = [
    'oi',
    'ola',
    'olá',
    'bom dia',
    'boa tarde',
    'boa noite',
    'iniciar',
    'começar',
    'comecar'
  ]

  return saudacoes.includes(msg)
}

// ================= DIGITAÇÃO =================

async function responder(sock, jid, mensagem) {

  let texto = typeof mensagem === 'string'
    ? mensagem
    : mensagem.text || ''

  const tempo = Math.min(Math.max(texto.length * 20, 600), 3000)

  await sock.sendPresenceUpdate('composing', jid)
  await new Promise(r => setTimeout(r, tempo))
  await sock.sendPresenceUpdate('paused', jid)

  if (typeof mensagem === 'string') {

    return sock.sendMessage(jid, { text: mensagem })

  }

  return sock.sendMessage(jid, mensagem)

}

// ================= BASE OS =================

let listaOS = lerJSONSeguro(ARQ_OS, [])
let contadorOS = lerJSONSeguro(ARQ_CONTADOR, { ultimo: 999 })

function gerarNumeroOS() {

  contadorOS.ultimo++

  salvarJSONSeguro(ARQ_CONTADOR, contadorOS)

  return contadorOS.ultimo
}

function salvarOS(os) {

  listaOS.push(os)

  salvarJSONSeguro(ARQ_OS, listaOS)
}

function buscarOS(numero) {

  return listaOS.find(o => String(o.id_os) === String(numero))

}

function atualizarStatusOS(numero, indiceStatus) {

  const os = buscarOS(numero)

  if (!os) return null

  const novoStatus = STATUS_PADRAO[indiceStatus]

  if (!novoStatus) return 'STATUS_INVALIDO'

  os.status = novoStatus

  os.historico.push({
    data: new Date().toLocaleString('pt-BR'),
    status: novoStatus
  })

  salvarJSONSeguro(ARQ_OS, listaOS)

  return os
}

// ================= BASE AG =================

let listaAG = lerJSONSeguro(ARQ_AG, [])
let contadorAG = lerJSONSeguro(ARQ_CONTADOR_AG, { ultimo: 999 })

function gerarNumeroAG() {

  contadorAG.ultimo++

  salvarJSONSeguro(ARQ_CONTADOR_AG, contadorAG)

  return 'AG' + contadorAG.ultimo
}

function salvarAG(ag) {

  listaAG.push(ag)

  salvarJSONSeguro(ARQ_AG, listaAG)

}

function buscarAG(protocolo) {

  return listaAG.find(a => a.id_agendamento === protocolo)

}

// ================= MENU =================

function menuPrincipal() {

return `
📋 *RR SERVICE ASSISTÊNCIA TÉCNICA*

1️⃣ Ordem de Serviço
2️⃣ Agendamento
3️⃣ Sobre Nós
4️⃣ Atendimento
5️⃣ Sair

Digite 0 para cancelar.
`

}

// ================= PDF =================

async function gerarPDF(os) {

  return new Promise((resolve, reject) => {

    const pasta = path.join(__dirname, 'pdfs')

    if (!fs.existsSync(pasta)) {

      fs.mkdirSync(pasta)

    }

    const caminho = path.join(pasta, `OS_${os.id_os}.pdf`)

    const doc = new PDFDocument({ margin: 50 })

    const stream = fs.createWriteStream(caminho)

    doc.pipe(stream)

    if (fs.existsSync(logoPath)) {

      doc.image(logoPath, 50, 40, { width: 100 })

    }

    doc.fontSize(20).text('RR SERVICE', 160, 50)
    doc.fontSize(12).text('Assistência Técnica Especializada', 160, 75)
    doc.text(`Ordem de Serviço Nº: ${os.id_os}`, 160, 95)

    doc.moveDown(4)

    doc.fontSize(14).text('DADOS DO CLIENTE', { underline: true })

    doc.moveDown()

    doc.fontSize(12)
      .text(`Nome: ${os.nome}`)
      .text(`Telefone: ${os.telefone}`)
      .text(`Endereço: ${os.endereco}`)

    doc.moveDown(2)

    doc.fontSize(14).text('DADOS DO EQUIPAMENTO', { underline: true })

    doc.moveDown()

    doc.fontSize(12).text(`Equipamento: ${os.equipamento}`)

    doc.moveDown(2)

    doc.fontSize(14).text('RELATO DO CLIENTE', { underline: true })

    doc.moveDown()

    doc.text(os.defeito)

    doc.moveDown(2)

    doc.fontSize(14).text('STATUS ATUAL', { underline: true })

    doc.moveDown()

    doc.text(`Status: ${os.status}`)
    doc.text(`Data: ${os.data}`)

    doc.end()

    stream.on('finish', () => resolve(caminho))

    stream.on('error', reject)

  })
}

// ================= FLUXOS =================

const fluxos = {

principal: async (sock, jid, id, texto) => {

if (texto === '1') {

estado[id].menu = 'os_nome'
temp[id] = {}

return responder(sock, jid, '📝 Informe seu nome completo:')

}

if (texto === '2') {

estado[id].menu = 'ag_nome'
temp[id] = {}

return responder(sock, jid, '📅 Informe seu nome:')

}

if (texto === '3') {

return responder(sock, jid,
'🏢 RR SERVICE\nAssistência Técnica Especializada.\n📱 (11) 98845-2285\nSite: www.rrservice.tec.br'
)

}

if (texto === '4') {

return responder(sock, jid,
'👨‍💼 Atendimento Humano:\nhttps://wa.me/5511988452285'
)

}

if (texto === '5') {

resetar(id)

return responder(sock, jid,
'👋 Atendimento encerrado.\nDigite *menu* para voltar.'
)

}

},

// ===== AGENDAMENTO =====

ag_nome: async (sock, jid, id, texto) => {

temp[id].nome = texto

estado[id].menu = 'ag_tel'

return responder(sock, jid, '📱 Informe o telefone:')

},

ag_tel: async (sock, jid, id, texto) => {

temp[id].telefone = texto

estado[id].menu = 'ag_data'

return responder(sock, jid, '📅 Informe a data:')

},

ag_data: async (sock, jid, id, texto) => {

temp[id].data = texto

estado[id].menu = 'ag_hora'

return responder(sock, jid, '⏰ Informe o horário:')

},

ag_hora: async (sock, jid, id, texto) => {

temp[id].hora = texto

estado[id].menu = 'ag_endereco'

return responder(sock, jid, '📍 Informe seu endereço completo:')

},

ag_endereco: async (sock, jid, id, texto) => {

const novoAG = {

id_agendamento: gerarNumeroAG(),
nome: temp[id].nome,
telefone: temp[id].telefone,
data: temp[id].data,
hora: temp[id].hora,
endereco: texto,
status: 'Agendado'

}

salvarAG(novoAG)

resetar(id)

return responder(sock, jid,
`✅ Agendamento criado!

Protocolo: ${novoAG.id_agendamento}

${menuPrincipal()}`
)

},

// ===== ORDEM SERVIÇO =====

os_nome: async (sock, jid, id, texto) => {

temp[id].nome = texto

estado[id].menu = 'os_tel'

return responder(sock, jid, '📱 Telefone:')

},

os_tel: async (sock, jid, id, texto) => {

temp[id].telefone = texto

estado[id].menu = 'os_end'

return responder(sock, jid, '📍 Endereço:')

},

os_end: async (sock, jid, id, texto) => {

temp[id].endereco = texto

estado[id].menu = 'os_eq'

return responder(sock, jid, '🔧 Equipamento:')

},

os_eq: async (sock, jid, id, texto) => {

temp[id].equipamento = texto

estado[id].menu = 'os_def'

return responder(sock, jid, '🛠️ Defeito:')

},

os_def: async (sock, jid, id, texto) => {

temp[id].defeito = texto

const novaOS = {

id_os: gerarNumeroOS(),
data: new Date().toLocaleString('pt-BR'),
...temp[id],
status: STATUS_PADRAO[0],
historico: [
{
data: new Date().toLocaleString('pt-BR'),
status: STATUS_PADRAO[0]
}
]

}

salvarOS(novaOS)

const caminhoPDF = await gerarPDF(novaOS)

await sock.sendMessage(jid, {

document: fs.readFileSync(caminhoPDF),
fileName: `OS_${novaOS.id_os}.pdf`,
mimetype: 'application/pdf'

})

resetar(id)

return responder(sock, jid,
'✅ Ordem criada com sucesso!\n\n' + menuPrincipal()
)

}

}

// ================= BOT =================

async function iniciarBot() {

const { state, saveCreds } = await useMultiFileAuthState('./auth')

const { version } = await fetchLatestBaileysVersion()

const sock = makeWASocket({

version,
auth: state,
logger: pino({ level: 'silent' }),
browser: ['RR SERVICE BOT', 'Chrome', '1.0']

})

sock.ev.on('creds.update', saveCreds)

sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {

if (qr) {

console.clear()

console.log('📲 Escaneie o QR Code:\n')

qrcode.generate(qr, { small: true })

}

if (connection === 'close') {

const shouldReconnect =
lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut

console.log('❌ Conexão fechada')

if (shouldReconnect) {

console.log('🔄 Reconectando...')

iniciarBot()

}

}

if (connection === 'open') {

console.log('✅ BOT CONECTADO')

}

})

// ================= MENSAGENS =================

sock.ev.on('messages.upsert', async ({ messages }) => {

const msg = messages[0]

if (!msg?.message || msg.key.fromMe) return

const jid = msg.key.remoteJid
const id = getId(msg)
const texto = getTexto(msg)

if (!texto) return

// ===== CONSULTA OS =====

const numeroOS = extrairNumeroOS(texto)

if (numeroOS) {

const os = buscarOS(numeroOS)

if (!os) return responder(sock, jid, '❌ OS não encontrada')

const caminhoPDF = await gerarPDF(os)

await sock.sendMessage(jid, {

document: fs.readFileSync(caminhoPDF),
fileName: `OS_${os.id_os}.pdf`,
mimetype: 'application/pdf'

})

return responder(sock, jid,
`📋 OS ${os.id_os}

Cliente: ${os.nome}
Equipamento: ${os.equipamento}
Status: ${os.status}`
)

}

// ===== MENU =====

if (texto.toLowerCase() === 'menu' || detectarSaudacao(texto)) {

estado[id] = { menu: 'principal' }

return responder(sock, jid, menuPrincipal())

}

if (!estado[id]) {

estado[id] = { menu: 'principal' }

return responder(sock, jid, menuPrincipal())

}

const fluxoAtual = estado[id].menu

if (!fluxos[fluxoAtual]) {

estado[id] = { menu: 'principal' }

return responder(sock, jid, menuPrincipal())

}

await fluxos[fluxoAtual](sock, jid, id, texto)

})

}

iniciarBot()
