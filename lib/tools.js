'use strict';

const config = require('wild-config');
const urllib = require('url');
const banks = require('./banks');
const encoding = require('encoding');
const ipizza = require('./banks/ipizza');
const aab = require('./banks/aab');
const samlink = require('./banks/samlink');
const solo = require('./banks/solo');
const ec = require('./banks/ec');
const db = require('./db');
const fs = require('fs');
const crypto = require('crypto');
const pem = require('pem');
const Highlight = require('highlight.js');

const marked = require('marked');
const renderer = new marked.Renderer();
const rendered = new Map();
// make a list of md files in the docs folder
const allowedDocs = fs.readdirSync(__dirname + '/../docs').map(name => name.replace(/\.md$/, ''));

// setup markdown renderer for docs
renderer.heading = (text, level) => {
    let escapedText = text.toLowerCase().replace(/[^\w]+/g, '-');
    return (
        '<h' +
        level +
        '><a name="' +
        escapedText +
        '" class="anchor" href="#' +
        escapedText +
        '"><span class="header-link"></span></a>' +
        text +
        '</h' +
        level +
        '>'
    );
};
marked.setOptions({
    renderer,
    gfm: true,
    tables: true,
    breaks: false,
    pedantic: false,
    sanitize: false,
    smartLists: true,
    smartypants: false,
    highlight: (code, lang, callback) => {
        let html = Highlight.highlightAuto(code).value;
        callback(null, html);
    }
});

module.exports.roles = {
    admin: 'Admin',
    user: 'Tavakasutaja',
    client: 'Klient'
};

module.exports.processLabels = {
    ERROR: {
        type: 'danger',
        name: 'Vigane päring'
    },
    'IN PROCESS': {
        type: 'default',
        name: 'Pooleli olev'
    },
    PAYED: {
        type: 'success',
        name: 'Teostatud'
    },
    CANCELLED: {
        type: 'primary',
        name: 'Katkestatud'
    },
    REJECTED: {
        type: 'info',
        name: 'Tagasi lükatud'
    },
    AUTHENTICATED: {
        type: 'success',
        name: 'Autenditud'
    }
};

module.exports.languages = {
    EST: 'et',
    ENG: 'en',
    RUS: 'ru',
    LAT: 'lv',
    LIT: 'lt',
    FIN: 'fi',
    SWE: 'se',
    GER: 'de'
};

module.exports.countryCodes = {
    et: 'ee',
    en: 'gb',
    ru: 'ru',
    lv: 'lv',
    lt: 'lt',
    fi: 'fi',
    se: 'se',
    de: 'de'
};

module.exports.languageNames = {
    et: 'Eesti',
    en: 'Inglise',
    ru: 'Vene',
    lv: 'Läti',
    lt: 'Leedu',
    fi: 'Soome',
    se: 'Rootsi',
    de: 'Saksa'
};

module.exports.currencies = {
    EUR: '€',
    LVL: 'LVL',
    LTL: 'LTL',
    USD: '$'
};

module.exports.formatCurrency = function (nr, currency) {
    let parts = (Number(nr) || 0).toFixed(2).split('.'),
        euros = parts[0] || '0',
        cents = parts[1];

    return (
        (euros.substr(0, euros.length % 3) + euros.substr(euros.length % 3).replace(/\d{3}/g, ' $&')).trim() + ',' + cents + (currency ? ' ' + currency : '')
    );
};

module.exports.getReferenceCode = function (code) {
    code = code === 0 ? '0' : (code || '').toString();

    let multiplier = [7, 3, 1],
        sum = 0;

    if (!code || code.match(/\D/)) {
        return false;
    }

    for (let i = code.length - 1, mod = 0; i >= 0; i--, mod++) {
        sum += Number(code[i]) * multiplier[mod % 3];
    }

    return code + (Math.round(Math.ceil(sum / 10) * 10) - sum);
};

module.exports.validateReturnURL = function (url) {
    let urlParts = urllib.parse(url, true),
        keys = Object.keys(urlParts.query || {}),
        list = [];

    for (let i = 0, len = keys.length; i < len; i++) {
        if (keys[i].substr(0, 3) === 'VK_') {
            list.push(keys[i]);
        }
    }

    return list;
};

module.exports.joinAsString = function (arr, s, f, d, y) {
    if (!arr) {
        return '';
    }

    if (!Array.isArray(arr)) {
        return arr.toString();
    }

    arr = JSON.parse(JSON.stringify(arr));

    if (typeof d !== 'undefined') {
        for (let i = 0; i < arr.length; i++) {
            if (arr[i] === d) {
                arr[i] += y;
            }
        }
    }

    if (arr.length < 2) {
        return arr.join('');
    }
    return arr.slice(0, arr.length - 1).join(s || '') + f + arr[arr.length - 1];
};

