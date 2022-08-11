'use strict';

const config = require('config');
const express = require('express');
const router = new express.Router();
const tools = require('../lib/tools');
const db = require('../lib/db');
const ObjectId = require('mongodb').ObjectId;
const util = require('util');
const banklink = require('../lib/banklink');
const banks = require('../lib/banks.json');
const moment = require('moment');
const urllib = require('url');

router.use(tools.requireLogin);
router.get('/:payment/scripts/:direction([^.]+).php', servePayment);
router.get('/:payment', servePayment);

function servePayment(req, res) {
    let id = (req.params.payment || req.query.payment || '').toString();

    if (!req.user) {
        req.user = {};
    }

    if (!id.match(/^[a-fA-F0-9]{24}$/)) {
        req.flash('error', 'Vigane maksekorralduse identifikaator');
        res.redirect('/');
        return;
    }

    db.findOne(
        'payment',
        {
            _id: new ObjectId(id)
        },
        (err, payment) => {
            if (err) {
                req.flash('error', err.message || err || 'Andmebaasi viga');
                res.redirect('/');
                return;
            }
            if (!payment) {
                req.flash('error', 'Sellise identifikaatoriga maksekorraldust ei leitud');
                res.redirect('/');
                return;
            }

            db.findOne(
                'project',
                {
                    _id: new ObjectId(payment.project)
                },
                (err, project) => {
                    if (err) {
                        req.flash('error', err.message || err || 'Andmebaasi viga');
                        res.redirect('/');
                        return;
                    }
                    if (!project) {
                        req.flash('error', 'Sellise identifikaatoriga makselahendust ei leitud');
                        res.redirect('/');
                        return;
                    }

                    if (!tools.checkAuthorized(req, project)) {
                        req.flash('error', 'Sul ei ole õigusi selle makselahenduse kasutamiseks');
                        res.redirect('/');
                        return;
                    }

                    if (['pay', 'receive'].indexOf(req.params.direction) >= 0) {
                        payment.isAuth = payment.type === 'IDENTIFICATION';

                        res.forceCharset = payment.charset;
                        res.set('Content-Description', 'File Transfer');
                        res.set('content-type', 'text/plain; charset=' + payment.forceCharset);
                        res.set('Content-Disposition', util.format('attachment; filename="%s"', req.params.direction + '.php'));
                        res.render('scripts/' + req.params.direction + '.' + payment.bank + '.ejs', {
                            proto: config.proto || 'http',
                            hostname: (config.hostname || (req && req.headers && req.headers.host) || 'localhost').replace(/:(80|443)$/, ''),
                            payment,
                            project,
                            bank: banks[project.bank || 'ipizza'] || banks.ipizza,
                            signatureOrder: banklink.signatureOrder(payment.bank),
                            googleAnalyticsID: config.googleAnalyticsID
                        });
                    } else {
                        res.render('index', {
                            pageTitle: 'Makse andmed',
                            page: '/payment',
                            payment,
                            project,
                            bank: banks[project.bank],

                            inspect: util.inspect.bind(util),

                            host: urllib.parse(
                                payment.state === 'PAYED' ? payment.successTarget : payment.state === 'REJECTED' ? payment.rejectTarget : payment.cancelTarget
                            ).host,

                            date: moment(payment.date).calendar(),
                            amount: tools.formatCurrency(payment.amount, payment.currency || 'EUR'),
                            typeName:
                                {
                                    PAYMENT: 'Maksekorraldus',
                                    IDENTIFICATION: 'Autentimine'
                                }[payment.type] || '',

                            languages: tools.languageNames,
                            countries: tools.countryCodes,
                            labels: tools.processLabels
                        });
                    }
                }
            );
        }
    );
}

module.exports = router;
