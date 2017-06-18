'use strict';

const config = require('config');
const express = require('express');
const tools = require('../lib/tools');
const router = new express.Router();
const banks = require('../lib/banks.json');
const db = require('../lib/db');
const moment = require('moment');
const ObjectID = require('mongodb').ObjectID;
const banklink = require('../lib/banklink');
const util = require('util');
const urllib = require('url');
const randomString = require('random-string');

router.use(tools.requireLogin);

router.get('/:project/example/render/:type.php', serveRenderedExamplePayment);
router.get('/:project/example/:type.php', serveExamplePayment);
router.get('/:project/regenerate', tools.requireUser, handleRegenerateProjectCertificate);
router.get('/:project/:key([^.]+).pem', serveKey);

router.get('/:project/page/:pageNumber', serveProject);
router.get('/:project/page', serveProject);
router.get('/:project/:tab', serveProject);
router.get('/:project', serveProject);
router.post('/:project', serveProject);

function serveProject(req, res, next) {
    let id = (req.params.project || req.query.project || '').toString(),
        pageNumber = Number(req.params.pageNumber || req.query.pageNumber) || 1;

    if (!id.match(/^[a-fA-F0-9]{24}$/)) {
        req.flash('error', 'Vigane makselahenduse identifikaator');
        res.redirect('/');
        return;
    }

    db.database.collection('user').find({ role: { $ne: 'admin' }, username: { $ne: req.user.username } }).sort({ username: 1 }).toArray((err, users) => {
        if (err) {
            return next(err);
        }

        db.findOne(
            'project',
            {
                _id: new ObjectID(id)
            },
            (err, record) => {
                if (err) {
                    req.flash('error', err.message || err || 'Andmebaasi viga');
                    res.redirect('/');
                    return;
                }
                if (!record) {
                    req.flash('error', 'Sellise identifikaatoriga makselahendust ei leitud');
                    res.redirect('/');
                    return;
                }

                if (!tools.checkAuthorized(req, record)) {
                    req.flash('error', 'Sul ei ole õigusi selle makselahenduse kasutamiseks');
                    res.redirect('/');
                    return;
                }

                let authorizedIds = [].concat(record.authorized || []).map(id => id.toString());

                let authorized = users.filter(user => authorizedIds.includes(user._id.toString())).map(user => user.username);
                db.count(
                    'payment',
                    {
                        project: id
                    },
                    (err, total) => {
                        if (err) {
                            //
                        }
                        let pageCount = Math.ceil(total / config.pagingCount);

                        if (pageNumber > pageCount) {
                            pageNumber = pageCount || 1;
                        }

                        let start_index = (pageNumber - 1) * config.pagingCount;

                        db.find(
                            'payment',
                            {
                                project: id
                            },
                            {},
                            {
                                sort: [['date', 'desc']],
                                limit: config.pagingCount,
                                skip: start_index
                            },
                            (err, records) => {
                                if (err) {
                                    req.flash('error', err.message || err || 'Andmebaasi viga');
                                    res.redirect('/');
                                    return;
                                }

                                res.render('index', {
                                    pageTitle: record.name,
                                    page: '/project',
                                    project: record,
                                    authorized,
                                    banks,
                                    tab: req.params.tab || 'payments',
                                    id,

                                    start_index,
                                    pageNumber,
                                    pageCount,
                                    pagePath: '/project/' + id + '/page',
                                    paging: tools.paging(pageNumber, pageCount),
                                    payments: (records || []).map(payment => {
                                        payment.date = moment(payment.date).calendar();
                                        payment.amount = tools.formatCurrency(payment.amount, payment.currency || 'EUR');
                                        payment.typeName =
                                            {
                                                PAYMENT: 'Maksekorraldus',
                                                IDENTIFICATION: 'Autentimine'
                                            }[payment.type] || '';
                                        return payment;
                                    }),
                                    languages: tools.languageNames,
                                    countries: tools.countryCodes,
                                    labels: tools.processLabels
                                });
                            }
                        );
                    }
                );
            }
        );
    });
}

function serveRenderedExamplePayment(req, res) {
    req.renderHTML = true;
    serveExamplePayment(req, res);
}

