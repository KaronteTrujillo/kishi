// K R A M P U S:
const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    makeInMemoryStore 
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const prompt = require('prompt-sync')({ sigint: true });
const qrcode = require('qrcode-terminal'); // Para mostrar el QR en consola

// Logger silencioso para evitar logs innecesarios
const logger = pino({ level: 'silent' });

// Número registrado
let registeredNumber = null;

// Función para registrar el número por consola
function registerNumber() {
    registeredNumber = prompt('Ingresa el número de teléfono registrado (formato: +1234567890): ');
    console.log(`Número registrado: ${registeredNumber}`);
}

// Iniciar registro del número
registerNumber();

// Función principal para conectar el bot
async function connectToWhatsApp() {
    // Configurar almacenamiento de sesión
    const { state, saveCreds } = await useMultiFileAuthState('./auth_state');

    // Crear conexión con Baileys
    const sock = makeWASocket({
        auth: state,
        logger,
    });
    
    // Iniciar el store para almacenar mensajes
    const store = makeInMemoryStore({ logger });
    store.bind(sock.ev);
    
    // Mostrar el QR manualmente si se genera
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            console.log('\n📱 Escanea este código QR con WhatsApp:');
            qrcode.generate(qr, { small: true });
        }
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Conexión cerrada:', lastDisconnect?.error?.message || 'Desconexión desconocida');
            if (shouldReconnect) {
                console.log('Reconectando...');
                connectToWhatsApp();
            } else {
                console.log('Sesión cerrada. Por favor, elimina ./auth_state y reinicia.');
            }
        } else if (connection === 'open') {
            console.log('✅ Bot conectado a WhatsApp');
        }
    });

    // Guardar credenciales cuando se actualicen
    sock.ev.on('creds.update', saveCreds);

    // Manejar mensajes y reacciones
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return; // Ignorar mensajes propios

        const from = msg.key.remoteJid;
        const senderNumber = msg.key.participant || from;
        // Validar que el mensaje proviene del número registrado
        if (`+${senderNumber.split('@')[0]}` !== registeredNumber) {
            console.log('Mensaje recibido de un número no registrado:', senderNumber);
            return;
        }

        // Verificar si es una reacción
        if (msg.message.reactionMessage) {
            const reaction = msg.message.reactionMessage;
            const originalMessageId = reaction.key.id;
            const emoji = reaction.text;

            if (emoji) {
                console.log(`Reacción detectada: ${emoji} en mensaje ${originalMessageId}`);

                try {
                    // Intentar cargar el mensaje original desde el store
                    const originalMessage = store.loadMessage(from, originalMessageId);
                    
                    if (!originalMessage || !originalMessage.message) {
                        console.log('Mensaje original no encontrado en el store');
                        return;
                    }
                    
                    const messageContent = originalMessage.message;
                    let media = null;
                    let mediaType = null;

                    // Verificar si el mensaje original contiene imagen o video
                    if (messageContent.imageMessage) {
                        media = messageContent.imageMessage;
                        mediaType = 'image';
                    } else if (messageContent.videoMessage) {
                        media = messageContent.videoMessage;
                        mediaType = 'video';
                    }

                    if (media && mediaType) {
                        // Descargar el archivo multimedia
                        const mediaData = await sock.downloadMediaMessage(originalMessage);
                        console.log(`Media (${mediaType}) descargado para reenviar`);
                        
                        // Reenviar el archivo multimedia al mismo usuario
                        await sock.sendMessage(from, {
                            [mediaType]: mediaData,
                            mimetype: media.mimetype,
                            caption: media.caption || undefined,
                        });
                        console.log(`Media (${mediaType}) reenviado a ${from}`);
                    } else {
                        console.log('El mensaje original no contiene imagen ni video');
                    }
                } catch (error) {
                    console.error('Error procesando el mensaje:', error.message);
                }
            }
        }
    });
}

// Iniciar el bot
connectToWhatsApp().catch(err => {
    console.error('Error iniciando el bot:', err);
});
