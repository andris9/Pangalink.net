'use strict';

let config = require('config');
let passport = require('passport');
let auth = require('./auth');
let banklink = require('./banklink');
let db = require('./db');
let ObjectID = require('mongodb').ObjectID;
let util = require('util');
let urllib = require('url');
let banks = require('./banks.json');
let tools = require('./tools');
let moment = require('moment');
let pem = require('pem');
let Packer = require('zip-stream');
let punycode = require('punycode');
let removeDiacritics = require('diacritics').remove;
let randomString = require('random-string');
let accountInfo = require('./account');
let IBAN = require('iban');

moment.locale('et');

// Main router function
module.exports = function(app) {
    app.get('/', serveFront);
    app.post('/', serveFront);

    app.get('/reset-link', serveResetLink);
    app.post('/reset-link', handleResetLink);

    app.get('/reset-password', serveResetPassword);
    app.post('/reset-password', handleResetPassword);

    app.get('/join', serveJoin);
    app.post('/join', handleJoin);

    app.get('/profile', serveProfile);
    app.post('/profile', handleProfile);

    app.post('/login', (req, res, next) => {
        passport.authenticate('local', (err, user) => {
            if (err) {
                return next(err);
            }
            if (!user) {
                req.flash('error', 'Sisselogimine ebaõnnestus');
                return res.redirect('/login');
            }
            req.logIn(user, (err) => {
                if (err) {
                    return next(err);
                }

                if (req.body.remember) {
                    req.session.cookie.maxAge = 1000 * 3600 * 24 * 365;
                } else {
                    req.session.cookie.expires = false;
                }

                req.flash('success', 'Oled edukalt sisse logitud');
                return res.redirect('/projects');
            });
        })(req, res, next);
    });

    app.get('/login', serveLogin);
    app.get('/logout', serveLogout);

    app.get('/banklink/:version/:bank', banklink.serveBanklink);
    app.post('/banklink/:version/:bank', banklink.serveBanklink);

    app.get('/banklink/:bank', banklink.serveBanklink);
    app.post('/banklink/:bank', banklink.serveBanklink);

    app.get('/projects/:pageNumber', serveProjects);
    app.get('/projects', serveProjects);

    app.get('/add-project', serveAddProject);
    app.post('/add-project', handleAddProject);

    app.get('/edit-project/:project', serveEditProject);
    app.post('/edit-project', handleEditProject);

    app.get('/delete-project/:project', serveDeleteProject);

    app.get('/project/:project/example/render/:type.php', serveRenderedExamplePayment);
    app.get('/project/:project/example/:type.php', serveExamplePayment);
    app.get('/project/:project/regenerate', handleRegenerateProjectCertificate);
    app.get('/project/:project/:key([^.]+).pem', serveKey);
    app.get('/project/:project', serveProject);
    app.post('/project/:project', serveProject);
    app.get('/project/:project/page/:pageNumber', serveProject);
    app.get('/project/:project/page', serveProject);
    app.get('/project/:project/:tab', serveProject);

    app.get('/preview/:payment', banklink.servePaymentPreview);

    app.post('/final', servePaymentFinal);
    app.post('/final/:payment', servePaymentFinal);

    app.get('/payment/:payment/scripts/:direction([^.]+).php', servePayment);
    app.get('/payment/:payment', servePayment);

    app.get('/keys', serveKeys);
    app.post('/keys', handleKeys);

    app.get('/api', serveAPI);

    app.get('/api/banks', serveAPIListBanks);
    app.get('/api/project', serveAPIListProject);
    app.get('/api/project/:project', serveAPIGetProject);
    app.post('/api/project', serveAPIPostProject);
    app.delete('/api/project/:project', serveAPIDeleteProject);

    app.get('/docs/:name', serveDocs);
};

/**
 * Serves frontpage (/) of the website
 *
 * @param {Object} req HTTP Request object
 * @param {Object} req HTTP Response object
 */
function serveFront(req, res) {
    serve(req, res, {
        page: '/'
    });
}

function serveKeys(req, res) {
    serve(req, res, {
        page: '/keys'
    });
}

function serveAPI(req, res) {
    let query,
        hostname = (config.hostname || (req && req.headers && req.headers.host) || 'localhost').replace(/:(80|443)$/, ''),
        apiHost = config.apiHost || hostname + '/api';

    if (req.user) {
        query = {
            $or: [{
                owner: req.user.username
            }, {
                authorized: req.user.username.toLowerCase().trim()
            }]
        };
        db.find('project', query, {}, {
            sort: [
                ['name', 'asc']
            ],
            limit: 10,
            skip: 0
        }, (err, records) => {
            serve(req, res, {
                page: '/api',
                values: {
                    list: records || [],
                    apiHost: apiHost,
                    banks: banks
                }
            });
        });
    } else {
        serve(req, res, {
            page: '/api',
            values: {
                list: [],
                apiHost: apiHost,
                banks: banks
            }
        });
    }
}

function serveResetLink(req, res) {
    serve(req, res, {
        page: '/reset-link',
        values: {
            username: req.query.username || ''
        }
    });
}

function serveResetPassword(req, res) {
    serve(req, res, {
        page: '/reset-password',
        values: {
            username: req.query.username || '',
            resetToken: req.query.resetToken || ''
        }
    });
}

function serveAddProject(req, res) {
    if (!req.user || !req.user.username) {
        return res.redirect('/login');
    }
    serve(req, res, {
        page: '/add-project',
        values: {
            name: req.query.name || '',
            description: req.query.description || '',
            keyBitsize: Number(req.query.keyBitsize) || 2048,
            soloAlgo: req.query.soloAlgo || '',
            soloAutoResponse: !!(req.query.soloAutoResponse || ''),
            ecUrl: req.query.ecUrl || '',
            authorized: processAuthorized(req.query.authorized || ''),
            ipizzaReceiverName: req.query.ipizzaReceiverName || '',
            ipizzaReceiverAccount: req.query.ipizzaReceiverAccount || '',
            id: req.query.id || '',
            action: 'add',
            bank: req.query.bank || '',
            banks: banks,
            validation: {}
        }
    });
}

function serveProjects(req, res) {
    if (!req.user || !req.user.username) {
        return res.redirect('/login');
    }

    let pageNumber = Number(req.params.pageNumber || req.query.pageNumber) || 1;

    let query = {
        $or: [{
            owner: req.user.username
        }, {
            authorized: req.user.username.toLowerCase().trim()
        }]
    };

    db.count('project', query, (err, total) => {

        let pageCount = Math.ceil(total / config.pagingCount);

        if (pageNumber > pageCount) {
            pageNumber = pageCount || 1;
        }

        let start_index = (pageNumber - 1) * config.pagingCount;

        db.find('project', query, {}, {
            sort: [
                ['name', 'asc']
            ],
            limit: config.pagingCount,
            skip: start_index
        }, (err, records) => {
            if (err) {
                req.flash('error', err.message || err || 'Andmebaasi viga');
                res.redirect('/');
                return;
            }
            serve(req, res, {
                page: '/projects',
                values: {
                    start_index: start_index,
                    pageNumber: pageNumber,
                    pageCount: pageCount,
                    pagePath: '/projects',
                    banks: banks,
                    paging: tools.paging(pageNumber, pageCount),
                    projects: (records || []).map(project => {
                        project.formattedDate = project.updatedDate ? moment(project.updatedDate).calendar() : '';
                        return project;
                    })
                }
            });
        });

    });

}

