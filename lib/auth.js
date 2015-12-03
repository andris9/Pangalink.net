'use strict';

let passport = require('passport');
let LocalStrategy = require('passport-local').Strategy;
let crypto = require('crypto');
let bcrypt = require('bcryptjs');
let mail = require('./mail');
let db = require('./db');
let Joi = require('joi');

module.exports.addUser = addUser;
module.exports.updateUser = updateUser;
module.exports.loadUserData = loadUserData;
module.exports.initializeResetPassword = initializeResetPassword;
module.exports.resetPassword = resetPassword;

passport.use(new LocalStrategy(
    function(username, password, done) {
        let schema = Joi.object().keys({
            username: Joi.string().label('E-posti aadress').lowercase().trim().email().required(),
            // warning: bcrypt truncates passwords to 72 bytes (not symbols)
            password: Joi.string().label('Parool').min(3).max(600).required()
        });

        Joi.validate({
            username, password
        }, schema, function(err, value) {
            if (err) {
                return done(null, false, err);
            }

            loadUserData(value.username, function(err, user) {
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
        });
    }
));

passport.serializeUser(function(user, done) {
    done(null, user.username);
});

passport.deserializeUser(function(username, done) {
    loadUserData(username, function(err, user) {
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
    db.findOne('user', {
        username: username
    }, callback);
}

function addUser(username, password, data, callback) {

    if (!callback && typeof data === 'function') {
        callback = data;
        data = undefined;
    }

    let schema = Joi.object().keys({
        username: Joi.string().label('E-posti aadress').lowercase().trim().email().required(),
        password: Joi.string().label('Parool').min(3).max(600).required()
    });

    Joi.validate({
        username, password
    }, schema, function(err, value) {
        if (err) {
            return callback(null, false, err);
        }

        data = data || {};

        loadUserData(value.username, function(err, user) {
            if (err) {
                return callback(err);
            }

            if (user) {
                return callback(null, false, new Error('Valitud e-posti aadress on juba kasutusel. Kas unustasid oma parooli?'));
            }

            bcrypt.hash(password, 10, function(err, hash) {
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

                Object.keys(data).forEach(function(key) {
                    user[key] = data[key];
                });

                db.save('user', user, function(err) {
                    if (err) {
                        return callback(err);
                    }
                    mail.sendRegistration(user);
                    loadUserData(value.username, callback);
                });

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

    Joi.validate({
        username, password
    }, schema, function(err, value) {
        if (err) {
            return callback(null, false, err);
        }
        data = data || {};

        loadUserData(value.username, function(err, user) {
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
                db.save('user', user, function(err) {
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
    });
}

function initializeResetPassword(username, callback) {
    let schema = Joi.object().keys({
        username: Joi.string().label('E-posti aadress').lowercase().trim().email().required()
    });

    Joi.validate({
        username
    }, schema, function(err, value) {
        if (err) {
            return callback(null, false, err);
        }

        loadUserData(value.username, function(err, user) {
            if (err) {
                return callback(err);
            }

            if (!user) {
                return callback(null, true);
            }

            user.resetToken = crypto.randomBytes(15).toString('hex').toLowerCase();
            user.resetExpires = new Date(Date.now() + 3600 * 1000 * 24);

            db.save('user', user, function(err) {
                if (err) {
                    return callback(err);
                }

                mail.sendResetLink(user, user.resetToken);

                return callback(null, true);
            });
        });
    });
}

function resetPassword(username, resetToken, callback) {

    let schema = Joi.object().keys({
        username: Joi.string().label('E-posti aadress').lowercase().trim().email().required(),
        resetToken: Joi.string().label('Turvakood').lowercase().trim().hex().length(30).required()
    });

    Joi.validate({
        username, resetToken
    }, schema, function(err, value) {
        if (err) {
            return callback(null, false, err);
        }

        loadUserData(value.username, function(err, user) {
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

            let password = crypto.randomBytes(12).toString('base64').replace(/[^\w]+/g, '');
            bcrypt.hash(password, 10, function(err, hash) {
                if (err) {
                    return callback(err);
                }

                user.password = hash;
                user.resetToken = false;
                user.resetExpires = false;

                db.save('user', user, function(err) {
                    if (err) {
                        return callback(err);
                    }

                    mail.sendPassword(user, password);

                    return callback(null, true);
                });
            });
        });
    });
}
