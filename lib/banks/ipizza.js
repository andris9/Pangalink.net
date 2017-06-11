'use strict';

const config = require('config');
const util = require('util');
const banks = require('../banks');
const tools = require('../tools');
const db = require('../db');
const moment = require('moment');
const fetchUrl = require('fetch').fetchUrl;
const urllib = require('url');
const IBAN = require('iban');

module.exports = IPizza;

function IPizza(bank, fields, charset) {
    this.bank = (typeof bank === 'string' ? banks[bank] || banks.ipizza || {} : bank) || {};
    this.fields = fields || {};

    this.normalizeValues();

    this.language = IPizza.detectLanguage(this.bank, this.fields);
    this.charset = charset || IPizza.detectCharset(this.bank, this.fields);
}

IPizza.samplePayment = function(project, urlPrefix, options, callback) {
    let bank = banks[project.bank] || banks.ipizza,
        charsetValue,
        charsetKey;

    charsetValue = ((bank.allowedCharsets || []).indexOf('UTF-8') >= 0 ? 'UTF-8' : (bank.allowedCharsets || [])[0] || 'ISO-8859-1').toLowerCase();
    charsetKey = bank.charset || false;

    let testFields = {
        VK_SERVICE: '1001',
        VK_VERSION: '008',
        VK_SND_ID: project.uid,
        VK_STAMP: '12345',
        VK_AMOUNT: options.amount || '150',
        VK_CURR: 'EUR',
        VK_ACC: options.acc || project.ipizzaReceiverAccount || bank.accountNr,
        VK_NAME: options.name || project.ipizzaReceiverName || 'ÕIE MÄGER',
        VK_REF: options.ref || '1234561',
        VK_LANG: 'EST',
        VK_MSG: options.msg || 'Torso Tiger',
        VK_RETURN: urlPrefix + '/project/' + project._id + '?payment_action=success'
    };

    if (bank.useVK_PANK) {
        testFields.VK_PANK = '40100';
    }

    if (bank.useVK_TIME_LIMIT) {
        testFields.VK_TIME_LIMIT = moment(Date.now() + 1000 * 3600).format('YYYY-MM-DD HH:mm:ss');
    }

    if (bank.cancelAddress && bank.cancelAddress !== 'VK_RETURN') {
        testFields[bank.cancelAddress] = urlPrefix + '/project/' + project._id + '?payment_action=cancel';
    }

    if (bank.rejectAddress && bank.rejectAddress !== 'VK_RETURN') {
        testFields[bank.rejectAddress] = urlPrefix + '/project/' + project._id + '?payment_action=reject';
    }

    let editable = {
        name: {
            field: 'VK_NAME',
            name: 'Saaja nimi',
            value: testFields.VK_NAME
        },
        acc: {
            field: 'VK_ACC',
            name: 'Saaja konto',
            value: testFields.VK_ACC
        },
        amount: {
            field: 'VK_AMOUNT',
            name: 'Summa',
            value: testFields.VK_AMOUNT
        },
        msg: {
            field: 'VK_MSG',
            name: 'Kirjeldus',
            value: testFields.VK_MSG
        },
        ref: {
            field: 'VK_REF',
            name: 'Viitenumber',
            value: testFields.VK_REF
        }
    };

    if (bank.allowedServices && (bank.allowedServices || []).indexOf('1001') < 0) {
        if (bank.allowedServices && (bank.allowedServices || []).indexOf('1011') >= 0) {
            testFields.VK_SERVICE = '1011';
            testFields.VK_DATETIME = moment().format('YYYY-MM-DDTHH:mm:ssZZ');
        } else {
            testFields.VK_SERVICE = '1002';
            delete testFields.VK_ACC;
            delete testFields.VK_NAME;
            editable.name;
            editable.acc;
        }
    }

    if (charsetKey) {
        testFields[charsetKey] = charsetValue;
    }

    let payment = new IPizza(project.bank, testFields, charsetValue);
    payment.record = project;

    payment.editable = editable;

    payment.signClient(err => {
        if (err) {
            return callback(err);
        }

        callback(null, payment, charsetValue);
    });
};

IPizza.sampleAuth = function(project, urlPrefix, options, callback) {
    let bank = banks[project.bank] || banks.ipizza,
        charsetValue,
        charsetKey;

    charsetValue = ((bank.allowedCharsets || []).indexOf('UTF-8') >= 0 ? 'UTF-8' : (bank.allowedCharsets || [])[0] || 'ISO-8859-1').toLowerCase();
    charsetKey = bank.charset || false;

    let testFields = {
        VK_SERVICE: '4011',
        VK_VERSION: '008',
        VK_SND_ID: project.uid,
        VK_REPLY: '3012',
        VK_RETURN: urlPrefix + '/project/' + project._id + '?auth_action=success',
        VK_DATETIME: moment().format('YYYY-MM-DDTHH:mm:ssZZ'),
        VK_RID: options.rid || Date.now()
    };

    if (charsetKey) {
        testFields[charsetKey] = charsetValue;
    }

    let payment = new IPizza(project.bank, testFields, charsetValue);
    payment.record = project;
    payment.isAuth = true;

    payment.editable = {
        rid: {
            field: 'VK_RID',
            name: 'Sessiooni võti',
            value: testFields.VK_RID
        }
    };

    payment.signClient(err => {
        if (err) {
            return callback(err);
        }
        callback(null, payment, charsetValue);
    });
};

IPizza.detectLanguage = function(bank, fields) {
    bank = (typeof bank === 'string' ? banks[bank] || banks.ipizza || {} : bank) || {};

    let language = (fields.VK_LANG || 'EST').toUpperCase();
    if (IPizza.languages.indexOf(language) < 0) {
        language = IPizza.defaultLanguage;
    }

    return language;
};

