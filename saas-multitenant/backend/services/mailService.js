// services/mailService.js
// Envio de e-mail genérico (multi-tenant). Configuração via variáveis de ambiente.
// Seguro para produção: se o SMTP não estiver configurado, NÃO derruba o servidor —
// quem chama deve checar isMailConfigured() e retornar erro controlado (503).

// Considera configurado apenas com o mínimo necessário.
const isMailConfigured = () =>
  !!(process.env.SMTP_HOST && process.env.SMTP_PORT && process.env.SMTP_USER && process.env.SMTP_PASS);

let _transporter = null;

const getTransporter = () => {
  if (_transporter) return _transporter;
  // require lazy: evita quebrar o boot caso a dependência não esteja instalada.
  const nodemailer = require('nodemailer');
  _transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT, 10) || 587,
    secure: String(process.env.SMTP_SECURE).toLowerCase() === 'true', // true = 465, false = 587/STARTTLS
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
  return _transporter;
};

/**
 * Envia um e-mail. Lança erro se o SMTP não estiver configurado.
 * @param {{to:string, subject:string, text?:string, html?:string, attachments?:Array}} opts
 */
const sendMail = async ({ to, subject, text, html, attachments }) => {
  if (!isMailConfigured()) {
    const err = new Error('envio de e-mail não configurado');
    err.code = 'MAIL_NOT_CONFIGURED';
    throw err;
  }
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  const transporter = getTransporter();
  return transporter.sendMail({ from, to, subject, text, html, attachments });
};

module.exports = { sendMail, isMailConfigured };