function serveEditProject(req, res) {

    if (!req.user || !req.user.username) {
        return res.redirect('/login');
    }

    let id = (req.params.project || req.query.project || '').toString();

    if (!id.match(/^[a-fA-F0-9]{24}$/)) {
        req.flash('error', 'Vigane makselahenduse identifikaator');
        res.redirect('/');
        return;
    }

    db.findOne('project', {
        _id: new ObjectID(id)
    }, (err, record) => {
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
        if (record.owner !== req.user.username && record.authorized.indexOf(req.user.username.toLowerCase().trim()) < 0) {
            req.flash('error', 'Sul ei ole õigusi selle makselahenduse kasutamiseks');
            res.redirect('/');
            return;
        }

        serve(req, res, {
            page: '/edit-project',
            values: {
                name: req.body.name || record.name || '',
                description: req.body.description || record.description || '',
                id: id,
                keyBitsize: Number(req.body.keyBitsize) || Number(record.keyBitsize) || 1024,
                soloAlgo: req.body.soloAlgo || record.soloAlgo || '',
                soloAutoResponse: !!(req.body.soloAutoResponse || record.soloAutoResponse || ''),
                ecUrl: req.body.ecUrl || record.ecUrl || '',
                authorized: processAuthorized(req.body.authorized || record.authorized || ''),
                ipizzaReceiverName: req.body.ipizzaReceiverName || record.ipizzaReceiverName || '',
                ipizzaReceiverAccount: req.body.ipizzaReceiverAccount || record.ipizzaReceiverAccount || '',
                action: 'modify',
                userCertificate: record.userCertificate,
                bank: req.body.bank || record.bank || '',
                banks: banks,
                validation: {}
            }
        });
    });
}

function serveDeleteProject(req, res) {

    if (!req.user || !req.user.username) {
        return res.redirect('/login');
    }

    let id = (req.params.project || req.query.project || '').toString();

    if (!id.match(/^[a-fA-F0-9]{24}$/)) {
        req.flash('error', 'Vigane makselahenduse identifikaator');
        res.redirect('/');
        return;
    }

    db.findOne('project', {
        _id: new ObjectID(id)
    }, (err, project) => {
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
        if (project.owner !== req.user.username && project.authorized.indexOf(req.user.username.toLowerCase().trim()) < 0) {
            req.flash('error', 'Sul ei ole õigusi selle makselahenduse kasutamiseks');
            res.redirect('/');
            return;
        }

        db.remove('project', {
            _id: new ObjectID(id)
        }, () => {
            console.log('trans:' + project.uid);
            db.remove('counter', {
                _id: 'trans:' + project.uid
            }, () => {
                db.remove('payment', {
                    project: id
                }, () => {
                    req.flash('success', util.format('Makselahendus nimega "%s" on kustutatud', project.name));
                    res.redirect('/projects');
                    return;
                });
            });
        });
    });
}

function serveProject(req, res) {
    if (!req.user || !req.user.username) {
        return res.redirect('/login');
    }

    let id = (req.params.project || req.query.project || '').toString(),
        pageNumber = Number(req.params.pageNumber || req.query.pageNumber) || 1;

    if (!id.match(/^[a-fA-F0-9]{24}$/)) {
        req.flash('error', 'Vigane makselahenduse identifikaator');
        res.redirect('/');
        return;
    }

    db.findOne('project', {
        _id: new ObjectID(id)
    }, (err, record) => {
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
        if (record.owner !== req.user.username && record.authorized.indexOf(req.user.username.toLowerCase().trim()) < 0) {
            req.flash('error', 'Sul ei ole õigusi selle makselahenduse kasutamiseks');
            res.redirect('/');
            return;
        }

        db.count('payment', {
            project: id
        }, (err, total) => {

            let pageCount = Math.ceil(total / config.pagingCount);

            if (pageNumber > pageCount) {
                pageNumber = pageCount || 1;
            }

            let start_index = (pageNumber - 1) * config.pagingCount;

            db.find('payment', {
                project: id
            }, {}, {
                sort: [
                    ['date', 'desc']
                ],
                limit: config.pagingCount,
                skip: start_index
            }, (err, records) => {
                if (err) {
                    req.flash('error', err.message || err || 'Andmebaasi viga');
                    res.redirect('/');
                    return;
                }

                serve(req, res, {
                    page: '/project',
                    values: {
                        project: record,
                        banks,
                        tab: req.params.tab || 'payments',
                        id: id,

                        start_index: start_index,
                        pageNumber,
                        pageCount,
                        pagePath: '/project/' + id + '/page',
                        paging: tools.paging(pageNumber, pageCount),
                        payments: (records || []).map((payment) => {
                            payment.date = moment(payment.date).calendar();
                            payment.amount = tools.formatCurrency(payment.amount, payment.currency || 'EUR');
                            payment.typeName = ({
                                'PAYMENT': 'Maksekorraldus',
                                'IDENTIFICATION': 'Autentimine'
                            })[payment.type] || '';
                            return payment;
                        }),
                        languages: tools.languageNames,
                        countries: tools.countryCodes,
                        labels: tools.processLabels
                    }
                });
            });
        });
    });
}