IPizza.detectCharset = function(bank, fields) {
    bank = (typeof bank === 'string' ? banks[bank] || banks.ipizza || {} : bank) || {};

    let defaultCharset = bank.defaultCharset;

    return fields[bank.charset] || fields.VK_CHARSET || fields.VK_ENCODING || defaultCharset;
};

IPizza.allowedCurrencies = ['EUR', 'LVL', 'LTL'];
IPizza.languages = ['EST', 'ENG', 'RUS', 'LAT', 'LIT', 'FIN', 'SWE'];
IPizza.defaultLanguage = 'EST';

IPizza.serviceTypes = {
    1001: 'PAYMENT',
    1002: 'PAYMENT',
    1011: 'PAYMENT',
    1012: 'PAYMENT',
    4001: 'IDENTIFICATION',
    4002: 'IDENTIFICATION',
    4011: 'IDENTIFICATION',
    4012: 'IDENTIFICATION'
};

IPizza.authMethod = {
    1: 'ID-kaart',
    2: 'Mobiil-ID',
    5: 'Ühekordsed koodid',
    6: 'PIN-kalkulaator',
    7: 'Koodikaart'
};

IPizza.serviceFields = {
    // Maksekorraldus
    1001: [
        'VK_SERVICE',
        'VK_VERSION',
        'VK_SND_ID',
        'VK_STAMP',
        'VK_AMOUNT',
        'VK_CURR',
        'VK_ACC',
        'VK_PANK',
        'VK_NAME',
        'VK_REF',
        'VK_MSG',
        'VK_MAC',
        'VK_RETURN',
        'VK_ENCODING',
        'VK_CHARSET',
        'VK_CANCEL',
        'VK_LANG',
        'VK_TIME_LIMIT'
    ],

    // Maksekorraldus ilma saajata (tuleneb lepingust)
    1002: [
        'VK_SERVICE',
        'VK_VERSION',
        'VK_SND_ID',
        'VK_STAMP',
        'VK_AMOUNT',
        'VK_CURR',
        'VK_REF',
        'VK_MSG',
        'VK_MAC',
        'VK_RETURN',
        'VK_ENCODING',
        'VK_CHARSET',
        'VK_CANCEL',
        'VK_LANG'
    ],

    1011: [
        'VK_SERVICE',
        'VK_VERSION',
        'VK_SND_ID',
        'VK_STAMP',
        'VK_AMOUNT',
        'VK_CURR',
        'VK_ACC',
        'VK_NAME',
        'VK_REF',
        'VK_MSG',
        'VK_RETURN',
        'VK_CANCEL',
        'VK_DATETIME',
        'VK_MAC',
        'VK_ENCODING',
        'VK_LANG'
    ],

    1012: [
        'VK_SERVICE',
        'VK_VERSION',
        'VK_SND_ID',
        'VK_STAMP',
        'VK_AMOUNT',
        'VK_CURR',
        'VK_REF',
        'VK_MSG',
        'VK_RETURN',
        'VK_CANCEL',
        'VK_DATETIME',
        'VK_MAC',
        'VK_ENCODING',
        'VK_LANG'
    ],

    // Autentimine ilma nonce'ta
    4011: ['VK_SERVICE', 'VK_VERSION', 'VK_SND_ID', 'VK_REPLY', 'VK_RETURN', 'VK_DATETIME', 'VK_RID', 'VK_MAC', 'VK_ENCODING', 'VK_LANG'],

    // Autentimine nonce'ga
    4012: ['VK_SERVICE', 'VK_VERSION', 'VK_SND_ID', 'VK_REC_ID', 'VK_NONCE', 'VK_RETURN', 'VK_DATETIME', 'VK_RID', 'VK_MAC', 'VK_ENCODING', 'VK_LANG']
};

IPizza.blockedFields = {
    1002: ['VK_ACC', 'VK_NAME'],

    4011: ['VK_NONCE', 'VK_REC_ID'],

    4012: ['VK_REPLY']
};

