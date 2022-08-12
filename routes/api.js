'use strict';

const config = require('config');
const db = require('../lib/db');
const ObjectId = require('mongodb').ObjectId;
const banks = require('../lib/banks.json');
const tools = require('../lib/tools');
const randomString = require('random-string');

const express = require('express');
const router = new express.Router();

let authorize = (req, res, next) => {
    let accessToken = (req.query.access_token || req.headers.access_token || '').toString().trim();

    apiAuthorizeToken(req, accessToken, (err, user) => {
        if (err) {
            return apiResponse(req, res, err);
        }
        if (!user) {
            return apiResponse(req, res, new Error('Invalid or expired token'));
        }
        req.user = user;
        next();
    });
};

let requireUser = (req, res, next) => {
    if (!req.user || req.user.role === 'client') {
        return apiResponse(req, res, new Error('Not allowed'));
    }
    next();
};

router.get('/', serveAPI);

router.get('/banks', authorize, serveAPIListBanks);
router.get('/project', authorize, serveAPIListProject);
router.get('/project/:project', authorize, serveAPIGetProject);
router.post('/project', authorize, requireUser, serveAPIPostProject);
router.delete('/project/:project', authorize, requireUser, serveAPIDeleteProject);

function serveAPI(req, res) {
    let query = {},
        hostname = res.locals.hostname,
        apiHost = config.apiHost || hostname + '/api';

    if (req.user) {
        if (req.user.role !== 'admin') {
            query.$or = [
                {
                    owner: req.user._id
                },
                {
                    authorized: req.user._id
                }
            ];
        }

        db.find(
            'project',
            query,
            {},
            {
                sort: [['name', 'asc']],
                limit: 10,
                skip: 0
            },
            (err, records) => {
                if (err) {
                    //
                }
                res.render('index', {
                    pageTitle: 'API',
                    page: '/api',
                    list: records || [],
                    apiHost,
                    banks
                });
            }
        );
    } else {
        res.render('index', {
            pageTitle: 'API',
            page: '/api',
            list: [],
            apiHost,
            banks
        });
    }
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
    apiResponse(
        req,
        res,
        false,
        Object.keys(banks)
            .sort()
            .map(bank => ({
                type: bank,
                name: banks[bank].name
            }))
    );
}

function serveAPIListProject(req, res) {
    let start = Number((req.query.start_index || '0').toString().trim()) || 0;

    apiActionList(req, start, (err, list) => {
        if (err) {
            return apiResponse(req, res, err);
        }
        apiResponse(req, res, false, list);
    });
}

function serveAPIGetProject(req, res) {
    let projectId = (req.params.project || '').toString().trim();

    apiActionGet(req, projectId, (err, project) => {
        if (err) {
            return apiResponse(req, res, err);
        }
        apiResponse(req, res, false, project);
    });
}

function serveAPIPostProject(req, res) {
    let project;

    try {
        project = JSON.parse(req.rawBody.toString('utf-8'));
    } catch (E) {
        return apiResponse(req, res, new Error('Vigane sisend'));
    }

    apiActionPost(req, project, (err, projectId) => {
        if (err) {
            return apiResponse(req, res, err);
        }
        apiActionGet(req, projectId, (err, project) => {
            if (err) {
                return apiResponse(req, res, err);
            }
            apiResponse(req, res, false, project);
        });
    });
}

function serveAPIDeleteProject(req, res) {
    let projectId = (req.params.project || '').toString().trim();
    apiActionDelete(req, projectId, (err, deleted) => {
        if (err) {
            return apiResponse(req, res, err);
        }
        apiResponse(req, res, false, deleted);
    });
}

function apiAuthorizeToken(req, accessToken, callback) {
    accessToken = (accessToken || '').toString().trim();

    if (!accessToken.match(/^[a-fA-F0-9]+$/)) {
        return callback(new Error('Vigane API võti'));
    }

    db.findOne(
        'user',
        {
            token: accessToken
        },
        callback
    );
}

