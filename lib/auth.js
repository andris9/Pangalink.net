'use strict';

const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const mail = require('./mail');
const db = require('./db');
const Joi = require('joi');
const ObjectID = require('mongodb').ObjectID;

module.exports.addUser = addUser;
module.exports.updateUser = updateUser;
module.exports.loadUserData = loadUserData;
module.exports.initializeResetPassword = initializeResetPassword;
module.exports.resetPassword = resetPassword;
module.exports.initializeAccountTicket = initializeAccountTicket;

passport.use(
    new LocalStrategy((username, password, done) => {
        let schema = Joi.object().keys({
            username: Joi.string()
                .label('E-posti aadress')
                .lowercase()
                .trim()
                .email()
                .required(),
            // warning: bcrypt truncates passwords to 72 bytes (not symbols)
            password: Joi.string()
                .label('Parool')
                .min(3)
                .max(600)
                .required()
        });

        Joi.validate(
            {
                username,
                password
            },
            schema,
            (err, value) => {
                if (err) {
                    return done(null, false, err);
                }

                loadUserData(value.username, (err, user) => {
                    if (err) {
                        return done(err);
                    }

                    bcrypt.compare(password, user.password, (err, res) => {
                        if (err || !res) {
                            return done(null, false, new Error('Tundmatu e-posti aadress või parool'));
                        }
                        return done(null, user);
                    });
                });
            }
        );
    })
);

passport.serializeUser((user, done) => {
    done(null, user.username);
});

passport.deserializeUser((username, done) => {
    loadUserData(username, (err, user) => {
        if (err) {
            return done(err);
        }

        if (user) {
            delete user.password;
        }

        return done(null, user);
    });
});

function loadUserData(username, callback) {
    db.findOne(
        'user',
        {
            username
        },
        callback
    );
}

function addUser(req, username, password, data, callback) {
    if (!callback && typeof data === 'function') {
        callback = data;
        data = undefined;
    }

    let schema = Joi.object().keys({
        username: Joi.string()
            .label('E-posti aadress')
            .lowercase()
            .trim()
            .email()
            .required(),
        password: Joi.string()
            .label('Parool')
            .min(3)
            .max(600)
            .required()
    });

    Joi.validate(
        {
            username,
            password
        },
        schema,
        (err, value) => {
            if (err) {
                return callback(null, false, err);
            }

            data = data || {};

            loadUserData(value.username, (err, user) => {
                if (err) {
                    return callback(err);
                }

                if (user) {
                    return callback(null, false, new Error('Valitud e-posti aadress on juba kasutusel. Kas unustasid oma parooli?'));
                }

                bcrypt.hash(password, 10, (err, hash) => {
                    if (err) {
                        return callback(err);
                    }

                    let user = {
                        username: value.username,
                        password: hash,
                        joined: new Date(),
                        token: crypto.randomBytes(20).toString('hex'),
                        account: {
                            type: 'free',
                            expires: false
                        },
                        validated: false,
                        reset: false
                    };

                    Object.keys(data).forEach(key => {
                        user[key] = data[key];
                    });

                    db.save('user', user, err => {
                        if (err) {
                            return callback(err);
                        }
                        mail.sendRegistration(req, user);
                        loadUserData(value.username, callback);
                    });
                });
            });
        }
    );
}

function updateUser(username, password, data, callback) {
    if (!callback && typeof data === 'function') {
        callback = data;
        data = undefined;
    }

    let schema = Joi.object().keys({
        username: Joi.string()
            .label('E-posti aadress')
            .lowercase()
            .trim()
            .email()
            .required(),
        password: Joi.string()
            .label('Parool')
            .min(3)
            .max(600)
            .optional()
    });

    Joi.validate(
        {
            username,
            password
        },
        schema,
        (err, value) => {
            if (err) {
                return callback(null, false, err);
            }
            data = data || {};

            loadUserData(value.username, (err, user) => {
                if (err) {
                    return callback(err);
                }

                if (!user) {
                    return callback(null, false, {
                        message: 'Tundmatu kasutaja'
                    });
                }

                Object.keys(data).forEach(key => {
                    user[key] = data[key];
                });

                let save = () => {
                    db.save('user', user, err => {
                        if (err) {
                            return callback(err);
                        }
                        return callback(null, user);
                    });
                };

                if (password) {
                    bcrypt.hash(password, 10, (err, hash) => {
                        if (err) {
                            return callback(err);
                        }

                        user.password = hash;
                        save();
                    });
                } else {
                    save();
                }
            });
        }
    );
}