IPizza.signatureOrder = {
    // Maksekorraldus
    1001: ['VK_SERVICE', 'VK_VERSION', 'VK_SND_ID', 'VK_STAMP', 'VK_AMOUNT', 'VK_CURR', 'VK_ACC', 'VK_PANK', 'VK_NAME', 'VK_REF', 'VK_MSG'],

    // Maksekorraldus ilma saajata (tuleneb lepingust)
    1002: ['VK_SERVICE', 'VK_VERSION', 'VK_SND_ID', 'VK_STAMP', 'VK_AMOUNT', 'VK_CURR', 'VK_REF', 'VK_MSG'],

    1011: [
        'VK_SERVICE',
        'VK_VERSION',
        'VK_SND_ID',
        'VK_STAMP',
        'VK_AMOUNT',
        'VK_CURR',
        'VK_ACC',
        'VK_NAME',
        'VK_REF',
        'VK_MSG',
        'VK_RETURN',
        'VK_CANCEL',
        'VK_DATETIME'
    ],

    1012: ['VK_SERVICE', 'VK_VERSION', 'VK_SND_ID', 'VK_STAMP', 'VK_AMOUNT', 'VK_CURR', 'VK_REF', 'VK_MSG', 'VK_RETURN', 'VK_CANCEL', 'VK_DATETIME'],

    // Õnnestunud tehing
    1101: [
        'VK_SERVICE',
        'VK_VERSION',
        'VK_SND_ID',
        'VK_REC_ID',
        'VK_STAMP',
        'VK_T_NO',
        'VK_AMOUNT',
        'VK_CURR',
        'VK_REC_ACC',
        'VK_REC_NAME',
        'VK_SND_ACC',
        'VK_SND_NAME',
        'VK_REF',
        'VK_MSG',
        'VK_T_DATE'
    ],

    1111: [
        'VK_SERVICE',
        'VK_VERSION',
        'VK_SND_ID',
        'VK_REC_ID',
        'VK_STAMP',
        'VK_T_NO',
        'VK_AMOUNT',
        'VK_CURR',
        'VK_REC_ACC',
        'VK_REC_NAME',
        'VK_SND_ACC',
        'VK_SND_NAME',
        'VK_REF',
        'VK_MSG',
        'VK_T_DATETIME'
    ],

    // Katkestatud tehing
    1901: ['VK_SERVICE', 'VK_VERSION', 'VK_SND_ID', 'VK_REC_ID', 'VK_STAMP', 'VK_REF', 'VK_MSG'],

    1911: ['VK_SERVICE', 'VK_VERSION', 'VK_SND_ID', 'VK_REC_ID', 'VK_STAMP', 'VK_REF', 'VK_MSG'],

    // Tagasi lükatud tehing
    1902: ['VK_SERVICE', 'VK_VERSION', 'VK_SND_ID', 'VK_REC_ID', 'VK_STAMP', 'VK_REF', 'VK_MSG', 'VK_ERROR_CODE'],

    // Autentimisvastus ilma nonce'ta
    3012: [
        'VK_SERVICE',
        'VK_VERSION',
        'VK_USER',
        'VK_DATETIME',
        'VK_SND_ID',
        'VK_REC_ID',
        'VK_USER_NAME',
        'VK_USER_ID',
        'VK_COUNTRY',
        'VK_OTHER',
        'VK_TOKEN',
        'VK_RID'
    ],

    // Autentimisvastus nonce'ga
    3013: [
        'VK_SERVICE',
        'VK_VERSION',
        'VK_DATETIME',
        'VK_SND_ID',
        'VK_REC_ID',
        'VK_NONCE',
        'VK_USER_NAME',
        'VK_USER_ID',
        'VK_COUNTRY',
        'VK_OTHER',
        'VK_TOKEN',
        'VK_RID'
    ],

    // Autentimine ilma nonce'ta
    4011: ['VK_SERVICE', 'VK_VERSION', 'VK_SND_ID', 'VK_REPLY', 'VK_RETURN', 'VK_DATETIME', 'VK_RID'],

    // Autentimine nonce'ga
    4012: ['VK_SERVICE', 'VK_VERSION', 'VK_SND_ID', 'VK_REC_ID', 'VK_NONCE', 'VK_RETURN', 'VK_DATETIME', 'VK_RID']
};

IPizza.responseService = {
    1001: {
        ok: '1101',
        fail: '1901',
        reject: '1902'
    },

    1002: {
        ok: '1101',
        fail: '1901',
        reject: '1902'
    },

    1011: {
        ok: '1111',
        fail: '1911',
        reject: '1911'
    },

    1012: {
        ok: '1111',
        fail: '1911',
        reject: '1911'
    },

    4011: {
        ok: '3012'
    },

    4012: {
        ok: '3013'
    }
};

// ++ kohustuslikud meetodid

IPizza.prototype.validateClient = function(callback) {
    db.findOne(
        'project',
        {
            uid: this.fields.VK_SND_ID
        },
        (err, record) => {
            if (err) {
                return callback(err);
            }

            if (!record) {
                return callback(null, {
                    success: false,
                    errors: [
                        {
                            field: 'VK_SND_ID',
                            value: (this.fields.VK_SND_ID || '').toString(),
                            error: 'Sellise kliendi tunnusega makselahendust ei leitud. Juhul kui sertifikaat on aegunud, tuleks see uuesti genereerida'
                        }
                    ],
                    warnings: false
                });
            }

            if (this.bank.key !== record.bank) {
                return callback(null, {
                    success: false,
                    errors: [
                        {
                            field: 'VK_SND_ID',
                            value: (this.fields.VK_SND_ID || '').toString(),
                            error: util.format(
                                'Valitud kliendi tunnus kehtib ainult "%s" makselahenduse jaoks, hetkel on valitud "%s"',
                                banks[record.bank].name,
                                this.bank.name
                            )
                        }
                    ],
                    warnings: false
                });
            }

            this.record = record;

            callback(null, {
                success: true,
                errors: false,
                warnings: false
            });
        }
    );
};

IPizza.prototype.validateSignature = function(callback) {
    this.calculateHash();

    tools.opensslVerify(this.sourceHash, this.fields.VK_MAC, this.record.userCertificate.certificate.toString('utf-8').trim(), this.charset, (err, success) => {
        if (err) {
            return callback(err);
        }
        callback(null, {
            success: !!success,
            errors: !success
                ? [
                    {
                        field: 'VK_MAC',
                        error: util.format('Allkirja parameetri %s valideerimine ebaõnnestus.', 'VK_MAC'),
                        download: true
                    }
                ]
                : false,
            warnings: false
        });
    });
};

IPizza.prototype.sign = function(callback) {
    this.calculateHash();

    tools.opensslSign(this.sourceHash, this.record.bankCertificate.clientKey.toString('utf-8').trim(), this.charset, (err, signature) => {
        if (err) {
            return callback(err);
        }
        this.fields.VK_MAC = signature;
        callback(null, true);
    });
};

IPizza.prototype.signClient = function(callback) {
    this.calculateHash();

    tools.opensslSign(this.sourceHash, this.record.userCertificate.clientKey.toString('utf-8').trim(), this.charset, (err, signature) => {
        if (err) {
            return callback(err);
        }
        this.fields.VK_MAC = signature;
        callback(null, true);
    });
};

IPizza.prototype.validateRequest = function(callback) {
    let validator = new IPizzaValidator(this.bank, this.fields);
    validator.validateFields();
    this.errors = validator.errors;
    this.warnings = validator.warnings;

    callback(null, {
        success: !this.errors.length,
        errors: (this.errors.length && this.errors) || false,
        warnings: (this.warnings.length && this.warnings) || false
    });
};

