'use strict';

const config = require('wild-config');
const ejs = require('ejs');
const nodemailer = require('nodemailer');
const fs = require('fs');
const log = require('npmlog');
const util = require('util');
const template = fs.readFileSync(__dirname + '/../www/views/mail/template.ejs', 'utf-8');
const directTransport = require('nodemailer-direct-transport');

let transport;
if (config.mail.smtp.direct) {
    transport = nodemailer.createTransport(directTransport(config.mail.smtp), config.mail.defaults);
} else {
    transport = nodemailer.createTransport(config.mail.smtp, config.mail.defaults);
}

module.exports.sendRegistration = sendRegistration;
module.exports.sendResetLink = sendResetLink;
module.exports.sendPassword = sendPassword;
module.exports.sendInvitation = sendInvitation;

transport.on('log', data => {
    log.verbose('SMTP', data.message);
});

function sendInvitation(req, ticket) {
    let html = ejs.render(template, {
        sender: req.siteTitle,
        title: req.siteTitle,
        message: 'Uue kasutajakonto loomiseks kliki alloleval nupul. Konto loomise link aegub 7 päeva pärast.',
        action: {
            link: `${req.siteProto}://${req.siteHostname}/account/join?username=${encodeURIComponent(ticket.address)}&ticket=${ticket._id.toString()}`,
            title: 'Loo uus konto'
        },
        footer: `Said selle e-kirja, kuna saidi <a href="${req.siteProto}://${req.siteHostname}/">${req.siteHostname}</a> administraator soovis lisada Sinu e-posti aadressile uut kasutajakontot`
    });

    let mailOptions = {
        from: {
            name: req.emailName,
            address: req.emailAddress
        },
        to: {
            address: ticket.address
        },
        subject: util.format('%s: Kutse uue konto loomiseks', req.siteTitle),
        html
    };

    transport.sendMail(mailOptions, err => {
        if (err) {
            log.error('SMTP', 'Failed sending account ticket %s mail to %s, %s', ticket._id, ticket.address, err.message);
            log.error('SMTP', err);
        } else {
            log.info('SMTP', 'Successfully sent ccount ticket %s mail to %s', ticket._id, ticket.address);
        }
    });
}

function sendRegistration(req, user) {
    let html = ejs.render(template, {
        action: false,
        sender: req.siteTitle,
        title: req.siteTitle,
        message: `${user.name}, sinu ${req.siteTitle} konto on valmis!
Sinu kasutajanimi: ${user.username}<br/>Sinu parool: registreerimisel kasutatud parool`,
        footer: `Said selle e-kirja, kuna keegi kasutas sinu aadressi konto loomiseks saidil <a href="${req.siteProto}://${req.siteHostname}/">${req.siteHostname}</a>`
    });

    let mailOptions = {
        from: {
            name: req.emailName,
            address: req.emailAddress
        },
        to: {
            name: user.name,
            address: user.username
        },
        subject: util.format('%s: Tere tulemast, %s!', req.siteTitle, user.name),
        html
    };

    transport.sendMail(mailOptions, err => {
        if (err) {
            log.error('SMTP', 'Failed sending registration mail to %s, %s', user.username, err.message);
            log.error('SMTP', err);
        } else {
            log.info('SMTP', 'Successfully sent registration mail to %s', user.username);
        }
    });
}

function sendResetLink(req, user, resetToken) {
    let html = ejs.render(template, {
        sender: req.siteTitle,
        title: req.siteTitle,
        message: `${user.name}, uue parooli genereerimiseks ja vana tühistamiseks kliki alloleval nupul`,
        action: {
            link: `${req.siteProto}://${req.siteHostname}/account/reset-password?username=${encodeURIComponent(user.username)}&resetToken=${resetToken}`,
            title: 'Lähtesta Parool'
        },
        footer: `Said selle e-kirja, kuna keegi üritas lähtestada sinu konto parooli saidil <a href="${req.siteProto}://${req.siteHostname}/">${req.siteHostname}</a>`
    });

    let mailOptions = {
        from: {
            name: req.emailName,
            address: req.emailAddress
        },
        to: {
            name: user.name,
            address: user.username
        },
        subject: util.format('%s: Parooli lähtestamine kasutajale %s', req.siteTitle, user.name),
        html
    };

    transport.sendMail(mailOptions, err => {
        if (err) {
            log.error('SMTP', 'Failed sending password reset mail to %s, %s', user.username, err.message);
            log.error('SMTP', err);
        } else {
            log.info('SMTP', 'Successfully sent password reset mail to %s', user.username);
        }
    });
}

function sendPassword(req, user, password) {
    let html = ejs.render(template, {
        action: false,
        sender: req.siteTitle,
        title: req.siteTitle,
        message: `${user.name}, sinu uus parool on <strong>${password}</strong>`,
        footer: `Said selle e-kirja, kuna keegi lähtestas sinu konto parooli saidil <a href="${req.siteProto}://${req.siteHostname}/">${req.siteHostname}</a>`
    });

    let mailOptions = {
        from: {
            name: req.emailName,
            address: req.emailAddress
        },
        to: {
            name: user.name,
            address: user.username
        },
        subject: util.format('%s: Parool on uuendatud kasutajale %s', req.siteTitle, user.name),
        html
    };

    transport.sendMail(mailOptions, err => {
        if (err) {
            log.error('SMTP', 'Failed sending new password mail to %s, %s', user.username, err.message);
            log.error('SMTP', err);
        } else {
            log.info('SMTP', 'Successfully sent new password mail to %s', user.username);
        }
    });
}
