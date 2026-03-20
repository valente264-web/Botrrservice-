// =====================================
// RR SERVICE BOT - VERSÃO 5.0 RENDER FIX
// =====================================

const fs = require('fs')
const path = require('path')
const express = require('express')

// ================= SERVIDOR (RENDER PRIMEIRO) =================

const app = express()

app.get('/', (req, res) => {
  res.send('✅ RR SERVICE BOT ONLINE')
})

const PORT = process.env.PORT || 3000

app.listen(PORT, () => {
  console.log('🌐 Servidor rodando na porta ' + PORT)
})

// ================= DEPENDÊNCIAS BOT =================

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys')

const pino = require('pino')
const qrcode = require('qrcode-terminal')
const PDFDocument = require('pdfkit')

// ================= GARANTIR PASTA AUTH =================

if (!fs.existsSync('./auth')) {
  fs.mkdirSync('./auth')
}

// ================= CONFIG =================

const logoPath = './rrservice.png'

const ARQ_OS = './ordens_servico.json'
const ARQ_CONTADOR = './contador_os.json'

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

// ================= PDF =================

async function gerarPDF(os) {
  return new Promise((resolve, reject) => {

    const pasta = path.join(__dirname, 'pdfs')
    if (!fs.existsSync(pasta)) fs.mkdirSync(pasta)

    const caminho = path.join(pasta, `OS_${os.id_os}.pdf`)

    const doc = new PDFDocument({ margin: 50 })
    const stream = fs.createWriteStream(caminho)

    doc.pipe(stream)

    if (fs.existsSync(logoPath)) {
      doc.image(logoPath, 50, 40, { width: 100 })
    }

    doc.fontSize(20).text('RR SERVICE', 160, 50)
    doc.moveDown(4)

    doc.fontSize(12)
      .text(`Cliente: ${os.nome}`)
      .text(`Telefone: ${os.telefone}`)
      .text(`Equipamento: ${os.equipamento}`)
      .text(`Defeito: ${os.defeito}`)
      .text(`Status: ${os.status}`)

    doc.end()

    stream.on('finish', () => resolve(caminho))
    stream.on('error', reject)
  })
}

// ================= BOT =================

async function iniciarBot() {

  try {

    const { state, saveCreds } = await useMultiFileAuthState('./auth')
    const { version } = await fetchLatestBaileysVersion()

    const sock = makeWASocket({
      version,
      auth: state,
      logger: pino({ level: 'silent' })
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

    sock.ev.on('messages.upsert', async ({ messages }) => {

      try {

        const msg = messages[0]
        if (!msg?.message || msg.key.fromMe) return

        const jid = msg.key.remoteJid
        const texto = getTexto(msg)
        if (!texto) return

        if (texto.toLowerCase() === 'menu') {
          return sock.sendMessage(jid, {
            text: '📋 MENU\n1 - Criar OS\nDigite: os 123 para consultar'
          })
        }

        if (texto === '1') {

          const novaOS = {
            id_os: gerarNumeroOS(),
            nome: 'Cliente WhatsApp',
            telefone: jid,
            equipamento: 'Não informado',
            defeito: 'Não informado',
            status: 'Aguardando'
          }

          salvarOS(novaOS)

          const caminhoPDF = await gerarPDF(novaOS)

          await sock.sendMessage(jid, {
            document: fs.readFileSync(caminhoPDF),
            fileName: `OS_${novaOS.id_os}.pdf`,
            mimetype: 'application/pdf'
          })

          return sock.sendMessage(jid, {
            text: `✅ OS criada Nº ${novaOS.id_os}`
          })
        }

        const match = texto.match(/os\s?(\d+)/i)

        if (match) {
          const os = buscarOS(match[1])

          if (!os) {
            return sock.sendMessage(jid, { text: '❌ OS não encontrada' })
          }

          return sock.sendMessage(jid, {
            text: `📋 OS ${os.id_os}\nStatus: ${os.status}`
          })
        }

      } catch (err) {
        console.log('❌ ERRO MSG:', err)
      }

    })

  } catch (err) {
    console.log('❌ ERRO GERAL:', err)
    setTimeout(iniciarBot, 5000)
  }

}

iniciarBot()