IPizza.prototype.getUid = function() {
    return this.fields.VK_SND_ID;
};

IPizza.prototype.getCharset = function() {
    return this.charset;
};

IPizza.prototype.getLanguage = function() {
    return tools.languages[this.language] || 'et';
};

IPizza.prototype.getSourceHash = function() {
    return this.sourceHash || false;
};

IPizza.prototype.getType = function() {
    return IPizza.serviceTypes[this.fields.VK_SERVICE] || false;
};

IPizza.prototype.getAmount = function() {
    return this.fields.VK_AMOUNT || '0';
};

IPizza.prototype.getReferenceCode = function() {
    return this.fields.VK_REF || false;
};

IPizza.prototype.getMessage = function() {
    return this.fields.VK_MSG || false;
};

IPizza.prototype.getCurrency = function() {
    return this.fields.VK_CURR || 'EUR';
};

IPizza.prototype.getReceiverName = function() {
    if (this.fields.VK_SERVICE === '1002') {
        return (this.record && (this.record.ipizzaReceiverName || this.record.name)) || false;
    } else {
        return this.fields.VK_NAME || false;
    }
};

IPizza.prototype.getReceiverAccount = function() {
    if (this.fields.VK_SERVICE === '1002') {
        return (this.record && this.record.ipizzaReceiverAccount) || this.bank.accountNr || '';
    } else {
        return this.fields.VK_ACC || false;
    }
};

IPizza.prototype.editSenderName = function() {
    return true;
};

IPizza.prototype.showSenderName = function() {
    return false;
};

IPizza.prototype.editSenderAccount = function() {
    return true;
};

IPizza.prototype.showSenderAccount = function() {
    return false;
};

IPizza.prototype.showReceiverName = function() {
    return true;
};

IPizza.prototype.showReceiverAccount = function() {
    return true;
};

IPizza.prototype.getSuccessTarget = function() {
    return this.fields[this.bank.returnAddress] || '';
};

IPizza.prototype.getCancelTarget = function() {
    return this.fields[this.bank.cancelAddress] || this.fields[this.bank.returnAddress] || '';
};

IPizza.prototype.getRejectTarget = function() {
    return this.fields[this.bank.rejectAddress] || this.fields[this.bank.returnAddress] || '';
};

IPizza.prototype.getNonce = function() {
    return this.fields.VK_NONCE;
};

IPizza.prototype.getRid = function() {
    return this.fields.VK_RID;
};

IPizza.prototype.showAuthForm = function() {
    return ['4011', '4012'].indexOf(this.fields.VK_SERVICE) >= 0;
};

IPizza.prototype.editAuthUser = function() {
    return this.fields.VK_SERVICE === '4011';
};

// -- kohustuslikud meetodid

IPizza.prototype.calculateHash = function() {
    let list = [];

    let utf8length = this.bank.utf8length || 'symbols';

    if (this.fields.VK_SERVICE in IPizza.signatureOrder) {
        IPizza.signatureOrder[this.fields.VK_SERVICE].forEach(vk => {
            if (vk === 'VK_PANK' && !this.bank.useVK_PANK) {
                return;
            }

            let val = this.fields[vk] || '',
                len = String(val).length;

            if (utf8length === 'bytes' && this.charset.match(/^utf[\-_]?8$/i)) {
                len = Buffer.byteLength(String(val), 'utf-8');
            }

            list.push(String(len).lpad(3) + val);
        });

        this.sourceHash = list.join('');
    } else {
        this.sourceHash = false;
    }
};

IPizza.prototype.normalizeValues = function() {
    let keys = Object.keys(this.fields);

    for (let i = 0, len = keys.length; i < len; i++) {
        if (this.fields[keys[i]] || this.fields[keys[i]] === 0) {
            this.fields[keys[i]] = this.fields[keys[i]].toString().trim();
        } else {
            this.fields[keys[i]] = '';
        }
    }
};

function IPizzaValidator(bank, fields) {
    this.bank = (typeof bank === 'string' ? banks[bank] || banks.ipizza || {} : bank) || {};
    this.fields = fields || {};

    this.errors = [];
    this.warnings = [];
}

IPizzaValidator.prototype.validateFields = function() {
    let service = (this.fields.VK_SERVICE || '').toString(),
        response = this.validate_VK_SERVICE();

    this.errors = [];
    this.warnings = [];

    if (typeof response === 'string') {
        this.errors.push({
            field: 'VK_SERVICE',
            value: service,
            error: response
        });
        return;
    }

    IPizza.serviceFields[service].forEach(field => {
        let response = this['validate_' + field](),
            value = (this.fields[field] || '').toString();

        if (typeof response === 'string') {
            this.errors.push({
                field,
                value,
                error: response
            });
        } else if (this.bank.fieldLength && this.bank.fieldLength[field] && value.length > this.bank.fieldLength[field]) {
            this.warnings.push({
                field,
                value,
                warning: util.format('Välja %s pikkus on %s sümbolit, lubatud on %s', field, value.length, this.bank.fieldLength[field])
            });
        } else if (
            this.bank.fieldRegex &&
            this.bank.fieldRegex[field] &&
            !value.match(new RegExp(this.bank.fieldRegex[field].re, this.bank.fieldRegex[field].flags))
        ) {
            this.errors.push({
                field,
                value,
                error: util.format('Väli %s sisaldab vigaseid sümboleid', field)
            });
        }
    });

    [].concat(IPizza.blockedFields[service] || []).forEach(field => {
        if (this.fields[field]) {
            this.warnings.push({
                field,
                value: (this.fields[field] || '').toString(),
                warning: util.format('Teenuse %s puhul ei ole välja %s kasutamine lubatud', service, field)
            });
        }
    });
};