function servePayment(req, res) {
    let id = (req.params.payment || req.query.payment || '').toString();

    if (!req.user || !req.user.username) {
        return res.redirect('/login');
    }

    if (!req.user) {
        req.user = {};
    }

    if (!id.match(/^[a-fA-F0-9]{24}$/)) {
        req.flash('error', 'Vigane maksekorralduse identifikaator');
        res.redirect('/');
        return;
    }

    db.findOne('payment', {
        _id: new ObjectID(id)
    }, (err, payment) => {
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

        db.findOne('project', {
            _id: new ObjectID(payment.project)
        }, (err, project) => {
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

            if (project.owner !== req.user.username && project.authorized.indexOf(req.user.username.toLowerCase().trim()) < 0) {
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
                    title: config.title || (config.hostname || (req && req.headers && req.headers.host) || 'localhost').replace(/:\d+$/, '').toLowerCase().replace(/^./, (s) => {
                        return s.toUpperCase();
                    }),
                    proto: config.proto || 'http',
                    hostname: (config.hostname || (req && req.headers && req.headers.host) || 'localhost').replace(/:(80|443)$/, ''),
                    payment: payment,
                    project: project,
                    bank: banks[project.bank || 'ipizza'] || banks.ipizza,
                    signatureOrder: banklink.signatureOrder(payment.bank),
                    googleAnalyticsID: config.googleAnalyticsID
                });

            } else {
                serve(req, res, {
                    page: '/payment',
                    values: {
                        payment: payment,
                        project: project,
                        bank: banks[project.bank],

                        inspect: util.inspect.bind(util),

                        host: urllib.parse(payment.state === 'PAYED' ? payment.successTarget : (payment.state === 'REJECTED' ? payment.rejectTarget : payment.cancelTarget)).host,

                        date: moment(payment.date).calendar(),
                        amount: tools.formatCurrency(payment.amount, payment.currency || 'EUR'),
                        typeName: ({
                            'PAYMENT': 'Maksekorraldus',
                            'IDENTIFICATION': 'Autentimine'
                        })[payment.type] || '',

                        languages: tools.languageNames,
                        countries: tools.countryCodes,
                        labels: tools.processLabels
                    }
                });
            }
        });
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

    if (!req.user || !req.user.username) {
        return res.redirect('/login');
    }

    if (!id.match(/^[a-fA-F0-9]{24}$/)) {
        req.flash('error', 'Vigane makselahenduse identifikaator');
        res.redirect('/');
        return;
    }

    let urlPrefix = (config.proto || 'http') + '://' + (config.hostname || (req && req.headers && req.headers.host) || 'localhost').replace(/:(80|443)$/, '');
    let isAuth = req.params.type === 'auth';

    banklink.samplePayment(id, req.user.username, urlPrefix, isAuth, req.query, (err, paymentObj, charset) => {
        if (err) {
            req.flash('error', err.message);
            res.redirect('/');
            return;
        }

        let payment = {
                charset: charset,
                bank: paymentObj.bank.type,
                fields: Object.keys(paymentObj.fields).map(key => {
                    return {
                        key: key,
                        value: paymentObj.fields[key]
                    };
                }),
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
            title: config.title || (config.hostname || (req && req.headers && req.headers.host) || 'localhost').replace(/:\d+$/, '').toLowerCase().replace(/^./, s => s.toUpperCase()),
            proto: config.proto || 'http',
            hostname: (config.hostname || (req && req.headers && req.headers.host) || 'localhost').replace(/:(80|443)$/, ''),
            payment: payment,
            project: project,
            queryString: urllib.parse(req.originalUrl).search || '',
            query: req.query || {},
            bank: banks[project.bank || 'ipizza'] || banks.ipizza,
            signatureOrder: banklink.signatureOrder(payment.bank),
            googleAnalyticsID: config.googleAnalyticsID
        });

    });
}

/**
 * Serves login page (/login) of the website
 *
 * @param {Object} req HTTP Request object
 * @param {Object} req HTTP Response object
 */
function serveLogin(req, res) {
    serve(req, res, {
        page: '/login',
        values: {
            username: req.query.username || ''
        }
    });
}

/**
 * Serves logout page (/logout) of the website
 *
 * @param {Object} req HTTP Request object
 * @param {Object} req HTTP Response object
 */
function serveLogout(req, res) {
    req.flash('info', 'Oled välja logitud');
    req.logout();
    res.redirect('/');
}

function serveJoin(req, res) {
    serve(req, res, {
        page: '/join',
        values: {
            name: req.query.name || '',
            company: req.query.company || '',
            username: req.query.username || '',
            agreetos: !!(req.query.agreetos || ''),
            validation: {}
        }
    });
}

function serveProfile(req, res) {
    if (!req.user || !req.user.username) {
        return res.redirect('/login');
    }

    serve(req, res, {
        page: '/profile',
        values: {
            name: req.query.name || req.user.name || '',
            company: req.query.company || req.user.company || '',
            username: req.user.username || '',
            validation: {}
        }
    });
}

function handleKeys(req, res) {
    Object.keys(req.body).forEach(key => {
        req.body[key] = req.body[key].trim();

        if (key === 'commonName') {
            req.body[key] = punycode.toASCII(req.body[key].replace(/^https?:\/+/i, '').split('/').shift().toLowerCase().trim());
        }

        if (key === 'hash') {
            if (['sha1', 'md5', 'sha256'].indexOf(req.body[key].toLowerCase()) < 0) {
                req.body[key] = 'sha1';
            }
        }

        if (key === 'keyBitsize') {
            req.body[key] = Number(req.body[key].trim()) || 1024;
            if ([1024, 2048, 4096].indexOf(req.body[key]) < 0) {
                req.body[key] = 1024;
            }
        }

        if (key === 'emailAddress') {
            req.body[key] = req.body[key].replace(/@(.*)$/, (o, domain) => {
                return '@' + punycode.toASCII(domain.split('/').shift().toLowerCase().trim());
            });
        }

        if (typeof req.body[key] === 'string') {
            req.body[key] = removeDiacritics(req.body[key]);
        }

    });

    pem.createCSR(req.body, (err, keys) => {
        if (err) {
            req.flash('error', err && err.message || err);
            serve(req, res, {
                page: '/keys'
            });
            return;
        }

        let archive = new Packer({
                comment: 'Generated by https://pangalink.net/'
            }),
            chunks = [];

        archive.on('error', err => {
            req.flash('error', err && err.message || err);
            serve(req, res, {
                page: '/keys'
            });
        });

        archive.on('data', chunk => {
            if (chunk && chunk.length) {
                chunks.push(chunk);
            }
            return true;
        });

        archive.on('end', chunk => {
            if (chunk && chunk.length) {
                chunks.push(chunk);
            }

            res.status(200);
            res.set('Content-Description', 'File Transfer');
            res.set('Content-Type', 'application/octet-stream');
            res.set('Content-Disposition', util.format('attachment; filename="%s"', 'banklink.zip'));

            res.send(Buffer.concat(chunks));
        });

        archive.entry(keys.clientKey, {
            name: 'private_key.pem'
        }, err => {
            if (err) {
                req.flash('error', err && err.message || err);
                serve(req, res, {
                    page: '/keys'
                });
                return;
            }

            archive.entry(keys.csr, {
                name: 'csr.pem'
            }, err => {
                if (err) {
                    req.flash('error', err && err.message || err);
                    serve(req, res, {
                        page: '/keys'
                    });
                    return;
                }

                archive.finish();
            });
        });
    });
}