module.exports.checkEncoding = function (req, res, next) {
    if (!req.rawBody || !req.rawBody.length) {
        return next();
    }

    let urlParts = urllib.parse(req.originalUrl),
        match = urlParts.pathname.match(/^\/banklink\/(?:\d+\/)?([^/?]+)/),
        bank = banks[match && (match[1] || '').trim().toLowerCase()],
        charset = 'UTF-8',
        banklib;

    if (!bank || ['final', 'preview'].includes(bank)) {
        return next();
    }

    switch (bank.type) {
        case 'ipizza':
            banklib = ipizza;
            break;

        case 'solo':
            banklib = solo;
            break;

        case 'aab':
            banklib = aab;
            break;

        case 'samlink':
            banklib = samlink;
            break;

        case 'ec':
            banklib = ec;
            break;

        default:
            return next();
    }

    charset = banklib.detectCharset(bank, req.body);

    if (!charset.match(/^UTF[-_]?8$/)) {
        Object.keys(req.body).forEach(key => {
            req.body[key] = encoding.convert(req.encodedBody[key], 'UTF-8', charset).toString('utf-8');
        });
    }

    req.banklink = {
        headers: req.headers,
        bank,
        charset,
        type: bank.type,
        language: module.exports.languages[banklib.detectLanguage(bank, req.body)] || 'et',
        fields: req.body
    };

    next();
};

module.exports.opensslVerify = function (data, signature, cert, charset, format, callback) {
    let result;

    if (!callback && typeof format === 'function') {
        callback = format;
        format = false;
    }

    if (!callback && typeof charset === 'function') {
        callback = charset;
        charset = false;
    }

    format = format || 'base64';
    data = encoding.convert(data, charset);

    try {
        let verifier = crypto.createVerify('SHA1');
        verifier.update(data);
        result = verifier.verify(cert, signature, format);
    } catch (E) {
        return callback(E);
    }

    return callback(null, !!result);
};

module.exports.opensslSign = function (data, key, charset, format, callback) {
    let result;

    if (!callback && typeof format === 'function') {
        callback = format;
        format = false;
    }

    if (!callback && typeof charset === 'function') {
        callback = charset;
        charset = false;
    }

    format = format || 'base64';
    data = encoding.convert(data, charset);

    try {
        let signer = crypto.createSign('SHA1');
        signer.update(data);
        result = signer.sign(key, format);
    } catch (E) {
        return callback(E);
    }

    return callback(null, result);
};

if (!('lpad' in String.prototype)) {
    Object.defineProperty(String.prototype, 'lpad', {
        enumerable: false,
        value(length, str) {
            length = Math.abs(length) || 0;
            str = str || '0';
            if (!length || length <= this.length) {
                return this;
            }
            return new Array(length - this.length + 1).join(str) + this;
        }
    });
}

if (!('rpad' in String.prototype)) {
    Object.defineProperty(String.prototype, 'rpad', {
        enumerable: false,
        value(length, str) {
            length = Math.abs(length) || 0;
            str = str || '0';
            if (!length || length <= this.length) {
                return this;
            }
            return this + new Array(length - this.length + 1).join(str);
        }
    });
}

module.exports.paging = function (pageNumber, pageCount) {
    let visible = config.pagingRange,
        rangeMin = pageNumber - Math.round(visible / 2),
        rangeMax = pageNumber + Math.round(visible / 2),
        pageList = [];

    if (pageCount <= visible) {
        rangeMin = 1;
        rangeMax = pageCount;
    } else if (rangeMin < 1) {
        rangeMax += Math.abs(rangeMin) + 1;
        rangeMin = 1;
    } else if (rangeMax > pageCount) {
        rangeMin -= rangeMax - pageCount;
        rangeMax = pageCount;
    }

    for (let i = rangeMin; i <= rangeMax; i++) {
        pageList.push({
            pageNumber: i,
            active: i === pageNumber
        });
    }

    if (rangeMin > 1) {
        pageList.unshift({
            disabled: true
        });
    }

    if (rangeMax < pageCount) {
        pageList.push({
            disabled: true
        });
    }

    return pageList;
};