IPizzaValidator.prototype.validate_VK_SERVICE = function() {
    let value = (this.fields.VK_SERVICE || '').toString();

    if (!value) {
        return util.format('Teenuskoodi %s väärtust ei leitud', 'VK_SERVICE');
    }

    if (!value.match(/^\d{4}$/)) {
        return util.format('Teenuskoodi %s ("%s") väärtus peab olema neljakohaline number', 'VK_SERVICE', value);
    }

    if (!IPizza.serviceFields[value] || (this.bank.allowedServices && this.bank.allowedServices.indexOf(value) < 0)) {
        if (['1011', '1012', '4011', '4012'].indexOf(value) >= 0) {
            return util.format(
                'Teenuskoodi %s ("%s") väärtus ei ole selle makselahenduse korral toetatud. Pangalingi uue protokolli kasutamiseks tuleb luua uus makselahendus.',
                'VK_SERVICE',
                value
            );
        } else {
            return util.format(
                'Teenuskoodi %s ("%s") väärtus ei ole toetatud. Kasutada saab järgmisi väärtuseid: %s',
                'VK_SERVICE',
                value,
                (this.bank.allowedServices || Object.keys(IPizza.serviceFields)).join(', ')
            );
        }
    }

    return true;
};

IPizzaValidator.prototype.validate_VK_VERSION = function() {
    let value = (this.fields.VK_VERSION || '').toString();

    if (!value) {
        return util.format('Krüptoalgoritmi %s väärtust ei leitud', 'VK_SERVICE');
    }

    if (value !== '008') {
        return util.format('Krüptoalgoritmi %s ("%s") väärtus peab olema %s', 'VK_VERSION', value, '008');
    }

    return true;
};

IPizzaValidator.prototype.validate_VK_SND_ID = function() {
    let value = (this.fields.VK_SND_ID || '').toString();

    if (!value) {
        return util.format('Päringu koostaja tunnus %s peab olema määratud', 'VK_SND_ID');
    }

    return true;
};

IPizzaValidator.prototype.validate_VK_REC_ID = function() {
    let value = (this.fields.VK_REC_ID || '').toString();

    if (value.toUpperCase() !== this.bank.id) {
        this.warnings.push({
            field: 'VK_REC_ID',
            value,
            warning: util.format('Panga identifikaator %s ("%s") ei vasta väärtusele %s', 'VK_REC_ID', value, this.bank.id)
        });
    }

    return true;
};

IPizzaValidator.prototype.validate_VK_STAMP = function() {
    let value = (this.fields.VK_STAMP || '').toString();

    if (!value) {
        return util.format('Päringu identifikaator %s peab olema määratud', 'VK_STAMP');
    }

    if (!value.match(/^\d+$/)) {
        return util.format('Päringu identifikaator %s ("%s") peab olema numbriline väärtus', 'VK_STAMP', value);
    }

    return true;
};

IPizzaValidator.prototype.validate_VK_AMOUNT = function() {
    let value = (this.fields.VK_AMOUNT || '').toString();

    if (!value) {
        return util.format('Makse summa %s peab olema määratud', 'VK_AMOUNT');
    }

    if (!value.match(/^\d{0,}(\.\d{1,2})?$/)) {
        return util.format('Makse summa  %s ("%s") peab olema kujul "123.45"', 'VK_AMOUNT', value);
    }

    return true;
};

IPizzaValidator.prototype.validate_VK_CURR = function() {
    let value = (this.fields.VK_CURR || '').toString();

    if (!value) {
        return util.format('Valuuta tähis %s peab olema määratud', 'VK_CURR');
    }

    if (IPizza.allowedCurrencies.indexOf(value) < 0) {
        return util.format('Valuuta tähis %s ("%s") peab olema üks järgmisest nimekirjast: ', 'VK_CURR', value, IPizza.allowedCurrencies.join(', '));
    }

    return true;
};

IPizzaValidator.prototype.validate_VK_ACC = function() {
    let field = 'VK_ACC';
    let value = (this.fields[field] || '').toString();

    let clen = IBAN.countries[this.bank.country].length - 6;
    let bban = value.substr(-clen);

    if (!value) {
        return util.format('Saaja konto number %s peab olema määratud', field);
    }

    if (!IBAN.isValid(value)) {
        if (bban.length < clen) {
            bban = new Array(clen - bban.length + 1).join('0') + bban;
        }

        bban = [].concat(this.bank.prefix || ['99']).shift() + bban;

        if (!IBAN.isValidBBAN(this.bank.country, bban)) {
            if (this.bank.forceIban) {
                return util.format('Saaja konto number %s ("%s") peab vastama IBAN formaadile', field, value);
            } else {
                this.warnings.push({
                    field,
                    value,
                    warning: util.format('Saaja konto number %s ("%s") ei vasta IBAN formaadile', field, value)
                });
            }
        } else {
            bban = IBAN.fromBBAN(this.bank.country, bban);

            if (this.bank.forceIban) {
                return util.format('Saaja konto number %s ("%s") peab vastama IBAN formaadile (peaks olema "%s")', field, value, bban);
            } else {
                this.warnings.push({
                    field,
                    value,
                    warning: util.format('Saaja konto number %s ("%s") ei vasta IBAN formaadile (peaks olema "%s")', field, value, bban)
                });
            }
        }
    }

    return true;
};

IPizzaValidator.prototype.validate_VK_NAME = function() {
    let value = (this.fields.VK_NAME || '').toString();

    if (!value) {
        return util.format('Saaja nimi %s peab olema määratud', 'VK_NAME');
    }

    return true;
};

