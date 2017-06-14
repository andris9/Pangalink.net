'use strict';

const passport = require('passport');
const auth = require('../lib/auth');
const tools = require('../lib/tools');

const express = require('express');
const router = new express.Router();

router.get('/reset-link', serveResetLink);
router.post('/reset-link', handleResetLink);

router.get('/reset-password', serveResetPassword);
router.post('/reset-password', handleResetPassword);

router.get('/join', serveJoin);
router.post('/join', handleJoin);

router.get('/profile', tools.requireLogin, serveProfile);
router.post('/profile', tools.requireLogin, handleProfile);

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
        validation: {}
    });
}

function serveProfile(req, res) {
    res.render('index', {
        pageTitle: 'Konto andmed',
        page: '/account/profile',
        name: req.query.name || req.user.name || '',
        username: req.user.username || '',
        validation: {}
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

    auth.initializeResetPassword(req.body.username, err => {
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
    auth.resetPassword(req.body.username, req.body.resetToken, (err, status, options) => {
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
            validation: validationErrors
        });
        return;
    }

    auth.addUser(
        req.body.username,
        req.body.password,
        {
            name: req.body.name,
            agreetos: !!(req.body.agreetos || '')
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
                    validation: validationErrors
                });
                return;
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

function handleProfile(req, res) {
    let validationErrors = {},
        error = false;

    req.body.name = (req.body.name || '').toString().trim();

    if (!req.body.name) {
        error = true;
        validationErrors.name = 'Nime täitmine on kohustuslik';
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
        res.render('index', {
            pageTitle: 'Konto andmed',
            page: '/account/profile',
            name: req.body.name || '',
            username: req.user.username || '',
            validation: validationErrors
        });
        return;
    }

    auth.updateUser(
        req.user.username,
        req.body.password || undefined,
        {
            name: req.body.name
        },
        (err, user, options) => {
            if (err) {
                req.flash('error', 'Andmebaasi viga');
                res.render('index', {
                    pageTitle: 'Konto andmed',
                    page: '/account/profile',
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
                    name: req.body.name || '',
                    username: req.user.username || '',
                    validation: validationErrors
                });
                return;
            }

            req.flash('success', 'Profiili andmed on uuendatud');
            return res.redirect('/account/profile');
        }
    );
}

module.exports = router;