function handleJoin(req, res) {

    let validationErrors = {},
        error = false;

    req.body.name = (req.body.name || '').toString().trim();
    req.body.company = (req.body.company || '').toString().trim();

    if (!req.body.name) {
        error = true;
        validationErrors.name = 'Nime täitmine on kohustuslik';
    }

    if (!req.body.company) {
        error = true;
        validationErrors.company = 'Ettevõtte nimie täitmine on kohustuslik';
    }

    if (!req.body.username) {
        error = true;
        validationErrors.username = 'E-posti aadressi täitmine on kohustuslik';
    }

    if (!req.body.password) {
        error = true;
        validationErrors.password = 'Parooli täitmine on kohustuslik';
    }

    if (req.body.password && !req.body.password2) {
        error = true;
        validationErrors.password2 = 'Parooli korudse täitmine on kohustuslik';
    }

    if (req.body.password && req.body.password2 && req.body.password !== req.body.password2) {
        error = true;
        validationErrors.password2 = 'Paroolid ei kattu';
    }

    req.body.agreetos = !!(req.body.agreetos || '');

    if (!req.body.agreetos) {
        error = true;
        validationErrors.agreetos = 'Konto loomiseks peab nõustuma kasutustingimustega';
    }

    if (error) {
        req.flash('error', 'Andmete valideerimisel ilmnesid vead');
        serve(req, res, {
            page: '/join',
            values: {
                name: req.body.name || '',
                company: req.body.company || '',
                username: req.body.username || '',
                agreetos: !!(req.body.agreetos || ''),
                validation: validationErrors
            }
        });
        return;
    }

    auth.addUser(req.body.username, req.body.password, {
        name: req.body.name,
        company: req.body.company,
        agreetos: !!(req.body.agreetos || '')
    }, (err, user, options) => {
        if (err) {
            req.flash('error', 'Andmebaasi viga');
            serve(req, res, {
                page: '/join',
                values: {
                    name: req.body.name || '',
                    company: req.body.company || '',
                    username: req.body.username || '',
                    agreetos: !!(req.body.agreetos || ''),
                    validation: validationErrors
                }
            });
            return;
        }
        if (!user) {
            validationErrors.username = options.message || 'Ei õnnestunud kasutajat luua';
            serve(req, res, {
                page: '/join',
                values: {
                    name: req.body.name || '',
                    company: req.body.company || '',
                    username: req.body.username || '',
                    agreetos: !!(req.body.agreetos || ''),
                    validation: validationErrors
                }
            });
            return;
        }

        req.login(user, err => {
            if (err) {
                req.flash('info', 'Kasutaja on loodud, kuid automaatne sisselogimine ebaõnnestus');
                return res.redirect('/');
            }
            req.flash('success', 'Kasutaja on loodud ning oled nüüd sisse logitud');
            return res.redirect('/add-project');
        });
    });
}

function handleProfile(req, res) {
    if (!req.user || !req.user.username) {
        return res.redirect('/login');
    }

    let validationErrors = {},
        error = false;

    req.body.name = (req.body.name || '').toString().trim();
    req.body.company = (req.body.company || '').toString().trim();

    if (!req.body.name) {
        error = true;
        validationErrors.name = 'Nime täitmine on kohustuslik';
    }

    if (!req.body.company) {
        error = true;
        validationErrors.company = 'Ettevõtte nimie täitmine on kohustuslik';
    }


    if (req.body.password && !req.body.password2) {
        error = true;
        validationErrors.password2 = 'Parooli korudse täitmine on parooli vahetamisel kohustuslik';
    }

    if (req.body.password && req.body.password2 && req.body.password !== req.body.password2) {
        error = true;
        validationErrors.password2 = 'Paroolid ei kattu';
    }

    if (error) {
        req.flash('error', 'Andmete valideerimisel ilmnesid vead');
        serve(req, res, {
            page: '/profile',
            values: {
                name: req.body.name || '',
                company: req.body.company || '',
                username: req.user.username || '',
                validation: validationErrors
            }
        });
        return;
    }

    auth.updateUser(req.user.username, req.body.password || undefined, {
        name: req.body.name,
        company: req.body.company
    }, (err, user, options) => {
        if (err) {
            req.flash('error', 'Andmebaasi viga');
            serve(req, res, {
                page: '/profile',
                values: {
                    name: req.body.name || '',
                    company: req.body.company || '',
                    username: req.user.username || '',
                    validation: validationErrors
                }
            });
            return;
        }
        if (!user) {
            validationErrors.username = options.message || 'Ei õnnestunud kasutaja profiili uuendada';
            serve(req, res, {
                page: '/profile',
                values: {
                    name: req.body.name || '',
                    company: req.body.company || '',
                    username: req.user.username || '',
                    validation: validationErrors
                }
            });
            return;
        }

        req.flash('success', 'Profiili andmed on uuendatud');
        return res.redirect('/profile');
    });
}


function handleResetLink(req, res) {
    let validationErrors = {},
        error = false;

    if (!req.body.username) {
        error = true;
        validationErrors.username = 'E-posti aadress on määramata';
    }

    if (error) {
        req.flash('error', 'Andmete valideerimisel ilmnesid vead');
        serve(req, res, {
            page: '/reset-link',
            values: {
                username: req.body.username || '',
                validation: validationErrors
            }
        });
        return;
    }

    auth.initializeResetPassword(req.body.username, err => {
        if (err) {
            req.flash('error', 'Andmebaasi viga');
            serve(req, res, {
                page: '/reset-link',
                values: {
                    name: req.body.name || '',
                    company: req.body.company || '',
                    username: req.body.username || '',
                    validation: validationErrors
                }
            });
            return;
        }

        req.flash('info', 'Parooli muutmise link saadeti valitud e-posti aadressile');
        return res.redirect('/login');
    });
}


function handleResetPassword(req, res) {
    auth.resetPassword(req.body.username, req.body.resetToken, (err, status, options) => {
        if (err) {
            req.flash('error', 'Andmebaasi viga');
            return res.redirect('/login');
        }

        if (!status) {
            req.flash('error', options && options.message || 'Parooli vahetamine ebaõnnestus');
            return res.redirect('/login');
        }

        req.flash('info', 'Uus parool saadeti valitud e-posti aadressile');
        return res.redirect('/login');
    });
}