module.exports.validateUrl = function (url) {
    return url.match(/(http|https):\/\/(\w+:{0,1}\w*@)?(\S+)(:[0-9]+)?(\/|\/([\w#!:.?+=&%@!\-/]))?/);
};

// generate 2 self signed sets of a private key and a certificate (one for the bank, one for the user)
module.exports.generateKeys = function (user, days, keyBitsize, callback) {
    module.exports.generateKeyPair(user, days, keyBitsize, (err, userCertificate) => {
        if (err) {
            return callback(err);
        }
        module.exports.generateKeyPair(user, days, keyBitsize, (err, bankCertificate) => {
            if (err) {
                return callback(err);
            }
            return callback(null, userCertificate, bankCertificate);
        });
    });
};

module.exports.generateKeyPair = function (user, days, keyBitsize, callback) {
    if (!callback && typeof keyBitsize === 'function') {
        callback = keyBitsize;
        keyBitsize = undefined;
    }

    if (!callback && typeof days === 'function') {
        callback = days;
        days = undefined;
    }

    keyBitsize = keyBitsize || config.keyBitsize;

    days = days || 181;

    let csr = {
        keyBitsize,
        hash: 'sha1',
        country: 'EE',
        state: 'Harjumaa',
        locality: 'Tallinn',
        organizationUnit: 'banklink',
        commonName: (config.hostname || 'localhost').replace(/:\d+$/, ''),
        emailAddress: user.username,
        selfSigned: true,
        days
    };

    pem.createCertificate(csr, (err, keyData) => {
        if (err) {
            return callback(err);
        }

        keyData.expires = new Date(Date.now() + 1000 * 3600 * 24 * days);
        return callback(err, keyData);
    });
};

// increment a counter value by 1 and return result
module.exports.incrCounter = function (counter, callback) {
    db.modify(
        'counter',
        {
            _id: counter
        },
        {
            $inc: {
                value: 1
            }
        },
        (err, doc) => {
            if (err) {
                return callback(err);
            }
            callback(null, doc.value);
        }
    );
};

module.exports.incrIdCounter = function (callback) {
    return module.exports.incrCounter('id', callback);
};

module.exports.incrTransactionCounter = function (clientId, callback) {
    let key = 'trans';

    if (!callback && typeof clientId === 'function') {
        callback = clientId;
    }

    clientId = (clientId || '').toString().trim();

    if (clientId) {
        key += ':' + clientId;
    }

    module.exports.incrCounter(key, callback);
};

// return a www-form-urlencoded string for specific charset
module.exports.stringifyQuery = function (obj, charset) {
    let values;

    obj = obj || {};

    values = Object.keys(obj).map(key => {
        let value = encoding.convert(obj[key], charset),
            str = '';

        for (let i = 0, len = value.length; i < len; i++) {
            if (
                (value[i] >= 48 && value[i] <= 57) ||
                (value[i] >= 65 && value[i] <= 90) ||
                (value[i] >= 97 && value[i] <= 122) ||
                [45, 46, 95, 126].indexOf(value[i]) >= 0
            ) {
                str += String.fromCharCode(value[i]);
            } else {
                str += '%' + (value[i] < 16 ? '0' : '') + value[i].toString(16).toUpperCase();
            }
        }

        return encodeURIComponent(key) + '=' + str;
    });

    return values.join('&');
};

module.exports.renderDocs = function (name, callback) {
    if (rendered.has(name)) {
        return callback(null, rendered.get(name));
    }

    if (allowedDocs.indexOf(name) < 0) {
        return callback(new Error('Valitud dokumentatsiooni ei leitud'));
    }

    fs.readFile(__dirname + '/../docs/' + name + '.md', 'utf-8', (err, content) => {
        if (err) {
            return callback(err);
        }

        marked.parse(content, (err, html) => {
            if (err) {
                return callback(err);
            }
            rendered.set(name, html);
            return callback(null, rendered.get(name));
        });
    });
};

/*
 * Validate Estonian national identification code.
 *
 * Copyright (c) 2009 Mika Tuupola
 *
 * FROM: https://gist.githubusercontent.com/tuupola/180321/raw/isikukood.js
 *
 * Licensed under the MIT license:
 * http://www.opensource.org/licenses/mit-license.php
 */
module.exports.verifyUserId = function (code) {
    let multiplier_1 = new Array(1, 2, 3, 4, 5, 6, 7, 8, 9, 1);
    let multiplier_2 = new Array(3, 4, 5, 6, 7, 8, 9, 1, 2, 3);

    let control = code.charAt(10);

    let mod = 0;
    let total = 0;

    let i;

    /* Do first run. */
    for (i = 0; i < 10; i++) {
        total += code.charAt(i) * multiplier_1[i];
    }
    mod = total % 11;

    /* If modulus is ten we need second run. */
    total = 0;
    if (mod === 10) {
        for (i = 0; i < 10; i++) {
            total += code.charAt(i) * multiplier_2[i];
        }
        mod = total % 11;

        /* If modulus is still ten revert to 0. */
        if (mod === 10) {
            mod = 0;
        }
    }

    return control === mod;
};

module.exports.requireLogin = (req, res, next) => {
    if (!req.user || !req.user.username) {
        req.flash('error', 'Sisselogimine on nõutud');
        return res.redirect('/account/login');
    }
    next();
};

module.exports.requireAdmin = (req, res, next) => {
    if (!req.user || req.user.role !== 'admin') {
        req.flash('error', 'Toiming ei ole lubatud');
        return res.redirect('/');
    }
    next();
};

module.exports.requireUser = (req, res, next) => {
    if (!req.user || req.user.role === 'client') {
        req.flash('error', 'Toiming ei ole lubatud');
        return res.redirect('/');
    }
    next();
};

module.exports.processAuthorized = (users, authorized) => {
    authorized = []
        .concat(authorized || [])
        .map(str => (str || '').toString().trim())
        .filter(str => str);

    return users.map(user => {
        user.selected = authorized.includes(user._id.toString());
        user.roleStr = module.exports.roles[user.role];
        return user;
    });
};

module.exports.checkAuthorized = (req, project) => {
    if (!req.user) {
        return false;
    }
    return (
        project.owner.toString() === req.user._id.toString() ||
        req.user.role === 'admin' ||
        project.authorized.map(id => id.toString()).includes(req.user._id.toString())
    );
};
