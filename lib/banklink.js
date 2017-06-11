'use strict';

const config = require('config');
const tools = require('./tools');
const util = require('util');
const db = require('./db');
const ObjectID = require('mongodb').ObjectID;
const encoding = require('encoding');
const banks = require('./banks.json');
const bankObjects = {
    ipizza: require('./banks/ipizza'),
    solo: require('./banks/solo'),
    aab: require('./banks/aab'),
    samlink: require('./banks/samlink'),
    ec: require('./banks/ec')
};
const accountInfo = require('./account');

module.exports.serveBanklink = serveBanklink;
module.exports.handlePayment = handlePayment;
module.exports.servePaymentPreview = servePaymentPreview;
module.exports.makePayment = makePayment;

module.exports.samplePayment = function(projectId, userId, urlPrefix, isAuth, options, callback) {
    db.findOne(
        'project',
        {
            _id: new ObjectID(projectId)
        },
        (err, project) => {
            if (err) {
                return callback(err);
            }

            if (!project) {
                return callback(new Error('Sellise identifikaatoriga makselahendust ei leitud'));
            }

            if (userId && project.owner !== userId && project.authorized.indexOf(userId.toLowerCase().trim()) < 0) {
                return callback(new Error('Sul ei ole õigusi selle makselahenduse kasutamiseks'));
            }

            let method = isAuth && typeof bankObjects[banks[project.bank].type].sampleAuth === 'function' ? 'sampleAuth' : 'samplePayment';

            bankObjects[banks[project.bank].type][method](project, urlPrefix, options || {}, callback);
        }
    );
};

module.exports.signatureOrder = function(bankType) {
    return (bankObjects[bankType] && bankObjects[bankType].signatureOrder) || [];
};

function serveBanklink(req, res) {
    let errors = [],
        warnings = [];

    if (req.method !== 'POST' && !(req.banklink && req.banklink.bank && req.banklink.bank.allowGet && req.method === 'GET')) {
        errors.push(
            util.format('Lubatud on ainult POST päringud. Kontrolli kas kasutad õiget domeeni %s või toimub vahepeal ümbersuunamine.', config.hostname)
        );
        return serveErrors(req, res, errors);
    }

    if (req.method === 'GET') {
        warnings.push({
            warning: util.format('Kasutad GET päringut mis ei ole soovitatav. Kindlam oleks kasutada alati POST päringuid')
        });
    }

    if (!req.banklink) {
        errors.push('Päringu sisust ei leitud pangalingi andmeid');
        return serveErrors(req, res, errors);
    }

    let project = new bankObjects[req.banklink.type](req.banklink.bank, req.body);

    project.validateClient((err, data) => {
        errors = errors.concat(data.errors || []);
        warnings = warnings.concat(data.warnings || []);

        if (err) {
            errors = errors.concat(err.message || []);
            return logPayment(
                project,
                'ERROR',
                req,
                res,
                {
                    errors,
                    warnings
                },
                serveErrors.bind(this, req, res, errors, warnings)
            );
        }
        if (!data.success) {
            return logPayment(project, 'ERROR', req, res, data, serveErrors.bind(this, req, res, errors, warnings));
        }
        project.validateRequest((err, data) => {
            if (err) {
                return serveErrors(req, res, [err.message || err]);
            }

            errors = errors.concat(data.errors || []);
            warnings = warnings.concat(data.warnings || []);

            if (!data.success) {
                return logPayment(
                    project,
                    'ERROR',
                    req,
                    res,
                    {
                        errors,
                        warnings
                    },
                    serveErrors.bind(this, req, res, errors, warnings)
                );
            }

            project.validateSignature((err, data) => {
                if (err) {
                    return serveErrors(req, res, errors.concat(err.message || err));
                }

                errors = errors.concat(data.errors || []);
                warnings = warnings.concat(data.warnings || []);

                if (!data.success) {
                    return logPayment(
                        project,
                        'ERROR',
                        req,
                        res,
                        {
                            errors,
                            warnings
                        },
                        serveErrors.bind(this, req, res, errors, warnings)
                    );
                }

                data.errors = errors;
                data.warnings = warnings;

                logPayment(project, 'IN PROCESS', req, res, data, (err, id, payment) => {
                    id = (id || '').toString();
                    if (err) {
                        res.send(err.message);
                    } else if (req.body.PANGALINK_AUTOPAY) {
                        autoPay(req, res, id, payment);
                    } else {
                        req.params.payment = id;
                        servePaymentPreview(req, res);
                    }
                });
            });
        });
    });
}