function handleAddProject(req, res) {
    if (!req.user || !req.user.username) {
        return res.redirect('/login');
    }

    let validationErrors = {},
        error = false;

    req.body.id = (req.body.id || '').toString().trim();
    req.body.name = (req.body.name || '').toString().trim();
    req.body.description = (req.body.description || '').toString().trim();
    req.body.bank = (req.body.bank || '').toString().trim();

    req.body.keyBitsize = Number(req.body.keyBitsize) || 1024;

    req.body.soloAlgo = (req.body.soloAlgo || '').toString().toLowerCase().trim();
    req.body.soloAutoResponse = !!((req.body.soloAutoResponse || '').toString().trim());

    req.body.ecUrl = (req.body.ecUrl || '').toString().trim();
    req.body.authorized = processAuthorized(req.body.authorized || '');

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

    if (['nordea', 'tapiola', 'alandsbanken', 'handelsbanken', 'aktiasppop'].indexOf(req.body.bank) >= 0 && (!req.body.soloAlgo || ['md5', 'sha1', 'sha256'].indexOf(req.body.soloAlgo) < 0)) {
        error = true;
        validationErrors.soloAlgo = 'Vigane algoritm';
    }

    if (req.body.bank === 'ec' && (!req.body.ecUrl || !tools.validateUrl(req.body.ecUrl))) {
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
        serve(req, res, {
            page: '/add-project',
            values: {
                name: req.body.name || '',
                description: req.body.description || '',
                keyBitsize: Number(req.body.keyBitsize) || 1024,
                soloAlgo: req.body.soloAlgo || '',
                soloAutoResponse: !!(req.body.soloAutoResponse || ''),
                ecUrl: req.body.ecUrl || '',
                authorized: processAuthorized(req.body.authorized || ''),
                ipizzaReceiverName: req.body.ipizzaReceiverName || '',
                ipizzaReceiverAccount: req.body.ipizzaReceiverAccount || '',
                id: req.body.id || '',
                action: 'add',
                bank: req.body.bank || '',
                banks: banks,
                validation: validationErrors
            }
        });
        return;
    }

    tools.generateKeys(req.user, 20 * 365, Number(req.body.keyBitsize) || 1024, (err, userCertificate, bankCertificate) => {
        if (err) {
            req.flash('error', 'Sertifikaadi genereerimisel tekkis viga');
            serve(req, res, {
                page: '/add-project',
                values: {
                    name: req.body.name || '',
                    description: req.body.description || '',
                    id: req.body.id || '',
                    keyBitsize: Number(req.body.keyBitsize) || 1024,
                    soloAlgo: req.body.soloAlgo || '',
                    soloAutoResponse: !!(req.body.soloAutoResponse || ''),
                    bank: req.body.bank || '',
                    banks: banks,
                    ecUrl: req.body.ecUrl || '',
                    authorized: processAuthorized(req.body.authorized || ''),
                    ipizzaReceiverName: req.body.ipizzaReceiverName || '',
                    ipizzaReceiverAccount: req.body.ipizzaReceiverAccount || '',
                    action: 'add',
                    validation: validationErrors
                }
            });
            return;
        }

        let project = {
            name: req.body.name,
            description: req.body.description,
            owner: req.user.username,
            keyBitsize: req.body.keyBitsize,
            soloAlgo: req.body.soloAlgo,
            soloAutoResponse: !!(req.body.soloAutoResponse || ''),
            bank: req.body.bank,
            ecUrl: req.body.ecUrl,
            authorized: processAuthorized(req.body.authorized),
            ipizzaReceiverName: req.body.ipizzaReceiverName,
            ipizzaReceiverAccount: req.body.ipizzaReceiverAccount,
            created: new Date(),
            userCertificate: userCertificate,
            bankCertificate: bankCertificate,
            secret: randomString({
                length: 32
            })
        };

        tools.incrIdCounter((err, id) => {
            if (err) {
                req.flash('error', 'Andmebaasi viga');
                serve(req, res, {
                    page: '/add-project',
                    values: {
                        name: req.body.name || '',
                        description: req.body.description || '',
                        id: req.body.id || '',
                        keyBitsize: Number(req.body.keyBitsize) || 1024,
                        soloAlgo: req.body.soloAlgo || '',
                        soloAutoResponse: !!(req.body.soloAutoResponse || ''),
                        bank: req.body.bank || '',
                        banks: banks,
                        ecUrl: req.body.ecUrl || '',
                        authorized: processAuthorized(req.body.authorized || ''),
                        ipizzaReceiverName: req.body.ipizzaReceiverName || '',
                        ipizzaReceiverAccount: req.body.ipizzaReceiverAccount || '',
                        action: 'add',
                        validation: validationErrors
                    }
                });
                return;
            }

            if (['nordea', 'tapiola', 'alandsbanken', 'handelsbanken', 'aktiasppop'].indexOf(req.body.bank) >= 0) {
                project.uid = (10000000 + Number(tools.getReferenceCode(id))).toString();
            } else {
                project.uid = 'uid' + tools.getReferenceCode(id);
            }

            db.save('project', project, (err, id) => {
                if (err) {
                    req.flash('error', 'Andmebaasi viga');
                    serve(req, res, {
                        page: '/add-project',
                        values: {
                            name: req.body.name || '',
                            description: req.body.description || '',
                            id: req.body.id || '',
                            keyBitsize: Number(req.body.keyBitsize) || 1024,
                            soloAlgo: req.body.soloAlgo || '',
                            soloAutoResponse: !!(req.body.soloAutoResponse || ''),
                            bank: req.body.bank || '',
                            banks: banks,
                            ecUrl: req.body.ecUrl || '',
                            authorized: processAuthorized(req.body.authorized || ''),
                            ipizzaReceiverName: req.body.ipizzaReceiverName || '',
                            ipizzaReceiverAccount: req.body.ipizzaReceiverAccount || '',
                            action: 'add',
                            validation: validationErrors
                        }
                    });
                    return;
                }
                console.log(err || id);
                if (id) {
                    req.flash('success', 'Makselahendus on loodud');
                    res.redirect('/project/' + id.toString() + '/certs');
                } else {
                    req.flash('error', 'Makselahenduse loomine ebaõnnestus');
                    serve(req, res, {
                        page: '/add-project',
                        values: {
                            name: req.body.name || '',
                            description: req.body.description || '',
                            id: req.body.id || '',
                            keyBitsize: Number(req.body.soloAlgo) || 1024,
                            soloAlgo: req.body.soloAlgo || '',
                            soloAutoResponse: !!(req.body.soloAutoResponse || ''),
                            bank: req.body.bank || '',
                            banks: banks,
                            ecUrl: req.body.ecUrl || '',
                            authorized: processAuthorized(req.body.authorized || ''),
                            ipizzaReceiverName: req.body.ipizzaReceiverName || '',
                            ipizzaReceiverAccount: req.body.ipizzaReceiverAccount || '',
                            action: 'add',
                            validation: validationErrors
                        }
                    });
                    return;
                }
            });
        });
    });
}