IPizzaValidator.prototype.validate_VK_DATETIME = function() {
    let value = (this.fields.VK_DATETIME || '').toString();

    if (!value) {
        return util.format('Kuupäev %s peab olema määratud', 'VK_DATETIME');
    }

    if (!/^\d{4}\-\d{2}\-\d{2}T\d{2}:\d{2}:\d{2}[+\-]\d{4}$/.test(value)) {
        return util.format('Kuupäev %s peab olema vormingus "%s"', 'VK_DATETIME', moment().format('YYYY-MM-DDTHH:mm:ssZZ'));
    }

    if (new Date(value) < new Date(Date.now() - 5 * 60 * 1000) || new Date(value) > new Date(Date.now() + 5 * 60 * 1000)) {
        this.warnings.push({
            field: 'VK_DATETIME',
            value,
            warning: util.format(
                'Ajatempel %s ("%s") peab jääma vahemikku +/- 5 minutit serveri ajast ("%s")',
                'VK_DATETIME',
                value,
                moment().format('YYYY-MM-DDTHH:mm:ssZZ')
            )
        });
    }

    return true;
};

IPizzaValidator.prototype.validate_VK_TIME_LIMIT = function() {
    if (!this.bank.useVK_TIME_LIMIT) {
        return true;
    }

    let value = (this.fields.VK_TIME_LIMIT || '').toString();

    if (!value) {
        return true;
    }

    if (!/^\d{4}\-\d{2}\-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) {
        return util.format('Ajalimiit %s peab olema vormingus "%s"', 'VK_TIME_LIMIT', moment().format('YYYY-MM-DD HH:mm:ss'));
    }

    if (new Date(value) < new Date(Date.now() - 5 * 60 * 1000)) {
        this.warnings.push({
            field: 'VK_TIME_LIMIT',
            value,
            warning: util.format('Ajalimiit %s ("%s") on serveri ajast maas ("%s")', 'VK_TIME_LIMIT', value, moment().format('YYYY-MM-DD HH:mm:ss'))
        });
    }

    return true;
};

IPizzaValidator.prototype.validate_VK_PANK = function() {
    if (!this.bank.useVK_PANK) {
        return true;
    }

    let value = (this.fields.VK_PANK || '').toString();

    if (!value) {
        return util.format('Panga kood %s peab olema määratud', 'VK_PANK');
    }

    return true;
};

IPizzaValidator.prototype.validate_VK_REF = function() {
    let value = (this.fields.VK_REF || '').toString(),
        refNumber;

    if (!value) {
        return true;
    }

    if (!value.match(/^\d{2,}$/)) {
        return util.format('Viitenumber %s ("%s") peab olema vähemalt kahekohaline number', 'VK_REF', value);
    }

    refNumber = tools.getReferenceCode(value.substr(0, value.length - 1));

    if (refNumber !== value) {
        return util.format('Viitenumber %s on vigane - oodati väärtust "%s", tegelik väärtus on "%s"', 'VK_REF', refNumber, value);
    }

    return true;
};

IPizzaValidator.prototype.validate_VK_MSG = function() {
    return true;
};

IPizzaValidator.prototype.validate_VK_RETURN = function() {
    let value = (this.fields.VK_RETURN || '').toString(),
        vkList = (value && tools.validateReturnURL(value)) || [];

    if (!value) {
        return util.format('Tagasisuunamise aadress %s peab olema määratud', 'VK_RETURN');
    }

    if (vkList.length) {
        return util.format('Tagasisuunamise aadress %s ei tohi sisaldada VK_ algusega GET parameetreid. Hetkel kasutatud: %s', 'VK_RETURN', vkList.join(', '));
    }

    if (!!this.bank.disallowQueryParams && (urllib.parse(value).query || '').length) {
        this.warnings.push({
            field: 'VK_RETURN',
            value,
            warning: util.format('%s ei võimalda kasutada tagasisuunamise aadressi %s milles sisaldub GET parameetreid', this.bank.name, 'VK_RETURN')
        });
    }

    return true;
};

IPizzaValidator.prototype.validate_VK_CANCEL = function() {
    let value = (this.fields.VK_CANCEL || '').toString(),
        vkList = (value && tools.validateReturnURL(value)) || [];

    if ('VK_CANCEL' in this.fields && this.bank.cancelAddress !== 'VK_CANCEL') {
        this.warnings.push({
            field: 'VK_CANCEL',
            value,
            warning: util.format(
                '%s ei võimalda kasutada tagasisuunamise aadressi %s, selle asemel tuleks kasutada aadressi %s',
                this.bank.name,
                'VK_CANCEL',
                'VK_RETURN'
            )
        });
    }

    if (value && vkList.length) {
        return util.format('Tagasisuunamise aadress %s ei tohi sisaldada VK_ algusega GET parameetreid. Hetkel kasutatud: %s', 'VK_CANCEL', vkList.join(', '));
    }

    return true;
};

IPizzaValidator.prototype.validate_VK_ENCODING = function() {
    let value = (this.fields.VK_ENCODING || '').toString(),
        allowedCharsets = this.bank.allowedCharsets || [this.bank.defaultCharset],
        defaultCharset = this.bank.defaultCharset;

    if (!value && this.bank.charset === 'VK_ENCODING' && this.bank.forceCharset) {
        return this.bank.forceCharset;
    }

    if (!value) {
        return true;
    }

    if (!this.bank.charset) {
        return util.format('%s ei võimalda teksti kodeeringu seadmist parameetriga %s', this.bank.name, 'VK_ENCODING');
    }

    if (this.bank.charset !== 'VK_ENCODING') {
        return util.format('%s nõuab %s parameetri asemel parameetrit %s', this.bank.name, 'VK_ENCODING', this.bank.charset);
    }

    if (allowedCharsets.indexOf(value.toUpperCase()) < 0) {
        return util.format(
            'Teksti kodeeringu parameeter %s võib olla %s',
            'VK_ENCODING',
            tools.joinAsString(allowedCharsets, ', ', ' või ', defaultCharset, ' (vaikimisi)')
        );
    }

    return true;
};