function servePaymentPreview(req, res) {
    let id = (req.params.payment || req.query.payment || '').toString();

    if (!id.match(/^[a-fA-F0-9]{24}$/)) {
        req.flash('error', 'Vigane maksekorralduse identifikaator');
        res.redirect('/');
        return;
    }

    db.findOne(
        'payment',
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
                req.flash('error', 'Sellise identifikaatoriga maksekorraldust ei leitud');
                res.redirect('/');
                return;
            }

            if (record.state !== 'IN PROCESS') {
                req.flash('error', 'Seda maksekorraldust ei saa enam jätkata');
                res.redirect('/');
                return;
            }

            record.amount = tools.formatCurrency(record.amount, tools.currencies[record.currency] || record.currency);

            db.findOne(
                'project',
                {
                    _id: new ObjectID(record.project)
                },
                (err, project) => {
                    if (err) {
                        req.flash('error', err.message || err || 'Andmebaasi viga');
                        res.redirect('/');
                        return;
                    }

                    if (!project) {
                        req.flash('error', 'Maksekorraldust ei saa kuvada');
                        res.redirect('/');
                        return;
                    }

                    return res.render('banklink/preview', {
                        title:
                            config.title ||
                                (config.hostname || (req && req.headers && req.headers.host) || 'localhost')
                                    .replace(/:\d+$/, '')
                                    .toLowerCase()
                                    .replace(/^./, s => s.toUpperCase()),
                        proto: config.proto || 'http',
                        hostname: (config.hostname || (req && req.headers && req.headers.host) || 'localhost').replace(/:(80|443)$/, ''),
                        payment: record,
                        bank: banks[project.bank],
                        languages: tools.languageNames,
                        countries: tools.countryCodes,
                        project,
                        uid: req.user && req.user.username,
                        user: req.user,
                        accountInfo,
                        googleAnalyticsID: config.googleAnalyticsID
                    });
                }
            );
        }
    );
}

function autoPay(req, res, id, payment) {
    let ap = (req.body.PANGALINK_AUTOPAY || '').toString().trim().toLowerCase(),
        options = {
            pay: ap === 'accept' ? 'pay' : '',
            cancel: ap === 'cancel' ? 'cancel' : '',
            reject: ap === 'reject' ? 'reject' : '',
            auth: ap === 'auth' ? 'auth' : '',

            senderName: payment.senderName,
            senderAccount: payment.senderAccount,

            authUser: payment.authUser,
            authUserName: payment.authUserName,
            authUserId: payment.authUserId,
            authCountry: payment.authCountry,
            authOther: payment.authOther,
            authToken: payment.authToken
        };

    makePayment(id, options, req.user, (err, data) => {
        if (err) {
            req.flash('error', err.message || err);
            res.redirect(err.redirectUrl || '/');
            return;
        }

        res.forceCharset = data.forceCharset;
        res.setHeader('content-type', 'text/html; charset=' + data.forceCharset);

        data.googleAnalyticsID = config.googleAnalyticsID;

        return res.render('banklink/autosubmit', data);
    });
}

function makePayment(id, options, user, callback) {
    db.findOne(
        'payment',
        {
            _id: new ObjectID(id)
        },
        (err, record) => {
            if (err) {
                err.redirectUrl = '/';
                return callback(err);
            }
            if (!record) {
                err = new Error('Sellise identifikaatoriga maksekorraldust ei leitud');
                err.redirectUrl = '/';
                return callback(err);
            }

            if (record.state !== 'IN PROCESS') {
                err = new Error('Seda maksekorraldust ei saa enam jätkata');
                err.redirectUrl = '/';
                return callback(err);
            }

            if (options.pay === 'pay') {
                record.state = 'PAYED';
            } else if (options.cancel === 'cancel') {
                record.state = 'CANCELLED';
            } else if (options.reject === 'reject') {
                record.state = 'REJECTED';
            } else if (options.auth === 'auth') {
                record.state = 'AUTHENTICATED';
            } else {
                err = new Error('Maksekorralduse vormi viga, ei saa aru kas makse kinnitati või katkestati');
                err.redirectUrl = '/';
                return callback(err);
            }

            record.payment = options;

            db.findOne(
                'project',
                {
                    _id: new ObjectID(record.project)
                },
                (err, project) => {
                    if (err) {
                        err.redirectUrl = '/';
                        return callback(err);
                    }

                    if (!project) {
                        err = new Error('Maksekorraldust ei saa kuvada');
                        err.redirectUrl = '/';
                        return callback(err);
                    }

                    handlePayment(record, project, (err, response) => {
                        if (err) {
                            if (!project) {
                                err = new Error('Maksekorralduse töötlemine ebaõnnestus');
                                err.redirectUrl = '/preview/' + record._id;
                                return callback(err);
                            }
                        }

                        db.save('payment', record, err => {
                            if (err) {
                                err.redirectUrl = '/';
                                return callback(err);
                            }

                            return callback(null, {
                                forceCharset: record.charset,
                                method: response.method,
                                target: response.url,
                                languages: tools.languageNames,
                                countries: tools.countryCodes,
                                payment: record,
                                project,
                                uid: user && user.username,
                                bank: banks[project.bank]
                            });
                        });
                    });
                }
            );
        }
    );
}