function serveExamplePayment(req, res) {
    let id = (req.params.project || req.query.project || '').toString();

    if (['auth', 'pay'].indexOf(req.params.type) < 0) {
        req.flash('error', 'Tundmatu rakendus');
        res.redirect('/');
        return;
    }

    if (!id.match(/^[a-fA-F0-9]{24}$/)) {
        req.flash('error', 'Vigane makselahenduse identifikaator');
        res.redirect('/');
        return;
    }

    let urlPrefix = (config.proto || 'http') + '://' + (config.hostname || (req && req.headers && req.headers.host) || 'localhost').replace(/:(80|443)$/, '');
    let isAuth = req.params.type === 'auth';

    banklink.samplePayment(req, id, req.user.username, urlPrefix, isAuth, req.query, (err, paymentObj, charset) => {
        if (err) {
            req.flash('error', err.message);
            res.redirect('/');
            return;
        }

        let payment = {
                charset,
                bank: paymentObj.bank.type,
                fields: Object.keys(paymentObj.fields).map(key => ({
                    key,
                    value: paymentObj.fields[key]
                })),
                isAuth: paymentObj.isAuth,
                editable: paymentObj.editable
            },
            project = paymentObj.record;

        res.charset = payment.charset;
        res.forceCharset = payment.charset;

        if (!req.renderHTML) {
            res.set('Content-Description', 'File Transfer');
            res.set('content-type', 'text/plain; charset=' + res.forceCharset);
            res.set('Content-Disposition', util.format('attachment; filename="%s"', isAuth ? 'auth.php' : 'pay.php'));
        } else {
            res.set('content-type', 'text/html; charset=' + res.forceCharset);
        }

        res.render('scripts/' + (req.renderHTML ? 'rendered.pay' : 'pay.' + payment.bank) + '.ejs', {
            title:
                config.title ||
                    (config.hostname || (req && req.headers && req.headers.host) || 'localhost')
                        .replace(/:\d+$/, '')
                        .toLowerCase()
                        .replace(/^./, s => s.toUpperCase()),
            proto: config.proto || 'http',
            hostname: (config.hostname || (req && req.headers && req.headers.host) || 'localhost').replace(/:(80|443)$/, ''),
            payment,
            project,
            queryString: urllib.parse(req.originalUrl).search || '',
            query: req.query || {},
            bank: banks[project.bank || 'ipizza'] || banks.ipizza,
            signatureOrder: banklink.signatureOrder(payment.bank),
            googleAnalyticsID: config.googleAnalyticsID
        });
    });
}

function serveKey(req, res) {
    let id = (req.params.project || '').toString().trim();

    if (!id.match(/^[a-fA-F0-9]{24}$/)) {
        req.flash('error', 'Vigane makselahenduse identifikaator');
        res.redirect('/');
        return;
    }

    db.findOne(
        'project',
        {
            _id: new ObjectID(id)
        },
        (err, record) => {
            if (err) {
                req.flash('error', err.message || err || 'Andmebaasi viga');
                res.redirect('/');
                return;
            }
            if (!record) {
                req.flash('error', 'Sellise identifikaatoriga makselahendust ei leitud');
                res.redirect('/');
                return;
            }
            if (!tools.checkAuthorized(req, record)) {
                req.flash('error', 'Sul ei ole õigusi selle makselahenduse kasutamiseks');
                res.redirect('/');
                return;
            }

            let filename = req.params.key + '.pem',
                certificate;

            switch (req.params.key) {
                case 'user_key':
                    certificate = record.userCertificate.clientKey;
                    break;
                case 'user_cert':
                    certificate = record.userCertificate.certificate;
                    break;
                case 'bank_key':
                    certificate = record.bankCertificate.clientKey;
                    break;
                case 'bank_cert':
                    certificate = record.bankCertificate.certificate;
                    break;
                default:
                    req.flash('error', 'Sellist võtmefaili ei leitud');
                    res.redirect('/project/' + req.params.project + '/certs');
                    return;
            }

            res.status(200);
            res.set('Content-Description', 'File Transfer');
            res.set('Content-Type', 'application/octet-stream');
            res.set('Content-Disposition', util.format('attachment; filename="%s"', filename));

            res.send(certificate);
        }
    );
}

function handleRegenerateProjectCertificate(req, res) {
    let id = (req.params.project || '').toString().trim();

    if (!id.match(/^[a-fA-F0-9]{24}$/)) {
        req.flash('error', 'Vigane makselahenduse identifikaator');
        res.redirect('/');
        return;
    }

    db.findOne(
        'project',
        {
            _id: new ObjectID(id)
        },
        (err, record) => {
            if (err) {
                req.flash('error', err.message || err || 'Andmebaasi viga');
                res.redirect('/');
                return;
            }
            if (!record) {
                req.flash('error', 'Sellise identifikaatoriga makselahendust ei leitud');
                res.redirect('/');
                return;
            }
            if (!tools.checkAuthorized(req, record)) {
                req.flash('error', 'Sul ei ole õigusi selle makselahenduse kasutamiseks');
                res.redirect('/');
                return;
            }

            tools.generateKeys(req.user, 20 * 365, record.keyBitsize || 1024, (err, userCertificate, bankCertificate) => {
                if (err) {
                    req.flash('error', 'Sertifikaadi genereerimisel tekkis viga');
                    res.redirect('/project/' + id.toString() + '/certs');
                    return;
                }

                record.userCertificate = userCertificate;
                record.bankCertificate = bankCertificate;
                record.secret = randomString({
                    length: 32
                });

                db.save('project', record, (err, id) => {
                    if (err) {
                        req.flash('error', 'Andmebaasi viga');
                        res.redirect('/project/' + id.toString() + '/certs');
                        return;
                    }

                    if (id) {
                        req.flash('success', 'Genereeriti uus sertifikaat');
                        res.redirect('/project/' + id.toString() + '/certs');
                    } else {
                        req.flash('error', 'Makselahenduse andmete uuendamine ebaõnnestus');
                        res.redirect('/project/' + id.toString() + '/certs');
                        return;
                    }
                });
            });
        }
    );
}

module.exports = router;
