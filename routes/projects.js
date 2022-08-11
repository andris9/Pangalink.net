'use strict';

const config = require('config');
const express = require('express');
const tools = require('../lib/tools');
const router = new express.Router();
const IBAN = require('iban');
const banks = require('../lib/banks.json');
const db = require('../lib/db');
const moment = require('moment');
const ObjectId = require('mongodb').ObjectId;
const util = require('util');
const randomString = require('random-string');

router.use(tools.requireLogin);

router.get('/', serveProjects);

router.get('/add', tools.requireUser, serveAddProject);
router.post('/add', tools.requireUser, handleAddProject);

router.get('/edit/:project', tools.requireUser, serveEditProject);
router.post('/edit', tools.requireUser, handleEditProject);

router.get('/delete/:project', tools.requireUser, serveDeleteProject);

router.get('/:pageNumber', serveProjects);

function serveAddProject(req, res, next) {
    db.database
        .collection('user')
        .find({ role: { $ne: 'admin' } })
        .sort({ username: 1 })
        .toArray((err, users) => {
            if (err) {
                return next(err);
            }

            let authorized = tools.processAuthorized(users);

            res.render('index', {
                pageTitle: 'Lisa makselahendus',
                page: '/add-project',
                name: req.query.name || '',
                description: req.query.description || '',
                keyBitsize: Number(req.query.keyBitsize) || 2048,
                soloAlgo: req.query.soloAlgo || '',
                soloAutoResponse: !!(req.query.soloAutoResponse || ''),
                ecUrl: req.query.ecUrl || '',
                authorized,
                ipizzaReceiverName: req.query.ipizzaReceiverName || '',
                ipizzaReceiverAccount: req.query.ipizzaReceiverAccount || '',
                id: req.query.id || '',
                action: 'add',
                bank: req.query.bank || '',
                banks,
                validation: {}
            });
        });
}

function serveProjects(req, res) {
    let pageNumber = Number(req.params.pageNumber || req.query.pageNumber) || 1;

    let query = {};
    if (req.user.role !== 'admin') {
        query.$or = [
            {
                owner: req.user._id
            },
            {
                authorized: new ObjectId(req.user._id)
            }
        ];
    }

    db.database.collection('project').countDocuments(query, (err, total) => {
        if (err) {
            //
        }
        let pageCount = Math.ceil(total / config.pagingCount);

        if (pageNumber > pageCount) {
            pageNumber = pageCount || 1;
        }

        let start_index = (pageNumber - 1) * config.pagingCount;

        db.find(
            'project',
            query,
            {},
            {
                sort: [['name', 'asc']],
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
                    pageTitle: 'Makselahendused',
                    page: '/projects',
                    start_index,
                    pageNumber,
                    pageCount,
                    pagePath: '/projects',
                    banks,
                    paging: tools.paging(pageNumber, pageCount),
                    projects: (records || []).map(project => {
                        project.formattedDate = project.updatedDate ? moment(project.updatedDate).calendar() : '';
                        return project;
                    })
                });
            }
        );
    });
}

function serveEditProject(req, res, next) {
    let id = (req.params.project || req.query.project || '').toString();

    if (!id.match(/^[a-fA-F0-9]{24}$/)) {
        req.flash('error', 'Vigane makselahenduse identifikaator');
        res.redirect('/');
        return;
    }

    db.database
        .collection('user')
        .find({ role: { $ne: 'admin' } })
        .sort({ username: 1 })
        .toArray((err, users) => {
            if (err) {
                return next(err);
            }

            db.findOne(
                'project',
                {
                    _id: new ObjectId(id)
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

                    let authorized = tools.processAuthorized(users, record.authorized);

                    res.render('index', {
                        pageTitle: 'Muuda makselahendust',
                        page: '/edit-project',
                        name: req.body.name || record.name || '',
                        description: req.body.description || record.description || '',
                        id,
                        keyBitsize: Number(req.body.keyBitsize) || Number(record.keyBitsize) || 1024,
                        soloAlgo: req.body.soloAlgo || record.soloAlgo || '',
                        soloAutoResponse: !!(req.body.soloAutoResponse || record.soloAutoResponse || ''),
                        ecUrl: req.body.ecUrl || record.ecUrl || '',
                        authorized,
                        ipizzaReceiverName: req.body.ipizzaReceiverName || record.ipizzaReceiverName || '',
                        ipizzaReceiverAccount: req.body.ipizzaReceiverAccount || record.ipizzaReceiverAccount || '',
                        action: 'modify',
                        userCertificate: record.userCertificate,
                        bank: req.body.bank || record.bank || '',
                        banks,
                        validation: {}
                    });
                }
            );
        });
}