function initializeAccountTicket(req, address, description, role, callback) {
    let schema = Joi.object().keys({
        address: Joi.string()
            .label('E-posti aadress')
            .lowercase()
            .trim()
            .email()
            .required(),
        description: Joi.string()
            .label('Kirjeldus')
            .lowercase()
            .trim(),
        role: Joi.any()
            .valid(['admin', 'user', 'client'])
            .required()
    });

    Joi.validate(
        {
            address,
            description,
            role
        },
        schema,
        (err, value) => {
            if (err) {
                return callback(null, false, err);
            }

            let ticket = {
                _id: new ObjectID(),
                address: value.address,
                description: value.description,
                role: value.role,
                created: new Date()
            };

            db.database.collection('tickets').insert(ticket, err => {
                if (err) {
                    return callback(err);
                }

                mail.sendInvitation(req, ticket);

                return callback(null, ticket);
            });
        }
    );
}

function initializeResetPassword(req, username, callback) {
    let schema = Joi.object().keys({
        username: Joi.string()
            .label('E-posti aadress')
            .lowercase()
            .trim()
            .email()
            .required()
    });

    Joi.validate(
        {
            username
        },
        schema,
        (err, value) => {
            if (err) {
                return callback(null, false, err);
            }

            loadUserData(value.username, (err, user) => {
                if (err) {
                    return callback(err);
                }

                if (!user) {
                    return callback(null, true);
                }

                user.resetToken = crypto
                    .randomBytes(15)
                    .toString('hex')
                    .toLowerCase();
                user.resetExpires = new Date(Date.now() + 3600 * 1000 * 24);

                db.save('user', user, err => {
                    if (err) {
                        return callback(err);
                    }

                    mail.sendResetLink(req, user, user.resetToken);

                    return callback(null, true);
                });
            });
        }
    );
}

function resetPassword(req, username, resetToken, callback) {
    let schema = Joi.object().keys({
        username: Joi.string()
            .label('E-posti aadress')
            .lowercase()
            .trim()
            .email()
            .required(),
        resetToken: Joi.string()
            .label('Turvakood')
            .lowercase()
            .trim()
            .hex()
            .length(30)
            .required()
    });

    Joi.validate(
        {
            username,
            resetToken
        },
        schema,
        (err, value) => {
            if (err) {
                return callback(null, false, err);
            }

            loadUserData(value.username, (err, user) => {
                if (err) {
                    return callback(err);
                }

                if (!user) {
                    return callback(null, false, {
                        message: 'Vigane e-posti aadress'
                    });
                }

                if (!user.resetToken || value.resetToken !== user.resetToken) {
                    return callback(null, false, {
                        message: 'Tundmatu parooli uuendamise kood'
                    });
                }

                if (!user.resetExpires || user.resetExpires < new Date()) {
                    return callback(null, false, {
                        message: 'Kasutatud parooli uuendamise kood on aegunud'
                    });
                }

                let password = crypto
                    .randomBytes(12)
                    .toString('base64')
                    .replace(/[^\w]+/g, '');
                bcrypt.hash(password, 10, (err, hash) => {
                    if (err) {
                        return callback(err);
                    }

                    user.password = hash;
                    user.resetToken = false;
                    user.resetExpires = false;

                    db.save('user', user, err => {
                        if (err) {
                            return callback(err);
                        }

                        mail.sendPassword(req, user, password);

                        return callback(null, true);
                    });
                });
            });
        }
    );
}