function logPayment(project, state, req, res, data, callback) {
    let uid;
    if (!project || !(uid = project.getUid())) {
        return callback(null);
    }

    db.findOne(
        'project',
        {
            uid
        },
        (err, record) => {
            if (err) {
                return callback(err);
            }

            if (!record) {
                return callback(null, false);
            }

            let paymentRecord = {
                project: (record._id || '').toString(),

                date: new Date(),

                state,

                done: state === 'ERROR',

                bank: req.banklink.type,

                charset: project.getCharset(),

                language: project.getLanguage(),

                type: project.getType(),

                amount: project.getAmount(),

                referenceCode: project.getReferenceCode(),

                receiverName: project.getReceiverName(),

                receiverAccount: project.getReceiverAccount(),

                message: project.getMessage(),

                currency: project.getCurrency(),

                nonce: typeof project.getNonce === 'function' ? project.getNonce() : undefined,

                rid: typeof project.getRid === 'function' ? project.getRid() : undefined,

                successTarget: project.getSuccessTarget(),
                cancelTarget: project.getCancelTarget(),
                rejectTarget: project.getRejectTarget(),

                editSenderName: project.editSenderName(),
                showSenderName: project.showSenderName(),
                editSenderAccount: project.editSenderAccount(),
                showSenderAccount: project.showSenderAccount(),

                showReceiverName: project.showReceiverName(),
                showReceiverAccount: project.showReceiverAccount(),

                showAuthForm: typeof project.showAuthForm === 'function' ? project.showAuthForm() : false,
                editAuthUser: typeof project.editAuthUser === 'function' ? project.editAuthUser() : false,

                senderName: req.body.PANGALINK_NAME || 'Tõõger Leõpäöld',
                senderAccount: req.body.PANGALINK_ACCOUNT || banks[record.bank].accountNr || '',

                authUser: req.body.PANGALINK_USER || '',
                authUserName: req.body.PANGALINK_USER_NAME || 'Tõõger Leõpäöld',
                authUserId: req.body.PANGALINK_USER_ID || '37602294565',
                authCountry: req.body.PANGALINK_COUNTRY || 'EE',
                authOther: req.body.PANGALINK_OTHER || '',
                authToken: req.body.PANGALINK_TOKEN || '5',

                url: req.url,

                autoSubmit: !!req.body.PANGALINK_AUTOPAY,

                method: req.method,

                errors: (data.errors && data.errors.length && data.errors) || false,

                warnings: (data.warnings && data.warnings.length && data.warnings) || false,

                headers: Object.keys(req.headers).map(key => {
                    let value = (req.headers[key] || '').toString().trim();
                    if (value.length > 100 * 1024) {
                        value = value.substr(0, 100 * 1024) + ' ...';
                    }
                    return {
                        key,
                        value
                    };
                }),

                fields: Object.keys(req.body).map(key => {
                    let value = (req.body[key] || '').toString().trim();
                    if (value.length > 100 * 1024) {
                        value = value.substr(0, 100 * 1024) + ' ...';
                    }
                    return {
                        key,
                        value
                    };
                }),

                hash: project.getSourceHash(),

                body: req.rawBody.toString('base64')
            };

            db.save('payment', paymentRecord, (err, id) => {
                if (err) {
                    return callback(err);
                }

                record.updatedDate = paymentRecord.date;
                db.save('project', record, () => callback(null, id, paymentRecord));
            });
        }
    );
}

function serveErrors(req, res, errors, warnings, err, id) {
    return res.render('banklink/error', {
        title:
            config.title ||
                (config.hostname || (req && req.headers && req.headers.host) || 'localhost')
                    .replace(/:\d+$/, '')
                    .toLowerCase()
                    .replace(/^./, s => s.toUpperCase()),
        proto: config.proto || 'http',
        hostname: (config.hostname || (req && req.headers && req.headers.host) || 'localhost').replace(/:(80|443)$/, ''),

        errors: (errors && errors.length && errors) || false,
        warnings: (warnings && warnings.length && warnings) || false,
        url: req.url,
        id: id || false,
        user: {
            account: {
                type: 'pro'
            }
        },
        method: req.method,

        headers: Object.keys(req.headers).map(key => {
            let value = (req.headers[key] || '').toString().trim();
            if (value.length > 4096) {
                value = value.substr(0, 4096) + ' ...';
            }
            return {
                key,
                value
            };
        }),

        fields: Object.keys(req.body).map(key => {
            let value = (req.body[key] || '').toString().trim();
            if (value.length > 4096) {
                value = value.substr(0, 4096) + ' ...';
            }
            return {
                key,
                value
            };
        }),

        body: (req.rawBody || '').toString('binary'),

        googleAnalyticsID: config.googleAnalyticsID
    });
}

function handlePayment(payment, project, callback) {
    bankObjects[payment.bank].generateForm(payment, project, (err, response) => {
        if (!payment.charset.match(/^utf[\-_]?8/i)) {
            if (payment.responseFields) {
                Object.keys(payment.responseFields).forEach(key => {
                    payment.responseFields[key] = encoding
                        .convert(encoding.convert(payment.responseFields[key], payment.charset), 'utf-8', payment.charset)
                        .toString('utf-8');
                });
            }
            if (payment.responseHash) {
                payment.responseHash = encoding.convert(encoding.convert(payment.responseHash, payment.charset), 'utf-8', payment.charset).toString('utf-8');
            }
        }
        return callback(err, response);
    });
}
