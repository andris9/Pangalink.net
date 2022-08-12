'use strict';

const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const mail = require('./mail');
const db = require('./db');
const Joi = require('joi');
const ObjectId = require('mongodb').ObjectId;

module.exports.addUser = addUser;
module.exports.updateUser = updateUser;
module.exports.loadUserData = loadUserData;
module.exports.initializeResetPassword = initializeResetPassword;
module.exports.resetPassword = resetPassword;
module.exports.initializeAccountTicket = initializeAccountTicket;

passport.use(
    new LocalStrategy((username, password, done) => {
        let schema = Joi.object().keys({
            username: Joi.string().label('E-posti aadress').lowercase().trim().email().required(),
            // warning: bcrypt truncates passwords to 72 bytes (not symbols)
            password: Joi.string().label('Parool').min(3).max(600).required()
        });

        let validationResult = schema.validate(
            {
                username,
                password
            },
            {
                stripUnknown: true,
                abortEarly: false,
                convert: true
            }
        );

        const values = validationResult && validationResult.value;

        if (validationResult.error) {
            return done(null, false, validationResult.error);
        }

        loadUserData(values.username, (err, user) => {
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
        username: Joi.string().label('E-posti aadress').lowercase().trim().email().required(),
        password: Joi.string().label('Parool').min(3).max(600).required()
    });

    let validationResult = schema.validate(
        {
            username,
            password
        },
        {
            stripUnknown: true,
            abortEarly: false,
            convert: true
        }
    );

    const values = validationResult && validationResult.value;

    if (validationResult.error) {
        return callback(null, false, validationResult.error);
    }

    data = data || {};

    loadUserData(values.username, (err, user) => {
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
                username: values.username,
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
                loadUserData(values.username, callback);
            });
        });
    });
}

function updateUser(username, password, data, callback) {
    if (!callback && typeof data === 'function') {
        callback = data;
        data = undefined;
    }

    let schema = Joi.object().keys({
        username: Joi.string().label('E-posti aadress').lowercase().trim().email().required(),
        password: Joi.string().label('Parool').min(3).max(600).optional()
    });

    const validationResult = schema.validate(
        {
            username,
            password
        },
        {
            stripUnknown: true,
            abortEarly: false,
            convert: true
        }
    );

    const values = validationResult && validationResult.value;

    if (validationResult.error) {
        return callback(null, false, validationResult.error);
    }

    data = data || {};

    loadUserData(values.username, (err, user) => {
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

function initializeAccountTicket(req, address, description, role, callback) {
    let schema = Joi.object().keys({
        address: Joi.string().label('E-posti aadress').lowercase().trim().email().required(),
        description: Joi.string().label('Kirjeldus').lowercase().trim(),
        role: Joi.any().valid('admin', 'user', 'client').required()
    });

    const validationResult = schema.validate(
        {
            address,
            description,
            role
        },
        {
            stripUnknown: true,
            abortEarly: false,
            convert: true
        }
    );

    const values = validationResult && validationResult.value;

    if (validationResult.error) {
        return callback(null, false, validationResult.error);
    }

    let ticket = {
        _id: new ObjectId(),
        address: values.address,
        description: values.description,
        role: values.role,
        created: new Date()
    };

    db.database.collection('tickets').insertOne(ticket, err => {
        if (err) {
            return callback(err);
        }

        mail.sendInvitation(req, ticket);

        return callback(null, ticket);
    });
}

function initializeResetPassword(req, username, callback) {
    let schema = Joi.object().keys({
        username: Joi.string().label('E-posti aadress').lowercase().trim().email().required()
    });

    const validationResult = schema.validate(
        {
            username
        },
        {
            stripUnknown: true,
            abortEarly: false,
            convert: true
        }
    );

    const values = validationResult && validationResult.value;

    if (validationResult.error) {
        return callback(null, false, validationResult.error);
    }

    loadUserData(values.username, (err, user) => {
        if (err) {
            return callback(err);
        }

        if (!user) {
            return callback(null, true);
        }

        user.resetToken = crypto.randomBytes(15).toString('hex').toLowerCase();
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

function resetPassword(req, username, resetToken, callback) {
    let schema = Joi.object().keys({
        username: Joi.string().label('E-posti aadress').lowercase().trim().email().required(),
        resetToken: Joi.string().label('Turvakood').lowercase().trim().hex().length(30).required()
    });

    const validationResult = Joi.validate(
        {
            username,
            resetToken
        },
        {
            stripUnknown: true,
            abortEarly: false,
            convert: true
        }
    );

    const values = validationResult && validationResult.value;

    if (validationResult.error) {
        return callback(null, false, validationResult.error);
    }

    loadUserData(values.username, (err, user) => {
        if (err) {
            return callback(err);
        }

        if (!user) {
            return callback(null, false, {
                message: 'Vigane e-posti aadress'
            });
        }

        if (!user.resetToken || values.resetToken !== user.resetToken) {
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