function apiActionGet(req, projectId, callback) {
    projectId = (projectId || '').toString().trim();

    if (!projectId.match(/^[a-fA-F0-9]{24}$/)) {
        return callback(new Error('Vigane makselahenduse identifikaator'));
    }

    db.findOne(
        'project',
        {
            _id: new ObjectId(projectId)
        },
        (err, project) => {
            let responseObject = {};
            if (err) {
                return callback(err || new Error('Andmebaasi viga'));
            }

            if (!project) {
                return callback(new Error('Sellise identifikaatoriga makselahendust ei leitud'));
            }

            if (!tools.checkAuthorized(req, project)) {
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
        }
    );
}

function apiActionList(req, start, callback) {
    start = start || 0;

    let query = {};
    if (req.user.role !== 'admin') {
        query.$or = [
            {
                owner: req.user._id
            },
            {
                authorized: req.user._id
            }
        ];
    }

    db.database.collection('project').countDocuments(query, (err, total) => {
        if (err) {
            //
        }
        if (start > total) {
            start = Math.floor(total / 20) * 20;
        }
        if (start < 0) {
            start = 0;
        }
        db.find(
            'project',
            query,
            {
                _id: true,
                name: true,
                bank: true
            },
            {
                sort: [['created', 'desc']],
                limit: 20,
                skip: start
            },
            (err, records) => {
                if (err) {
                    return callback(err);
                }

                let list = [].concat(records || []).map(record => ({
                    id: record._id.toString(),
                    name: record.name || undefined,
                    type: record.bank
                }));

                callback(null, {
                    total,
                    start_index: start,
                    end_index: start + list.length - 1,
                    list
                });
            }
        );
    });
}

function apiActionPost(req, project, callback) {
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
        project.auto_response = project.auto_response.toLowerCase().trim() === 'true';
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

    tools.generateKeys(req.user, 20 * 365, Number(project.key_size) || 1024, (err, userCertificate, bankCertificate) => {
        if (err) {
            return callback(new Error('Sertifikaadi genereerimisel tekkis viga'));
        }

        let record = {
            name: project.name,
            description: project.description,
            owner: req.user._id,
            keyBitsize: project.key_size,
            soloAlgo: project.algo,
            soloAutoResponse: !!project.auto_response,
            bank: project.type,
            ecUrl: project.return_url,
            authorized: tools.processAuthorized(''),
            ipizzaReceiverName: project.account_owner,
            ipizzaReceiverAccount: project.account_nr,
            created: new Date(),
            userCertificate,
            bankCertificate,
            secret: randomString({
                length: 32
            })
        };

        tools.incrIdCounter((err, id) => {
            if (err) {
                return callback(new Error('Andmebaasi viga'));
            }

            if (['tapiola', 'alandsbanken', 'handelsbanken', 'aktiasppop'].indexOf(req.body.bank) >= 0) {
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

function apiActionDelete(req, projectId, callback) {
    projectId = (projectId || '').toString().trim();

    if (!projectId.match(/^[a-fA-F0-9]{24}$/)) {
        return callback(new Error('Vigane makselahenduse identifikaator'));
    }

    db.findOne(
        'project',
        {
            _id: new ObjectId(projectId)
        },
        (err, project) => {
            if (err) {
                return callback(err || new Error('Andmebaasi viga'));
            }

            if (!project) {
                return callback(new Error('Sellise identifikaatoriga makselahendust ei leitud'));
            }

            if (!tools.checkAuthorized(req, project)) {
                return callback(new Error('Sul ei ole õigusi selle makselahenduse kasutamiseks'));
            }

            db.remove(
                'project',
                {
                    _id: new ObjectId(projectId)
                },
                err => {
                    if (err) {
                        return callback(err);
                    }

                    db.remove(
                        'counter',
                        {
                            _id: 'trans:' + project.uid
                        },
                        () => {
                            db.remove(
                                'payment',
                                {
                                    project: projectId
                                },
                                () => callback(null, true)
                            );
                        }
                    );
                }
            );
        }
    );
}

module.exports = router;
