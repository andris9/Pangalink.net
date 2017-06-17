'use strict';

const passport = require('passport');
const auth = require('../lib/auth');
const tools = require('../lib/tools');
const db = require('../lib/db');
const ObjectID = require('mongodb').ObjectID;
const util = require('util');

const express = require('express');
const router = new express.Router();

const roles = {
    admin: 'Admin',
    user: 'Tavakasutaja',
    client: 'Klient'
};

router.get('/reset-link', serveResetLink);
router.post('/reset-link', handleResetLink);

router.get('/reset-password', serveResetPassword);
router.post('/reset-password', handleResetPassword);

router.get('/join', checkJoin, serveJoin);
router.post('/join', checkJoin, handleJoin);

router.get('/profile', tools.requireLogin, serveProfile);
router.post('/profile', tools.requireLogin, handleProfile);

router.get('/profile/:user', tools.requireLogin, tools.requireAdmin, checkUser, serveProfile);
router.post('/profile/:user', tools.requireLogin, tools.requireAdmin, checkUser, handleProfile);

router.get('/delete/:user', tools.requireLogin, tools.requireAdmin, checkUser, serveDeleteProfile);

router.get('/users', tools.requireLogin, tools.requireAdmin, serveUsers);

router.get('/users/add', tools.requireLogin, tools.requireAdmin, serveUsersAdd);