IPizzaValidator.prototype.validate_VK_CHARSET = function() {
    let value = (this.fields.VK_CHARSET || '').toString(),
        allowedCharsets = this.bank.allowedCharsets || ['ISO-8859-1'],
        defaultCharset = this.bank.defaultCharset || 'ISO-8859-1';

    if (!value && this.bank.charset === 'VK_CHARSET' && this.bank.forceCharset) {
        return this.bank.forceCharset;
    }

    if (!value) {
        return true;
    }

    if (!this.bank.charset) {
        return util.format('%s ei võimalda teksti kodeeringu seadmist parameetriga %s', this.bank.name, 'VK_CHARSET');
    }

    if (this.bank.charset !== 'VK_CHARSET') {
        return util.format('%s nõuab %s parameetri asemel parameetrit %s', this.bank.name, 'VK_CHARSET', this.bank.charset);
    }

    if (allowedCharsets.indexOf(value.toUpperCase()) < 0) {
        return util.format(
            'Teksti kodeeringu parameeter %s ("%s") võib olla %s',
            'VK_CHARSET',
            value,
            tools.joinAsString(allowedCharsets, ', ', ' või ', defaultCharset, ' (vaikimisi)')
        );
    }

    return true;
};

IPizzaValidator.prototype.validate_VK_LANG = function() {
    let value = (this.fields.VK_LANG || '').toString();

    if (value && IPizza.languages.indexOf(value.toUpperCase().trim()) < 0) {
        return util.format(
            'Keele valiku parameeter %s ("%s") võib olla %s',
            'VK_LANG',
            value,
            tools.joinAsString(IPizza.languages, ', ', ' või ', IPizza.defaultLanguage, ' (vaikimisi)')
        );
    }

    return true;
};

IPizzaValidator.prototype.validate_VK_MAC = function() {
    let value = (this.fields.VK_MAC || '').toString();

    if (!value) {
        return util.format('Allkirja parameeter %s peab olema määratud', 'VK_MAC');
    }

    if (!value.match(/[^\-A-Za-z0-9+\/]+(={0,2})?$/)) {
        return util.format('Allkirja parameeter %s peab olema BASE64 formaadis', 'VK_MAC');
    }

    if (new Buffer(value, 'base64').length % 128) {
        return util.format(
            'Allkirja parameeter %s on vale pikkusega, väärtus vastab %s bitisele võtmele, lubatud on 1024, 2048 ja 4096 bitised võtmed',
            'VK_MAC',
            new Buffer(value, 'base64').length * 8
        );
    }

    return true;
};

IPizzaValidator.prototype.validate_VK_REPLY = function() {
    let value = (this.fields.VK_REPLY || '').toString();

    if (!value) {
        return util.format('Oodatava vastuspaketi koodi %s väärtust ei leitud', 'VK_REPLY');
    }

    if (value !== '3012') {
        return util.format('Oodatava vastuspaketi koodi %s ("%s") väärtus peab olema %s', 'VK_REPLY', value, '3012');
    }

    return true;
};

IPizzaValidator.prototype.validate_VK_RID = function() {
    let value = (this.fields.VK_RID || '').toString();

    if (!value) {
        this.warnings.push({
            field: 'VK_RID',
            value,
            warning: util.format('Sessiooniga seotud identifikaatori %s väärtus puudub', 'VK_RID')
        });
    }

    return true;
};

IPizzaValidator.prototype.validate_VK_NONCE = function() {
    let value = (this.fields.VK_NONCE || '').toString();

    if (!value) {
        return util.format('Juhusliku nonssi %s väärtust ei leitud', 'VK_NONCE');
    }

    return true;
};