function serveDeleteProject(req, res) {
    let id = (req.params.project || req.query.project || '').toString();

    if (!id.match(/^[a-fA-F0-9]{24}$/)) {
        req.flash('error', 'Vigane makselahenduse identifikaator');
        res.redirect('/');
        return;
    }

    db.findOne(
        'project',
        {
            _id: new ObjectId(id)
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

            db.remove(
                'project',
                {
                    _id: new ObjectId(id)
                },
                () => {
                    db.remove(
                        'counter',
                        {
                            _id: 'trans:' + project.uid
                        },
                        () => {
                            db.remove(
                                'payment',
                                {
                                    project: id
                                },
                                () => {
                                    req.flash('success', util.format('Makselahendus nimega "%s" on kustutatud', project.name));
                                    res.redirect('/projects');
                                    return;
                                }
                            );
                        }
                    );
                }
            );
        }
    );
}

function handleAddProject(req, res, next) {
    let validationErrors = {},
        error = false;

    db.database
        .collection('user')
        .find({ role: { $ne: 'admin' } })
        .sort({ username: 1 })
        .toArray((err, users) => {
            if (err) {
                return next(err);
            }

            req.body.id = (req.body.id || '').toString().trim();
            req.body.name = (req.body.name || '').toString().trim();
            req.body.description = (req.body.description || '').toString().trim();
            req.body.bank = (req.body.bank || '').toString().trim();

            req.body.keyBitsize = Number(req.body.keyBitsize) || 1024;

            req.body.soloAlgo = (req.body.soloAlgo || '').toString().toLowerCase().trim();
            req.body.soloAutoResponse = !!(req.body.soloAutoResponse || '').toString().trim();

            req.body.ecUrl = (req.body.ecUrl || '').toString().trim();

            let authorized = tools.processAuthorized(users, req.body.authorized);

            req.body.ipizzaReceiverName = (req.body.ipizzaReceiverName || '').toString().trim();
            req.body.ipizzaReceiverAccount = (req.body.ipizzaReceiverAccount || '').toString().trim();

            if (!req.body.name) {
                error = true;
                validationErrors.name = 'Makselahenduse nimetuse täitmine on kohustuslik';
            }

            if (!banks[req.body.bank]) {
                error = true;
                validationErrors.bank = 'Panga tüüp on valimata';
            }

            if (req.body.keyBitsize && [1024, 2048, 4096].indexOf(req.body.keyBitsize) < 0) {
                error = true;
                validationErrors.keyBitsize = 'Vigane võtme pikkus';
            }

            if (
                ['nordea', 'tapiola', 'alandsbanken', 'handelsbanken', 'aktiasppop'].indexOf(req.body.bank) >= 0 &&
                (!req.body.soloAlgo || ['md5', 'sha1', 'sha256'].indexOf(req.body.soloAlgo) < 0)
            ) {
                error = true;
                validationErrors.soloAlgo = 'Vigane algoritm';
            }

            if (req.body.bank === 'ec' && req.body.ecUrl && !tools.validateUrl(req.body.ecUrl)) {
                error = true;
                validationErrors.ecUrl = 'Vigane tagasisuunamise aadress, peab olema korrektne URL';
            }

            if (req.body.ipizzaReceiverAccount && !IBAN.isValid(req.body.ipizzaReceiverAccount)) {
                error = true;
                validationErrors.ipizzaReceiverAccount = 'Saaja konto peab olema IBAN formaadis';
            }

            if (['nordea', 'tapiola', 'alandsbanken', 'handelsbanken', 'aktiasppop'].indexOf(req.body.bank) < 0) {
                req.body.soloAlgo = '';
                req.body.soloAutoReturn = '';
            }

            if (req.body.bank !== 'ec') {
                req.body.ecUrl = '';
            }

            if (error) {
                req.flash('error', 'Andmete valideerimisel ilmnesid vead');
                res.render('index', {
                    pageTitle: 'Lisa uus makselahendus',
                    page: '/add-project',
                    name: req.body.name || '',
                    description: req.body.description || '',
                    keyBitsize: Number(req.body.keyBitsize) || 1024,
                    soloAlgo: req.body.soloAlgo || '',
                    soloAutoResponse: !!(req.body.soloAutoResponse || ''),
                    ecUrl: req.body.ecUrl || '',
                    authorized,
                    ipizzaReceiverName: req.body.ipizzaReceiverName || '',
                    ipizzaReceiverAccount: req.body.ipizzaReceiverAccount || '',
                    id: req.body.id || '',
                    action: 'add',
                    bank: req.body.bank || '',
                    banks,
                    validation: validationErrors
                });
                return;
            }

            tools.generateKeys(req.user, 20 * 365, Number(req.body.keyBitsize) || 1024, (err, userCertificate, bankCertificate) => {
                if (err) {
                    req.flash('error', 'Sertifikaadi genereerimisel tekkis viga');
                    res.render('index', {
                        pageTitle: 'Lisa uus makselahendus',
                        page: '/add-project',
                        name: req.body.name || '',
                        description: req.body.description || '',
                        id: req.body.id || '',
                        keyBitsize: Number(req.body.keyBitsize) || 1024,
                        soloAlgo: req.body.soloAlgo || '',
                        soloAutoResponse: !!(req.body.soloAutoResponse || ''),
                        bank: req.body.bank || '',
                        banks,
                        ecUrl: req.body.ecUrl || '',
                        authorized,
                        ipizzaReceiverName: req.body.ipizzaReceiverName || '',
                        ipizzaReceiverAccount: req.body.ipizzaReceiverAccount || '',
                        action: 'add',
                        validation: validationErrors
                    });
                    return;
                }

                let project = {
                    name: req.body.name,
                    description: req.body.description,
                    owner: req.user._id,
                    keyBitsize: req.body.keyBitsize,
                    soloAlgo: req.body.soloAlgo,
                    soloAutoResponse: !!(req.body.soloAutoResponse || ''),
                    bank: req.body.bank,
                    ecUrl: req.body.ecUrl,
                    authorized: authorized.filter(user => user.selected).map(user => user._id),
                    ipizzaReceiverName: req.body.ipizzaReceiverName,
                    ipizzaReceiverAccount: req.body.ipizzaReceiverAccount,
                    created: new Date(),
                    userCertificate,
                    bankCertificate,
                    secret: randomString({
                        length: 32
                    })
                };

                tools.incrIdCounter((err, id) => {
                    if (err) {
                        req.flash('error', 'Andmebaasi viga');
                        res.render('index', {
                            pageTitle: 'Lisa uus makselahendus',
                            page: '/add-project',
                            name: req.body.name || '',
                            description: req.body.description || '',
                            id: req.body.id || '',
                            keyBitsize: Number(req.body.keyBitsize) || 1024,
                            soloAlgo: req.body.soloAlgo || '',
                            soloAutoResponse: !!(req.body.soloAutoResponse || ''),
                            bank: req.body.bank || '',
                            banks,
                            ecUrl: req.body.ecUrl || '',
                            authorized,
                            ipizzaReceiverName: req.body.ipizzaReceiverName || '',
                            ipizzaReceiverAccount: req.body.ipizzaReceiverAccount || '',
                            action: 'add',
                            validation: validationErrors
                        });
                        return;
                    }

                    if (['tapiola', 'alandsbanken', 'handelsbanken', 'aktiasppop'].indexOf(req.body.bank) >= 0) {
                        project.uid = (10000000 + Number(tools.getReferenceCode(id))).toString();
                    } else {
                        project.uid = 'uid' + tools.getReferenceCode(id);
                    }

                    db.save('project', project, (err, id) => {
                        if (err) {
                            req.flash('error', 'Andmebaasi viga');
                            res.render('index', {
                                pageTitle: 'Lisa uus makselahendus',
                                page: '/add-project',
                                name: req.body.name || '',
                                description: req.body.description || '',
                                id: req.body.id || '',
                                keyBitsize: Number(req.body.keyBitsize) || 1024,
                                soloAlgo: req.body.soloAlgo || '',
                                soloAutoResponse: !!(req.body.soloAutoResponse || ''),
                                bank: req.body.bank || '',
                                banks,
                                ecUrl: req.body.ecUrl || '',
                                authorized,
                                ipizzaReceiverName: req.body.ipizzaReceiverName || '',
                                ipizzaReceiverAccount: req.body.ipizzaReceiverAccount || '',
                                action: 'add',
                                validation: validationErrors
                            });
                            return;
                        }

                        if (id) {
                            req.flash('success', 'Makselahendus on loodud');
                            res.redirect('/project/' + id.toString() + '/certs');
                        } else {
                            req.flash('error', 'Makselahenduse loomine ebaõnnestus');
                            res.render('index', {
                                pageTitle: 'Lisa uus makselahendus',
                                page: '/add-project',
                                name: req.body.name || '',
                                description: req.body.description || '',
                                id: req.body.id || '',
                                keyBitsize: Number(req.body.soloAlgo) || 1024,
                                soloAlgo: req.body.soloAlgo || '',
                                soloAutoResponse: !!(req.body.soloAutoResponse || ''),
                                bank: req.body.bank || '',
                                banks,
                                ecUrl: req.body.ecUrl || '',
                                authorized,
                                ipizzaReceiverName: req.body.ipizzaReceiverName || '',
                                ipizzaReceiverAccount: req.body.ipizzaReceiverAccount || '',
                                action: 'add',
                                validation: validationErrors
                            });
                            return;
                        }
                    });
                });
            });
        });
}