function handleEditProject(req, res) {
    if (!req.user || !req.user.username) {
        return res.redirect('/login');
    }

    let validationErrors = {},
        error = false;

    req.body.id = (req.body.id || '').toString().trim();
    req.body.name = (req.body.name || '').toString().trim();
    req.body.description = (req.body.description || '').toString().trim();

    req.body.keyBitsize = Number(req.body.keyBitsize) || 1024;

    req.body.soloAlgo = (req.body.soloAlgo || '').toString().toLowerCase().trim();
    req.body.soloAutoResponse = !!((req.body.soloAutoResponse || '').toString().trim());

    req.body.ecUrl = (req.body.ecUrl || '').toString().trim();
    req.body.authorized = processAuthorized(req.body.authorized);

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

    db.findOne('project', {
        _id: new ObjectID(req.body.id)
    }, (err, record) => {
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
        if (record.owner !== req.user.username && record.authorized.indexOf(req.user.username.toLowerCase().trim()) < 0) {
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

        if (record.bank === 'ec' && (!req.body.ecUrl || !tools.validateUrl(req.body.ecUrl))) {
            error = true;
            validationErrors.ecUrl = 'Vigane tagasisuunamise aadress, peab olema korrektne URL';
        }

        if (req.body.ipizzaReceiverAccount && req.body.ipizzaReceiverAccount !== record.ipizzaReceiverAccount && !IBAN.isValid(req.body.ipizzaReceiverAccount)) {
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
            serve(req, res, {
                page: '/edit-project',
                values: {
                    name: req.body.name || '',
                    description: req.body.description || '',
                    id: req.body.id || '',
                    keyBitsize: Number(req.body.keyBitsize) || 1024,
                    soloAlgo: req.body.soloAlgo || '',
                    soloAutoResponse: !!(req.body.soloAutoResponse || ''),
                    ecUrl: req.body.ecUrl || '',
                    authorized: processAuthorized(req.body.authorized || ''),
                    ipizzaReceiverName: req.body.ipizzaReceiverName || '',
                    ipizzaReceiverAccount: req.body.ipizzaReceiverAccount || '',
                    action: 'modify',
                    bank: req.body.bank || '',
                    banks: banks,
                    userCertificate: record.userCertificate,
                    validation: validationErrors
                }
            });
            return;
        }

        tools.generateKeys(req.user, 20 * 365, Number(req.body.keyBitsize) || 1024, (err, userCertificate, bankCertificate) => {
            if (err && req.body.regenerate) {
                req.flash('error', 'Sertifikaadi genereerimisel tekkis viga');
                serve(req, res, {
                    page: '/edit-project',
                    values: {
                        name: req.body.name || '',
                        description: req.body.description || '',
                        id: req.body.id || '',
                        keyBitsize: Number(req.body.keyBitsize) || 1024,
                        soloAlgo: req.body.soloAlgo || '',
                        soloAutoResponse: !!(req.body.soloAutoResponse || ''),
                        ecUrl: req.body.ecUrl || '',
                        authorized: processAuthorized(req.body.authorized || ''),
                        ipizzaReceiverName: req.body.ipizzaReceiverName || '',
                        ipizzaReceiverAccount: req.body.ipizzaReceiverAccount || '',
                        action: 'modify',
                        bank: req.body.bank || '',
                        banks: banks,
                        userCertificate: record.userCertificate,
                        validation: validationErrors
                    }
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
            record.authorized = processAuthorized(req.body.authorized || '');
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
                    serve(req, res, {
                        page: '/edit-project',
                        values: {
                            name: req.body.name || '',
                            description: req.body.description || '',
                            id: req.body.id || '',
                            keyBitsize: Number(req.body.keyBitsize) || 1024,
                            soloAlgo: req.body.soloAlgo || '',
                            soloAutoResponse: !!(req.body.soloAutoResponse || ''),
                            ecUrl: req.body.ecUrl || '',
                            authorized: processAuthorized(req.body.authorized || ''),
                            ipizzaReceiverName: req.body.ipizzaReceiverName || '',
                            ipizzaReceiverAccount: req.body.ipizzaReceiverAccount || '',
                            action: 'modify',
                            bank: req.body.bank || '',
                            banks: banks,
                            userCertificate: record.userCertificate,
                            validation: validationErrors
                        }
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
                    serve(req, res, {
                        page: '/edit-project',
                        values: {
                            name: req.body.name || '',
                            description: req.body.description || '',
                            id: req.body.id || '',
                            keyBitsize: Number(req.body.keyBitsize) || 1024,
                            soloAlgo: req.body.soloAlgo || '',
                            soloAutoResponse: !!(req.body.soloAutoResponse || ''),
                            ecUrl: req.body.ecUrl || '',
                            authorized: processAuthorized(req.body.authorized || ''),
                            ipizzaReceiverName: req.body.ipizzaReceiverName || '',
                            ipizzaReceiverAccount: req.body.ipizzaReceiverAccount || '',
                            action: 'modify',
                            bank: req.body.bank || '',
                            banks: banks,
                            userCertificate: record.userCertificate,
                            validation: validationErrors
                        }
                    });
                    return;
                }
            });
        });
    });
}

function serveKey(req, res) {
    if (!req.user || !req.user.username) {
        return res.redirect('/login');
    }

    let id = (req.params.project || '').toString().trim();

    if (!id.match(/^[a-fA-F0-9]{24}$/)) {
        req.flash('error', 'Vigane makselahenduse identifikaator');
        res.redirect('/');
        return;
    }

    db.findOne('project', {
        _id: new ObjectID(id)
    }, (err, record) => {
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
        if (record.owner !== req.user.username && record.authorized.indexOf(req.user.username.toLowerCase().trim()) < 0) {
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
    });
}

function handleRegenerateProjectCertificate(req, res) {
    if (!req.user || !req.user.username) {
        return res.redirect('/login');
    }

    let id = (req.params.project || '').toString().trim();

    if (!id.match(/^[a-fA-F0-9]{24}$/)) {
        req.flash('error', 'Vigane makselahenduse identifikaator');
        res.redirect('/');
        return;
    }

    db.findOne('project', {
        _id: new ObjectID(id)
    }, (err, record) => {
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
        if (record.owner !== req.user.username && record.authorized.indexOf(req.user.username.toLowerCase().trim()) < 0) {
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
    });
}

function servePaymentFinal(req, res) {
    let id = (req.params.payment || req.body.payment || req.query.payment || '').toString();

    if (!id.match(/^[a-fA-F0-9]{24}$/)) {
        req.flash('error', 'Vigane maksekorralduse identifikaator');
        res.redirect('/');
        return;
    }

    banklink.makePayment(id, req.body, req.user, (err, data) => {
        if (err) {
            req.flash('error', err.message || err);
            res.redirect(err.redirectUrl || '/');
            return;
        }

        db.findOne('user', {
            id: data.project.owner
        }, (err, user) => {
            if (err) {
                req.flash('error', err.message || err || 'Andmebaasi viga');
                res.redirect('/');
                return;
            }

            res.forceCharset = data.forceCharset;
            res.set('content-type', 'text/html; charset=' + res.forceCharset);

            data.title = config.title || (config.hostname || (req && req.headers && req.headers.host) || 'localhost').replace(/:\d+$/, '').toLowerCase().replace(/^./, s => s.toUpperCase());
            data.proto = config.proto || 'http';
            data.hostname = config.hostname || (req && req.headers && req.headers.host) || 'localhost';
            data.googleAnalyticsID = config.googleAnalyticsID;
            data.user = user;
            data.accountInfo = accountInfo;

            res.render('banklink/final', data);
        });
    });
}

function serveDocs(req, res) {
    tools.renderDocs(req.params.name, (err, content) => {
        if (err) {
            req.flash('error', err.message || err || 'Dokumentatsiooni viga');
            res.redirect('/');
            return;
        }
        serve(req, res, {
            page: '/docs',
            name: req.params.name,
            values: {
                content: content
            }
        });
    });
}

function serve(req, res, options) {
    if (typeof options === 'string') {
        options = {
            page: options
        };
    }

    options = options || {};
    options.status = options.status || 200;
    options.contentType = options.contentType || 'text/html';
    options.page = options.page || '/';
    options.title = options.title || false;

    let defaultValues = {
            title: config.title || (config.hostname || (req && req.headers && req.headers.host) || 'localhost').replace(/:\d+$/, '').toLowerCase().replace(/^./, s => s.toUpperCase()),
            proto: config.proto || 'http',
            hostname: (config.hostname || (req && req.headers && req.headers.host) || 'localhost').replace(/:(80|443)$/, ''),
            messages: {
                success: req.flash('success'),
                error: req.flash('error'),
                info: req.flash('info')
            },
            pageTitle: options.title,
            page: options.page,
            name: options.name || '',
            user: req.user,
            accountInfo: accountInfo,
            googleAnalyticsID: config.googleAnalyticsID
        },
        localValues = options.values || {};

    Object.keys(defaultValues).forEach(key => {
        if (!(key in localValues)) {
            localValues[key] = defaultValues[key];
        }
    });

    res.status(options.status);
    res.set('Content-Type', options.contentType);
    res.render('index', localValues);
}

function processAuthorized(authorized) {
    let lines;
    if (!Array.isArray(authorized)) {
        authorized = (authorized || '').toString().trim();
        lines = authorized.split('\n');
    } else {
        lines = authorized;
    }

    let result = [];
    lines.forEach(line => {
        line = line.toLowerCase().trim();
        if (line && result.indexOf(line) < 0) {
            result.push(line);
        }
    });

    result.sort((a, b) => {
        let partsA = a.split('@'),
            partsB = b.split('@');

        if (partsA[1] !== partsB[1]) {
            return partsA[1].localeCompare(partsB[1]);
        } else {
            return partsA[0].localeCompare(partsB[0]);
        }
    });

    return result;
}

// API related functions

function apiResponse(req, res, err, data) {
    let response = {};

    if (err) {
        response.success = false;
        response.error = err.message || err;

        if (err.fields) {
            response.fields = err.fields;
        }
    } else {
        response.success = true;
        response.data = data;
    }

    res.status(200);
    res.set('Content-Type', 'application/json; charset=utf-8');

    res.end(JSON.stringify(response, null, '    ') + '\n');
}

function serveAPIListBanks(req, res) {
    let accessToken = (req.query.access_token || req.headers.access_token || '').toString().trim();

    apiAuthorizeToken(req, accessToken, err => {
        if (err) {
            return apiResponse(req, res, err);
        }

        apiResponse(req, res, false, Object.keys(banks).sort().map(bank => {
            return {
                type: bank,
                name: banks[bank].name
            };
        }));
    });
}

function serveAPIListProject(req, res) {
    let accessToken = (req.query.access_token || req.headers.access_token || '').toString().trim(),
        start = Number((req.query.start_index || '0').toString().trim()) || 0;

    apiAuthorizeToken(req, accessToken, (err, user) => {
        if (err) {
            return apiResponse(req, res, err);
        }

        apiActionList(req, user, start, (err, list) => {
            if (err) {
                return apiResponse(req, res, err);
            }
            apiResponse(req, res, false, list);
        });
    });
}

function serveAPIGetProject(req, res) {
    let accessToken = (req.query.access_token || req.headers.access_token || '').toString().trim(),
        projectId = (req.params.project || '').toString().trim();

    apiAuthorizeToken(req, accessToken, (err, user) => {
        if (err) {
            return apiResponse(req, res, err);
        }

        apiActionGet(req, user, projectId, (err, project) => {
            if (err) {
                return apiResponse(req, res, err);
            }
            apiResponse(req, res, false, project);
        });
    });
}

function serveAPIPostProject(req, res) {
    let accessToken = (req.query.access_token || req.headers.access_token || '').toString().trim();

    apiAuthorizeToken(req, accessToken, (err, user) => {
        if (err) {
            return apiResponse(req, res, err);
        }

        let project;

        try {
            project = JSON.parse(req.rawBody.toString('utf-8'));
        } catch (E) {
            return apiResponse(req, res, new Error('Vigane sisend'));
        }

        apiActionPost(req, user, project, (err, projectId) => {
            if (err) {
                return apiResponse(req, res, err);
            }
            apiActionGet(req, user, projectId, (err, project) => {
                if (err) {
                    return apiResponse(req, res, err);
                }
                apiResponse(req, res, false, project);
            });
        });
    });
}

function serveAPIDeleteProject(req, res) {
    let accessToken = (req.query.access_token || req.headers.access_token || '').toString().trim(),
        projectId = (req.params.project || '').toString().trim();

    apiAuthorizeToken(req, accessToken, (err, user) => {
        if (err) {
            return apiResponse(req, res, err);
        }

        apiActionDelete(req, user, projectId, (err, deleted) => {
            if (err) {
                return apiResponse(req, res, err);
            }
            apiResponse(req, res, false, deleted);
        });
    });
}

function apiAuthorizeToken(req, accessToken, callback) {
    accessToken = (accessToken || '').toString().trim();

    if (!accessToken.match(/^[a-fA-F0-9]+$/)) {
        return callback(new Error('Vigane API võti'));
    }

    db.findOne('user', {
        token: accessToken
    }, callback);
}

function apiActionGet(req, user, projectId, callback) {

    projectId = (projectId || '').toString().trim();

    if (!user) {
        return callback(new Error('Määramata kasutaja'));
    }

    if (!projectId.match(/^[a-fA-F0-9]{24}$/)) {
        return callback(new Error('Vigane makselahenduse identifikaator'));
    }

    db.findOne('project', {
        _id: new ObjectID(projectId)
    }, (err, project) => {
        let responseObject = {};
        if (err) {
            return callback(err || new Error('Andmebaasi viga'));
        }

        if (!project) {
            return callback(new Error('Sellise identifikaatoriga makselahendust ei leitud'));
        }

        if (project.owner !== user.username && project.authorized.indexOf(user.username.toLowerCase().trim()) < 0) {
            return callback(new Error('Sul ei ole õigusi selle makselahenduse kasutamiseks'));
        }

        responseObject.id = project._id.toString();
        responseObject.client_id = project.uid.toString();
        responseObject.payment_url = 'https://' + config.hostname + '/banklink/' + project.bank;
        responseObject.type = project.bank;
        responseObject.name = project.name || undefined;
        responseObject.description = project.description || undefined;

        if (banks[project.bank].type === 'ipizza') {
            responseObject.account_owner = project.ipizzaReceiverName || undefined;
            responseObject.account_nr = project.ipizzaReceiverAccount || undefined;
        }

        if (['ipizza', 'ec'].indexOf(banks[project.bank].type) >= 0) {
            responseObject.key_size = project.keyBitsize || undefined;
            responseObject.private_key = project.userCertificate.clientKey;
            responseObject.bank_certificate = project.bankCertificate.certificate;
        }

        if (banks[project.bank].type === 'ec') {
            responseObject.return_url = project.ecUrl || undefined;
        }

        if (banks[project.bank].type === 'solo') {
            responseObject.mac_key = project.secret || undefined;
            responseObject.algo = project.soloAlgo || undefined;
            responseObject.auto_response = !!project.soloAutoResponse;
        }

        if (['aab', 'samlink'].indexOf(banks[project.bank].type) >= 0) {
            responseObject.mac_key = project.secret || undefined;
            responseObject.algo = project.soloAlgo || 'md5';
        }

        return callback(null, responseObject);
    });
}

function apiActionList(req, user, start, callback) {

    start = start || 0;

    if (!user) {
        return callback(new Error('Määramata kasutaja'));
    }

    let query = {
        $or: [{
            owner: user.username
        }, {
            authorized: user.username.toLowerCase().trim()
        }]
    };

    db.count('project', query, (err, total) => {
        if (start > total) {
            start = Math.floor(total / 20) * 20;
        }
        if (start < 0) {
            start = 0;
        }
        db.find('project', query, {
            _id: true,
            name: true,
            bank: true
        }, {
            sort: [
                ['created', 'desc']
            ],
            limit: 20,
            skip: start
        }, (err, records) => {
            if (err) {
                return callback(err);
            }

            let list = [].concat(records || []).map(record => ({
                id: record._id.toString(),
                name: record.name || undefined,
                type: record.bank
            }));

            callback(null, {
                total: total,
                start_index: start,
                end_index: start + list.length - 1,
                list: list
            });
        });
    });
}


function apiActionPost(req, user, project, callback) {

    if (!user) {
        return callback(new Error('Määramata kasutaja'));
    }

    let validationErrors = {},
        error = false;

    project.type = (project.type || '').toString().trim();
    project.name = (project.name || '').toString().trim();
    project.description = (project.description || '').toString().trim();

    project.account_owner = (project.account_owner || '').toString().trim();
    project.account_nr = (project.account_nr || '').toString().trim();

    project.key_size = Number(project.key_size) || 1024;

    project.return_url = (project.return_url || '').toString().trim();

    project.algo = (project.algo || '').toString().toLowerCase().trim();
    if (typeof project.auto_response === 'string') {
        project.auto_response = (project.auto_response.toLowerCase().trim() === 'true');
    } else {
        project.auto_response = !!project.auto_response;
    }

    if (!project.name) {
        error = true;
        validationErrors.name = 'Makselahenduse nimetuse täitmine on kohustuslik';
    }

    if (!banks[project.type]) {
        error = true;
        validationErrors.type = 'Panga tüüp on valimata';
    }

    if (project.key_size && [1024, 2048, 4096].indexOf(project.key_size) < 0) {
        error = true;
        validationErrors.key_size = 'Vigane võtme pikkus';
    }

    if (project.type === 'nordea' && (!project.algo || ['md5', 'sha1', 'sha256'].indexOf(project.algo) < 0)) {
        error = true;
        validationErrors.algo = 'Vigane algoritm';
    }

    if (project.type === 'ec' && (!project.return_url || !tools.validateUrl(project.return_url))) {
        error = true;
        validationErrors.return_url = 'Vigane tagasisuunamise aadress, peab olema korrektne URL';
    }

    if (project.type !== 'nordea') {
        project.algo = '';
        project.auto_return = false;
    }

    if (project.type !== 'ec') {
        project.return_url = '';
    }

    if (error) {
        error = new Error('Andmete valideerimisel ilmnesid vead');
        error.fields = validationErrors;
        return callback(error);
    }

    tools.generateKeys(user, 20 * 365, Number(project.key_size) || 1024, (err, userCertificate, bankCertificate) => {
        if (err) {
            return callback(new Error('Sertifikaadi genereerimisel tekkis viga'));
        }

        let record = {
            name: project.name,
            description: project.description,
            owner: user.username,
            keyBitsize: project.key_size,
            soloAlgo: project.algo,
            soloAutoResponse: !!project.auto_response,
            bank: project.type,
            ecUrl: project.return_url,
            authorized: processAuthorized(''),
            ipizzaReceiverName: project.account_owner,
            ipizzaReceiverAccount: project.account_nr,
            created: new Date(),
            userCertificate: userCertificate,
            bankCertificate: bankCertificate,
            secret: randomString({
                length: 32
            })
        };

        tools.incrIdCounter((err, id) => {
            if (err) {
                return callback(new Error('Andmebaasi viga'));
            }

            if (['nordea', 'tapiola', 'alandsbanken', 'handelsbanken', 'aktiasppop'].indexOf(req.body.bank) >= 0) {
                record.uid = (10000000 + Number(tools.getReferenceCode(id))).toString();
            } else {
                record.uid = 'uid' + tools.getReferenceCode(id);
            }

            db.save('project', record, (err, id) => {
                if (err) {
                    return callback(new Error('Andmebaasi viga'));
                }
                if (id) {
                    return callback(null, id.toString());
                } else {
                    return callback(new Error('Makselahenduse loomine ebaõnnestus'));
                }
            });
        });
    });
}

function apiActionDelete(req, user, projectId, callback) {

    projectId = (projectId || '').toString().trim();

    if (!user) {
        return callback(new Error('Määramata kasutaja'));
    }

    if (!projectId.match(/^[a-fA-F0-9]{24}$/)) {
        return callback(new Error('Vigane makselahenduse identifikaator'));
    }

    db.findOne('project', {
        _id: new ObjectID(projectId)
    }, (err, project) => {
        if (err) {
            return callback(err || new Error('Andmebaasi viga'));
        }

        if (!project) {
            return callback(new Error('Sellise identifikaatoriga makselahendust ei leitud'));
        }

        if (project.owner !== user.username && project.authorized.indexOf(user.username.toLowerCase().trim()) < 0) {
            return callback(new Error('Sul ei ole õigusi selle makselahenduse kasutamiseks'));
        }


        db.remove('project', {
            _id: new ObjectID(projectId)
        }, err => {
            if (err) {
                return callback(err);
            }

            console.log('trans:' + project.uid);
            db.remove('counter', {
                _id: 'trans:' + project.uid
            }, () => {

                db.remove('payment', {
                    project: projectId
                }, () => {
                    return callback(null, true);
                });
            });
        });
    });
}
