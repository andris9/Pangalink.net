'use strict';

const config = require('config');
const ejs = require('ejs');
const nodemailer = require('nodemailer');
const transport = nodemailer.createTransport(config.mail.smtp, config.mail.defaults);
const fs = require('fs');
const log = require('npmlog');
const util = require('util');
const template = fs.readFileSync(__dirname + '/../www/views/mail/template.ejs', 'utf-8');

module.exports.sendRegistration = sendRegistration;
module.exports.sendResetLink = sendResetLink;
module.exports.sendPassword = sendPassword;

transport.on('log', data => {
    log.verbose('SMTP', data.message);
});

function sendRegistration(user) {
    let title = config.title || (config.hostname || 'localhost').replace(/:\d+$/, '').toLowerCase().replace(/^./, s => s.toUpperCase());
    let hostname = (config.hostname || 'localhost').replace(/:(80|443)$/, '');

    let html = ejs.render(template, {
        action: false,
        sender: title,
        title,
        message: `${user.name}, sinu ${title} konto on valmis!
Sinu kasutajanimi: ${user.username}<br/>Sinu parool: registreerimisel kasutatud parool`,
        footer: `Said selle e-kirja, kuna keegi kasutas sinu aadressi konto loomiseks saidil <a href="${config.proto || 'http'}://${hostname}/">${hostname}</a>`
    });

    let mailOptions = {
        to: {
            name: user.name,
            address: user.username
        },
        subject: util.format('%s: Tere tulemast, %s!', title, user.name),
        html
    };

    transport.sendMail(mailOptions, err => {
        if (err) {
            log.error('SMTP', 'Failed sending registration mail to %s, %s', user.username, err.message);
        } else {
            log.info('SMTP', 'Successfully sent registration mail to %s', user.username);
        }
    });
}

function sendResetLink(user, resetToken) {
    let title = config.title || (config.hostname || 'localhost').replace(/:\d+$/, '').toLowerCase().replace(/^./, s => s.toUpperCase());
    let hostname = (config.hostname || 'localhost').replace(/:(80|443)$/, '');

    let html = ejs.render(template, {
        sender: title,
        title,
        message: `${user.name}, uue parooli genereerimiseks ja vana tühistamiseks kliki alloleval nupul`,
        action: {
            link: `${config.proto || 'http'}://${hostname}/account/reset-password?username=${encodeURIComponent(user.username)}&resetToken=${resetToken}`,
            title: 'Lähtesta Parool'
        },
        footer: `Said selle e-kirja, kuna keegi üritas lähtestada sinu konto parooli saidil <a href="${config.proto || 'http'}://${hostname}/">${hostname}</a>`
    });

    let mailOptions = {
        to: {
            name: user.name,
            address: user.username
        },
        subject: util.format('%s: Parooli lähtestamine kasutajale %s', title, user.name),
        html
    };

    transport.sendMail(mailOptions, err => {
        if (err) {
            log.error('SMTP', 'Failed sending password reset mail to %s, %s', user.username, err.message);
        } else {
            log.info('SMTP', 'Successfully sent password reset mail to %s', user.username);
        }
    });
}

function sendPassword(user, password) {
    let title = config.title || (config.hostname || 'localhost').replace(/:\d+$/, '').toLowerCase().replace(/^./, s => s.toUpperCase());
    let hostname = (config.hostname || 'localhost').replace(/:(80|443)$/, '');

    let html = ejs.render(template, {
        action: false,
        sender: title,
        title,
        message: `${user.name}, sinu uus parool on <strong>${password}</strong>`,
        footer: `Said selle e-kirja, kuna keegi lähtestas sinu konto parooli saidil <a href="${config.proto || 'http'}://${hostname}/">${hostname}</a>`
    });

    let mailOptions = {
        to: {
            name: user.name,
            address: user.username
        },
        subject: util.format('%s: Parool on uuendatud kasutajale %s', title, user.name),
        html
    };

    transport.sendMail(mailOptions, err => {
        if (err) {
            log.error('SMTP', 'Failed sending new password mail to %s, %s', user.username, err.message);
        } else {
            log.info('SMTP', 'Successfully sent new password mail to %s', user.username);
        }
    });
}