IPizza.generateForm = function(payment, project, callback) {
    tools.incrTransactionCounter(project.uid, (err, transactionId) => {
        if (err) {
            return callback(err);
        }

        let paymentFields = {};
        payment.fields.forEach(field => {
            paymentFields[field.key] = field.value;
        });

        let fields = {};
        if (payment.state === 'PAYED') {
            fields = {
                VK_SERVICE: IPizza.responseService[paymentFields.VK_SERVICE].ok,
                VK_VERSION: '008',
                VK_SND_ID: banks[project.bank].id,
                VK_REC_ID: paymentFields.VK_SND_ID,
                VK_STAMP: paymentFields.VK_STAMP,
                VK_T_NO: transactionId,
                VK_AMOUNT: paymentFields.VK_AMOUNT,
                VK_CURR: paymentFields.VK_CURR,
                VK_REC_ACC: paymentFields.VK_ACC || project.ipizzaReceiverAccount || '',
                VK_REC_NAME: paymentFields.VK_NAME || project.ipizzaReceiverName || '',
                VK_SND_ACC: payment.payment.senderAccount || '',
                VK_SND_NAME: payment.payment.senderName || '',
                VK_REF: paymentFields.VK_REF,
                VK_MSG: paymentFields.VK_MSG
            };

            if (banks[project.bank].useVK_PANK) {
                fields.VK_PANK = paymentFields.VK_PANK;
            }

            if (['1011', '1012'].indexOf(paymentFields.VK_SERVICE) < 0) {
                fields.VK_T_DATE = moment().format('DD.MM.YYYY');
            } else {
                fields.VK_T_DATETIME = moment().format('YYYY-MM-DDTHH:mm:ssZZ');
            }
        } else if (payment.state === 'REJECTED') {
            fields = {
                VK_SERVICE: IPizza.responseService[paymentFields.VK_SERVICE].reject,
                VK_VERSION: '008',
                VK_SND_ID: banks[project.bank].id,
                VK_REC_ID: paymentFields.VK_SND_ID,
                VK_STAMP: paymentFields.VK_STAMP,
                VK_REF: paymentFields.VK_REF,
                VK_MSG: paymentFields.VK_MSG,
                VK_ERROR_CODE: '1234'
            };
        } else if (payment.state === 'AUTHENTICATED') {
            fields = {
                VK_SERVICE: IPizza.responseService[paymentFields.VK_SERVICE].ok,
                VK_VERSION: '008',
                VK_DATETIME: moment().format('YYYY-MM-DDTHH:mm:ssZZ'),
                VK_SND_ID: banks[project.bank].id,
                VK_REC_ID: paymentFields.VK_SND_ID,
                VK_RID: paymentFields.VK_RID || ''
            };

            switch (paymentFields.VK_SERVICE) {
                case '4011':
                    fields.VK_USER = payment.payment.authUser;
                    fields.VK_USER_NAME = payment.payment.authUserName;
                    fields.VK_USER_ID = payment.payment.authUserId;
                    fields.VK_COUNTRY = payment.payment.authCountry;
                    fields.VK_OTHER = payment.payment.authOther;
                    fields.VK_TOKEN = payment.payment.authToken;
                    break;
                case '4012':
                    fields.VK_NONCE = paymentFields.VK_NONCE;
                    fields.VK_USER_NAME = payment.payment.authUserName;
                    fields.VK_USER_ID = payment.payment.authUserId;
                    fields.VK_COUNTRY = payment.payment.authCountry;
                    fields.VK_OTHER = payment.payment.authOther;
                    fields.VK_TOKEN = payment.payment.authToken;
                    break;
            }
        } else {
            fields = {
                VK_SERVICE: IPizza.responseService[paymentFields.VK_SERVICE].fail,
                VK_VERSION: '008',
                VK_SND_ID: banks[project.bank].id,
                VK_REC_ID: paymentFields.VK_SND_ID,
                VK_STAMP: paymentFields.VK_STAMP,
                VK_REF: paymentFields.VK_REF,
                VK_MSG: paymentFields.VK_MSG
            };
        }

        let transaction = new IPizza(project.bank, fields, payment.charset);
        transaction.record = project;

        if (paymentFields[banks[project.bank].charset]) {
            fields[transaction.bank.charset] = paymentFields[transaction.bank.charset];
        }

        if (paymentFields.VK_LANG) {
            fields.VK_LANG = paymentFields.VK_LANG;
        }

        transaction.sign(err => {
            if (err) {
                return callback(err);
            }

            if (payment.state !== 'AUTHENTICATED') {
                fields.VK_AUTO = 'Y';
            }

            let method = transaction.bank.returnMethod || 'POST',
                payload = tools.stringifyQuery(fields, payment.charset),
                url = payment.state === 'PAYED' ? payment.successTarget : payment.state === 'REJECTED' ? payment.rejectTarget : payment.cancelTarget,
                resultUrl = url,
                hostname = (urllib.parse(url).hostname || '').toLowerCase().trim(),
                localhost = !!/(^localhost|^127\.0\.0\.1|^::1|\.lan|\.local)$/i.test(hostname),
                headers = {};

            if (method === 'GET') {
                url += (url.match(/\?/) ? '&' : '?') + payload;
                payload = false;
            } else if (method === 'POST') {
                headers['content-type'] = 'application/x-www-form-urlencoded';
            }

            if (payment.state === 'PAYED' && !localhost) {
                fetchUrl(
                    url,
                    {
                        method,
                        payload: payload ? payload : undefined,
                        agent: false,
                        maxResponseLength: 100 * 1024 * 1024,
                        timeout: 10000,
                        disableRedirects: true,
                        userAgent: config.hostname + ' (automaatsed testmaksed)',
                        headers,
                        rejectUnauthorized: false
                    },
                    (err, meta, body) => {
                        if (err) {
                            payment.autoResponse = {
                                status: false,
                                error: err.message,
                                method,
                                url,
                                fields: payload
                                    ? Object.keys(fields).map(key => ({
                                        key,
                                        value: fields[key]
                                    }))
                                    : false
                            };
                        } else {
                            payment.autoResponse = {
                                statusCode: meta.status,
                                headers: meta.responseHeaders,
                                body: body && body.toString()
                            };
                        }
                        fields.VK_AUTO = 'N';
                        method = 'POST'; // force POST

                        if (method === 'GET') {
                            resultUrl += (resultUrl.match(/\?/) ? '&' : '?') + tools.stringifyQuery(fields, payment.charset);
                        }
                        payment.responseFields = fields;
                        payment.responseHash = transaction.sourceHash;
                        payment.returnMethod = method;
                        callback(null, {
                            method,
                            url: resultUrl,
                            payload
                        });
                    }
                );
            } else {
                if (localhost && payment.state !== 'AUTHENTICATED') {
                    payment.autoResponse = {
                        status: false,
                        error: 'localhost automaatpäringud ei ole lubatud',
                        method,
                        url,
                        fields: payload
                            ? Object.keys(fields).map(key => ({
                                key,
                                value: fields[key]
                            }))
                            : false
                    };
                }

                if ((fields.VK_SERVICE || '').toString().charAt(0) !== '3') {
                    fields.VK_AUTO = 'N';
                }

                method = 'POST'; // force POST

                if (method === 'GET') {
                    resultUrl += (resultUrl.match(/\?/) ? '&' : '?') + tools.stringifyQuery(fields, payment.charset);
                }
                payment.responseFields = fields;
                payment.responseHash = transaction.sourceHash;
                payment.returnMethod = method;
                callback(null, {
                    method,
                    url: resultUrl,
                    payload
                });
            }
        });
    });
};