router.post('/login', (req, res, next) => {
    passport.authenticate('local', (err, user) => {
        if (err) {
            return next(err);
        }
        if (!user) {
            req.flash('error', 'Sisselogimine ebaõnnestus');
            return res.redirect('/account/login');
        }
        req.logIn(user, err => {
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

router.get('/login', serveLogin);
router.get('/logout', serveLogout);

function serveResetLink(req, res) {
    res.render('index', {
        pageTitle: 'Parooli taastamine',
        page: '/account/reset-link',
        username: req.query.username || ''
    });
}

function serveResetPassword(req, res) {
    res.render('index', {
        pageTitle: 'Parooli taastamine',
        page: '/account/reset-password',
        username: req.query.username || '',
        resetToken: req.query.resetToken || ''
    });
}

/**
 * Serves login page (/account/login) of the website
 *
 * @param {Object} req HTTP Request object
 * @param {Object} req HTTP Response object
 */
function serveLogin(req, res) {
    res.render('index', {
        pageTitle: 'Logi sisse',
        page: '/account/login',
        username: req.query.username || ''
    });
}

/**
 * Serves logout page (/account/logout) of the website
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
    res.render('index', {
        pageTitle: 'Loo uus konto',
        page: '/account/join',
        name: req.query.name || '',
        username: req.query.username || '',
        agreetos: !!(req.query.agreetos || ''),
        ticket: req.query.ticket || false,
        validation: {}
    });
}

function checkJoin(req, res, next) {
    if (req.query.ticket === 'admin') {
        if (res.locals.adminUser) {
            req.flash('info', 'Admin konto on juba loodud');
            return res.redirect('/');
        }
        if (req.user) {
            return db.database.collection('user').findOneAndUpdate({ username: req.user.username }, {
                $set: {
                    role: 'admin'
                }
            }, (err, r) => {
                if (err || !r || !r.value) {
                    req.flash('danger', 'Andmebaasi viga');
                    return res.redirect('/');
                }
                req.flash('info', 'Oled nüüd admin kasutaja!');
                return res.redirect('/');
            });
        }
        req.ticket = { role: 'admin' };
        return next();
    } else if (req.query.ticket) {
        let ticket = (req.query.ticket || '').toString().trim();
        if (!/^[a-f0-9]{24}$/.test(ticket)) {
            req.flash('danger', 'Vigane konto loomise URL');
            return res.redirect('/');
        }
        return db.database.collection('tickets').findOne({ _id: new ObjectID(ticket) }, (err, data) => {
            if (err) {
                req.flash('danger', 'Andmebaasi viga');
                return res.redirect('/');
            }
            if (!data) {
                req.flash('danger', 'Aegunud või vigane konto loomise URL');
                return res.redirect('/');
            }
            req.ticket = data;
            return next();
        });
    } else {
        req.flash('info', 'Toiming ei ole lubatud');
        return res.redirect('/');
    }
}

function serveProfile(req, res, next) {
    let userId = req.params.user ? new ObjectID((req.params.user || '').toString().trim().toLowerCase()) : req.user._id;
    db.database.collection('user').findOne({ _id: userId }, (err, userData) => {
        if (err) {
            return next(err);
        }
        if (!userData) {
            return next(new Error('Kasutaja andmeid ei leitud'));
        }

        res.render('index', {
            pageTitle: 'Konto andmed',
            page: '/account/profile',
            userId: req.params.user,
            role: userData.role || '',
            name: req.query.name || userData.name || '',
            username: userData.username || '',
            validation: {}
        });
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
        res.render('index', {
            pageTitle: 'Parooli taastamine',
            page: '/account/reset-link',
            username: req.body.username || '',
            validation: validationErrors
        });
        return;
    }

    auth.initializeResetPassword(req, req.body.username, err => {
        if (err) {
            req.flash('error', 'Andmebaasi viga');
            res.render('index', {
                pageTitle: 'Parooli taastamine',
                page: '/account/reset-link',
                name: req.body.name || '',
                username: req.body.username || '',
                validation: validationErrors
            });
            return;
        }

        req.flash('info', 'Parooli muutmise link saadeti valitud e-posti aadressile');
        return res.redirect('/account/login');
    });
}

function handleResetPassword(req, res) {
    auth.resetPassword(req, req.body.username, req.body.resetToken, (err, status, options) => {
        if (err) {
            req.flash('error', 'Andmebaasi viga');
            return res.redirect('/account/login');
        }

        if (!status) {
            req.flash('error', (options && options.message) || 'Parooli vahetamine ebaõnnestus');
            return res.redirect('/account/login');
        }

        req.flash('info', 'Uus parool saadeti valitud e-posti aadressile');
        return res.redirect('/account/login');
    });
}

function handleJoin(req, res) {
    let validationErrors = {},
        error = false;

    req.body.name = (req.body.name || '').toString().trim();

    if (!req.body.name) {
        error = true;
        validationErrors.name = 'Nime täitmine on kohustuslik';
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
        res.render('index', {
            pageTitle: 'Loo uus konto',
            page: '/account/join',
            name: req.body.name || '',
            username: req.body.username || '',
            agreetos: !!(req.body.agreetos || ''),
            ticket: req.query.ticket || false,
            validation: validationErrors
        });
        return;
    }

    let role = req.ticket && req.ticket.role;

    auth.addUser(
        req,
        req.body.username,
        req.body.password,
        {
            name: req.body.name,
            agreetos: !!(req.body.agreetos || ''),
            role
        },
        (err, user, options) => {
            if (err) {
                req.flash('error', 'Andmebaasi viga');
                res.render('index', {
                    pageTitle: 'Loo uus konto',
                    page: '/account/join',
                    name: req.body.name || '',
                    username: req.body.username || '',
                    agreetos: !!(req.body.agreetos || ''),
                    ticket: req.query.ticket || false,
                    validation: validationErrors
                });
                return;
            }
            if (!user) {
                validationErrors.username = options.message || 'Ei õnnestunud kasutajat luua';
                res.render('index', {
                    pageTitle: 'Loo uus konto',
                    page: '/account/join',
                    name: req.body.name || '',
                    username: req.body.username || '',
                    agreetos: !!(req.body.agreetos || ''),
                    ticket: req.query.ticket || false,
                    validation: validationErrors
                });
                return;
            }

            if (req.ticket && req.ticket._id) {
                db.database.collection('tickets').deleteOne({ _id: req.ticket._id }, () => false);
            }

            if (role === 'admin') {
                req.flash('info', 'Oled nüüd admin kasutaja!');
            }

            req.login(user, err => {
                if (err) {
                    req.flash('info', 'Kasutaja on loodud, kuid automaatne sisselogimine ebaõnnestus');
                    return res.redirect('/');
                }

                req.flash('success', 'Kasutaja on loodud ning oled nüüd sisse logitud');

                return res.redirect('/projects/add');
            });
        }
    );
}

function handleProfile(req, res, next) {
    let userId = req.params.user ? new ObjectID((req.params.user || '').toString().trim().toLowerCase()) : req.user._id;
    let role = (req.body.role || '').toString().toLowerCase().trim();

    if (!req.params.user || !['admin', 'user', 'client'].includes(role)) {
        role = false;
    }

    db.database.collection('user').findOne({ _id: userId }, (err, userData) => {
        if (err) {
            return next(err);
        }
        if (!userData) {
            return next(new Error('Kasutaja andmeid ei leitud'));
        }

        let validationErrors = {},
            error = false;

        req.body.name = (req.body.name || '').toString().trim();

        if (!req.body.name) {
            error = true;
            validationErrors.name = 'Nime täitmine on kohustuslik';
        }

        if (req.body.password && !req.body.password2) {
            error = true;
            validationErrors.password2 = 'Parooli korduse täitmine on parooli vahetamisel kohustuslik';
        }

        if (req.body.password && req.body.password2 && req.body.password !== req.body.password2) {
            error = true;
            validationErrors.password2 = 'Paroolid ei kattu';
        }

        if (error) {
            req.flash('error', 'Andmete valideerimisel ilmnesid vead');
            res.render('index', {
                pageTitle: 'Konto andmed',
                page: '/account/profile',
                userId: req.params.user,
                role: req.body.role || '',
                name: req.body.name || '',
                username: req.user.username || '',
                validation: validationErrors
            });
            return;
        }

        let options = {
            name: req.body.name
        };

        if (role) {
            options.role = role;
        }

        auth.updateUser(userData.username, req.body.password || undefined, options, (err, user, options) => {
            if (err) {
                req.flash('error', 'Andmebaasi viga');
                res.render('index', {
                    pageTitle: 'Konto andmed',
                    page: '/account/profile',
                    userId: req.params.user,
                    role: req.body.role || '',
                    name: req.body.name || '',
                    username: req.user.username || '',
                    validation: validationErrors
                });
                return;
            }
            if (!user) {
                validationErrors.username = options.message || 'Ei õnnestunud kasutaja profiili uuendada';
                res.render('index', {
                    pageTitle: 'Konto andmed',
                    page: '/account/profile',
                    userId: req.params.user,
                    role: req.body.role || '',
                    name: req.body.name || '',
                    username: req.user.username || '',
                    validation: validationErrors
                });
                return;
            }

            req.flash('success', 'Profiili andmed on uuendatud');
            return res.redirect('/account/profile' + (req.params.user ? '/' + req.params.user : ''));
        });
    });
}

function serveUsers(req, res, next) {
    db.database.collection('user').find().project({ name: true, username: true, role: true }).sort({ username: 1 }).toArray((err, list) => {
        if (err) {
            return next(err);
        }
        res.render('index', {
            pageTitle: 'Kasutajad',
            page: '/account/users',
            list: list.map(user => {
                user.roleStr = roles[user.role];
                return user;
            })
        });
    });
}

function serveUsersAdd(req, res) {
    res.render('index', {
        pageTitle: 'Lisa uus kasutaja',
        page: '/account/users/add',
        username: req.query.username || '',
        validation: {},
        role: 'user'
    });
}

function serveDeleteProfile(req, res) {
    let userId = req.params.user ? new ObjectID((req.params.user || '').toString().trim().toLowerCase()) : false;

    if (!/^[a-fA-F0-9]{24}$/.test(userId)) {
        req.flash('error', 'Vigane kasutaja identifikaator');
        res.redirect('/');
        return;
    }

    db.findOne(
        'user',
        {
            _id: new ObjectID(userId)
        },
        (err, user) => {
            if (err) {
                req.flash('error', err.message || err || 'Andmebaasi viga');
                res.redirect('/');
                return;
            }
            if (!user) {
                req.flash('error', 'Sellise identifikaatoriga kasutajat ei leitud');
                res.redirect('/');
                return;
            }

            db.remove(
                'user',
                {
                    _id: new ObjectID(userId)
                },
                () => {
                    req.flash('success', util.format('Kasutaja "%s" on kustutatud', user.username));
                    res.redirect('/account/users');
                    return;
                }
            );
        }
    );
}

function checkUser(req, res, next) {
    let userId = (req.params.user || '').toString().trim().toLowerCase();

    if (userId === req.user._id.toString()) {
        return res.redirect('/account/profile');
    }

    next();
}

module.exports = router;