function handleEditProject(req, res, next) {
    let validationErrors = {},
        error = false;

    db.database
        .collection('user')
        .find({ role: { $ne: 'admin' } })
        .sort({ username: 1 })
        .toArray((err, users) => {
            if (err) {
                return next(err);
            }

            req.body.id = (req.body.id || '').toString().trim();
            req.body.name = (req.body.name || '').toString().trim();
            req.body.description = (req.body.description || '').toString().trim();

            req.body.keyBitsize = Number(req.body.keyBitsize) || 1024;

            req.body.soloAlgo = (req.body.soloAlgo || '').toString().toLowerCase().trim();
            req.body.soloAutoResponse = !!(req.body.soloAutoResponse || '').toString().trim();

            req.body.ecUrl = (req.body.ecUrl || '').toString().trim();

            let authorized = tools.processAuthorized(users, req.body.authorized);

            req.body.ipizzaReceiverName = (req.body.ipizzaReceiverName || '').toString().trim();
            req.body.ipizzaReceiverAccount = (req.body.ipizzaReceiverAccount || '').toString().trim();

            if (!req.body.id.match(/^[a-fA-F0-9]{24}$/)) {
                req.flash('error', 'Vigane makselahenduse identifikaator');
                res.redirect('/');
                return;
            }

            if (!req.body.name) {
                error = true;
                validationErrors.name = 'Makselahenduse nimetuse täitmine on kohustuslik';
            }

            db.findOne(
                'project',
                {
                    _id: new ObjectId(req.body.id)
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

                    if (req.body.keyBitsize && [1024, 2048, 4096].indexOf(req.body.keyBitsize) < 0) {
                        error = true;
                        validationErrors.keyBitsize = 'Vigane võtme pikkus';
                    }

                    if (record.bank === 'nordea' && (!req.body.soloAlgo || ['md5', 'sha1', 'sha256'].indexOf(req.body.soloAlgo) < 0)) {
                        error = true;
                        validationErrors.soloAlgo = 'Vigane algoritm';
                    }

                    if (record.bank === 'ec' && req.body.ecUrl && !tools.validateUrl(req.body.ecUrl)) {
                        error = true;
                        validationErrors.ecUrl = 'Vigane tagasisuunamise aadress, peab olema korrektne URL';
                    }

                    if (
                        req.body.ipizzaReceiverAccount &&
                        req.body.ipizzaReceiverAccount !== record.ipizzaReceiverAccount &&
                        !IBAN.isValid(req.body.ipizzaReceiverAccount)
                    ) {
                        error = true;
                        validationErrors.ipizzaReceiverAccount = 'Saaja konto peab olema IBAN formaadis';
                    }

                    if (record.bank !== 'nordea') {
                        req.body.soloAlgo = '';
                        req.body.soloAutoResponse = '';
                    }

                    if (record.bank !== 'ec') {
                        req.body.ecUrl = '';
                    }

                    if (error) {
                        req.flash('error', 'Andmete valideerimisel ilmnesid vead');
                        res.render('index', {
                            pageTitle: 'Muuda makselahendust',
                            page: '/edit-project',
                            name: req.body.name || '',
                            description: req.body.description || '',
                            id: req.body.id || '',
                            keyBitsize: Number(req.body.keyBitsize) || 1024,
                            soloAlgo: req.body.soloAlgo || '',
                            soloAutoResponse: !!(req.body.soloAutoResponse || ''),
                            ecUrl: req.body.ecUrl || '',
                            authorized,
                            ipizzaReceiverName: req.body.ipizzaReceiverName || '',
                            ipizzaReceiverAccount: req.body.ipizzaReceiverAccount || '',
                            action: 'modify',
                            bank: req.body.bank || '',
                            banks,
                            userCertificate: record.userCertificate,
                            validation: validationErrors
                        });
                        return;
                    }

                    tools.generateKeys(req.user, 20 * 365, Number(req.body.keyBitsize) || 1024, (err, userCertificate, bankCertificate) => {
                        if (err && req.body.regenerate) {
                            req.flash('error', 'Sertifikaadi genereerimisel tekkis viga');
                            res.render('index', {
                                pageTitle: 'Muuda makselahendust',
                                page: '/edit-project',
                                name: req.body.name || '',
                                description: req.body.description || '',
                                id: req.body.id || '',
                                keyBitsize: Number(req.body.keyBitsize) || 1024,
                                soloAlgo: req.body.soloAlgo || '',
                                soloAutoResponse: !!(req.body.soloAutoResponse || ''),
                                ecUrl: req.body.ecUrl || '',
                                authorized,
                                ipizzaReceiverName: req.body.ipizzaReceiverName || '',
                                ipizzaReceiverAccount: req.body.ipizzaReceiverAccount || '',
                                action: 'modify',
                                bank: req.body.bank || '',
                                banks,
                                userCertificate: record.userCertificate,
                                validation: validationErrors
                            });
                            return;
                        }

                        record.name = req.body.name;
                        record.description = req.body.description;
                        record.updated = new Date();
                        record.keyBitsize = Number(req.body.keyBitsize) || 1024;
                        record.soloAlgo = req.body.soloAlgo || '';
                        record.soloAutoResponse = !!(req.body.soloAutoResponse || '');

                        record.ecUrl = req.body.ecUrl || '';
                        record.authorized = authorized.filter(user => user.selected).map(user => user._id);
                        record.ipizzaReceiverName = req.body.ipizzaReceiverName || '';
                        record.ipizzaReceiverAccount = req.body.ipizzaReceiverAccount || '';

                        if (req.body.regenerate) {
                            record.userCertificate = userCertificate;
                            record.bankCertificate = bankCertificate;
                            record.secret = randomString({
                                length: 32
                            });
                        }

                        db.save('project', record, (err, id) => {
                            if (err) {
                                req.flash('error', 'Andmebaasi viga');
                                res.render('index', {
                                    pageTitle: 'Muuda makselahendust',
                                    page: '/edit-project',

                                    name: req.body.name || '',
                                    description: req.body.description || '',
                                    id: req.body.id || '',
                                    keyBitsize: Number(req.body.keyBitsize) || 1024,
                                    soloAlgo: req.body.soloAlgo || '',
                                    soloAutoResponse: !!(req.body.soloAutoResponse || ''),
                                    ecUrl: req.body.ecUrl || '',
                                    authorized,
                                    ipizzaReceiverName: req.body.ipizzaReceiverName || '',
                                    ipizzaReceiverAccount: req.body.ipizzaReceiverAccount || '',
                                    action: 'modify',
                                    bank: req.body.bank || '',
                                    banks,
                                    userCertificate: record.userCertificate,
                                    validation: validationErrors
                                });
                                return;
                            }
                            if (id) {
                                req.flash('success', 'Makselahenduse andmed on uuendatud');
                                if (req.body.regenerate) {
                                    req.flash('success', 'Genereeriti uus sertifikaat');
                                }
                                res.redirect('/project/' + id.toString() + '/certs');
                            } else {
                                req.flash('error', 'Makselahenduse andmete uuendamine ebaõnnestus');
                                res.render('index', {
                                    pageTitle: 'Muuda makselahendust',
                                    page: '/edit-project',

                                    name: req.body.name || '',
                                    description: req.body.description || '',
                                    id: req.body.id || '',
                                    keyBitsize: Number(req.body.keyBitsize) || 1024,
                                    soloAlgo: req.body.soloAlgo || '',
                                    soloAutoResponse: !!(req.body.soloAutoResponse || ''),
                                    ecUrl: req.body.ecUrl || '',
                                    authorized,
                                    ipizzaReceiverName: req.body.ipizzaReceiverName || '',
                                    ipizzaReceiverAccount: req.body.ipizzaReceiverAccount || '',
                                    action: 'modify',
                                    bank: req.body.bank || '',
                                    banks,
                                    userCertificate: record.userCertificate,
                                    validation: validationErrors
                                });
                                return;
                            }
                        });
                    });
                }
            );
        });
}

module.exports = router;
