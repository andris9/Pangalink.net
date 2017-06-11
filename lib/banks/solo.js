'use strict';

const config = require('config');
const util = require('util');
const banks = require('../banks');
const tools = require('../tools');
const db = require('../db');
const crypto = require('crypto');
const fetchUrl = require('fetch').fetchUrl;
const urllib = require('url');
const IBAN = require('iban');

module.exports = Solo;

function Solo(bank, fields, charset) {
    this.bank = (typeof bank === 'string' ? banks[bank] || banks.ipizza || {} : bank) || {};
    this.fields = fields || {};

    this.normalizeValues();

    this.version = Solo.detectVersion(this.bank, this.fields);

    this.language = Solo.detectLanguage(this.bank, this.fields);
    this.charset = charset || Solo.detectCharset(this.bank, this.fields);

    this.keyPrefix = '';

    if (this.fields.SOLOPMT_VERSION || this.version === '0002') {
        this.keyPrefix = 'SOLOPMT_';
    }

    this.uid = this.fields.SOLOPMT_RCV_ID || this.fields.RCV_ID;

    this.service = 'PAYMENT-IN';
}

Solo.samplePayment = function(project, urlPrefix, options, callback) {
    let bank = banks[project.bank] || banks.ipizza,
        charsetValue;

    charsetValue = 'iso-8859-1';

    let testFields = {
        SOLOPMT_VERSION: '0003',
        SOLOPMT_RCV_ID: project.uid,
        SOLOPMT_RCV_ACCOUNT: options.acc || bank.accountNr,
        'SOLOPMT_RCV_NAME ': options.name || 'ÕIE MÄGER',
        SOLOPMT_STAMP: '12345',
        SOLOPMT_AMOUNT: options.amount || '150',
        SOLOPMT_CUR: 'EUR',
        SOLOPMT_DATE: 'EXPRESS',
        SOLOPMT_CONFIRM: 'YES',
        SOLOPMT_REF: options.ref || '1234561',
        SOLOPMT_MSG: options.msg || 'testmakseÄ',
        SOLOPMT_LANGUAGE: '3',
        SOLOPMT_KEYVERS: '0001',
        SOLOPMT_RETURN: '%RETURN%'
    };

    if (bank.cancelAddress && bank.cancelAddress !== 'RETURN') {
        testFields['SOLOPMT_' + bank.cancelAddress] = '%CANCEL%';
    }

    if (bank.rejectAddress && bank.rejectAddress !== 'RETURN') {
        testFields['SOLOPMT_' + bank.rejectAddress] = '%REJECT%';
    }

    let payment = new Solo(project.bank, testFields, charsetValue);
    payment.record = project;

    payment.editable = {
        name: {
            field: 'SOLOPMT_RCV_NAME',
            name: 'Saaja nimi',
            value: testFields.SOLOPMT_RCV_NAME
        },
        acc: {
            field: 'SOLOPMT_RCV_ACCOUNT',
            name: 'Saaja konto',
            value: testFields.SOLOPMT_RCV_ACCOUNT
        },
        amount: {
            field: 'SOLOPMT_AMOUNT',
            name: 'Summa',
            value: testFields.SOLOPMT_AMOUNT
        },
        msg: {
            field: 'SOLOPMT_MSG',
            name: 'Kirjeldus',
            value: testFields.SOLOPMT_MSG
        },
        ref: {
            field: 'SOLOPMT_REF',
            name: 'Viitenumber',
            value: testFields.SOLOPMT_REF
        }
    };

    payment.signClient(err => {
        if (err) {
            return callback(err);
        }
        callback(null, payment, charsetValue);
    });
};

Solo.detectVersion = function(bank, fields) {
    return fields.SOLOPMT_VERSION || fields.VERSION || '0002';
};

Solo.detectLanguage = function(bank, fields) {
    bank = (typeof bank === 'string' ? banks[bank] || banks.ipizza || {} : bank) || {};

    let language = (fields.SOLOPMT_LANGUAGE || fields.LANGUAGE || '4').trim();
    if (!Solo.languages[language]) {
        return Solo.defaultLanguage;
    } else {
        return Solo.languages[language];
    }
};

Solo.detectCharset = function(bank) {
    bank = (typeof bank === 'string' ? banks[bank] || banks.ipizza || {} : bank) || {};

    return bank.defaultCharset;
};

Solo.versions = ['0002', '0003', '0004'];

Solo.allowedCurrencies = ['EUR', 'LVL', 'LTL'];

Solo.languages = {
    1: 'FIN',
    2: 'SWE',
    3: 'ENG',
    4: 'EST',
    5: 'RUS',
    6: 'LAT',
    7: 'LIT'
};

Solo.defaultLanguage = 'EST';

Solo.serviceFields = {
    // Maksekorraldus
    'PAYMENT-IN': [
        'VERSION',
        'STAMP',
        'RCV_ID',
        'RCV_ACCOUNT',
        'RCV_NAME',
        'LANGUAGE',
        'AMOUNT',
        'REF',
        'TAX_CODE',
        'DATE',
        'MSG',
        'RETURN',
        'CANCEL',
        'REJECT',
        'MAC',
        'CONFIRM',
        'KEYVERS',
        'CUR'
    ]
};

Solo.signatureOrder = {
    '0002': {
        'PAYMENT-IN': ['VERSION', 'STAMP', 'RCV_ID', 'AMOUNT', 'REF', 'DATE', 'CUR'],
        'PAYMENT-OUT': ['RETURN_VERSION', 'RETURN_STAMP', 'RETURN_REF', 'RETURN_PAID']
    },

    '0004': {
        'PAYMENT-IN': ['VERSION', 'STAMP', 'RCV_ID', 'AMOUNT', 'REF', 'TAX_CODE', 'DATE', 'CUR'],
        'PAYMENT-OUT': [
            'RETURN_VERSION',
            'RETURN_STAMP',
            'RETURN_REF',
            'RETURN_PAYER_NAME',
            'RETURN_PAYER_ACCOUNT',
            'RETURN_TAX_CODE',
            'RETURN_MSG',
            'RETURN_PAID'
        ]
    }
};

Solo.signatureOrder['0003'] = Solo.signatureOrder['0002'];
// ++ kohustuslikud meetodid

Solo.prototype.validateClient = function(callback) {
    db.findOne(
        'project',
        {
            uid: this.uid
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
                            field: this.keyPrefix + 'RCV_ID',
                            value: (this.fields[this.keyPrefix + 'RCV_ID'] || '').toString(),
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
                            field: this.keyPrefix + 'RCV_ID',
                            value: (this.fields[this.keyPrefix + 'RCV_ID'] || '').toString(),
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

Solo.prototype.validateSignature = function(callback) {
    this.calculateHash();

    let mac;

    try {
        mac = crypto.createHash(this.record.soloAlgo).update(this.sourceHash).digest('hex').toUpperCase();
    } catch (E) {
        return callback(E);
    }

    if (mac === this.fields[this.keyPrefix + 'MAC']) {
        return callback(null, {
            success: true,
            errors: false,
            warnings: false
        });
    }

    callback(null, {
        success: false,
        errors: {
            field: this.fields[this.keyPrefix + 'MAC'],
            error: util.format('Allkirja parameetri %s valideerimine ebaõnnestus.', this.keyPrefix + 'MAC'),
            download: true
        },
        warnings: false
    });
};

Solo.prototype.sign = function(callback) {
    this.calculateHash();

    try {
        this.fields[this.keyPrefix + 'RETURN_MAC'] = crypto.createHash(this.record.soloAlgo).update(this.sourceHash).digest('hex').toUpperCase();
    } catch (E) {
        return callback(E);
    }

    callback(null, true);
};

Solo.prototype.signClient = function(callback) {
    this.calculateHash();

    try {
        this.fields[this.keyPrefix + 'MAC'] = crypto.createHash(this.record.soloAlgo).update(this.sourceHash).digest('hex').toUpperCase();
    } catch (E) {
        return callback(E);
    }

    callback(null, true);
};

Solo.prototype.validateRequest = function(callback) {
    this.errors = this.processFieldNames() || [];

    if (this.errors.length > 3) {
        return callback(null, {
            success: !this.errors.length,
            errors: (this.errors.length && this.errors) || false,
            warnings: false
        });
    }

    let validator = new SoloValidator(this.bank, this.fields, this.service, this.version, this.keyPrefix, this.record.soloAlgo);
    validator.validateFields();
    this.errors = this.errors.concat(validator.errors);
    this.warnings = validator.warnings;

    callback(null, {
        success: !this.errors.length,
        errors: (this.errors.length && this.errors) || false,
        warnings: (this.warnings.length && this.warnings) || false
    });
};

Solo.prototype.processFieldNames = function() {
    let errors = [];

    Solo.serviceFields[this.service].forEach(key => {
        if (this.keyPrefix && key in this.fields) {
            errors.push({
                field: key,
                value: (this.fields[key] || '').toString(),
                error: util.format('Parameetri %s nimi peab algama SOLOPMT_ prefiksiga', key)
            });
        } else if (!this.keyPrefix && 'SOLOPMT_' + key in this.fields) {
            errors.push({
                field: 'SOLOPMT_' + key,
                value: (this.fields[key] || '').toString(),
                error: util.format('Parameetri %s nimi ei tohi sisaldada SOLOPMT_ prefiksit', 'SOLOPMT_' + key)
            });
        }
    });

    return errors;
};

Solo.prototype.getUid = function() {
    return this.fields[this.keyPrefix + 'RCV_ID'];
};

Solo.prototype.getCharset = function() {
    return this.charset;
};

Solo.prototype.getLanguage = function() {
    return tools.languages[this.language] || 'et';
};

Solo.prototype.getSourceHash = function() {
    return this.sourceHash || false;
};

Solo.prototype.getType = function() {
    return 'PAYMENT';
};

Solo.prototype.getAmount = function() {
    return this.fields[this.keyPrefix + 'AMOUNT'] || '0';
};

Solo.prototype.getReferenceCode = function() {
    return this.fields[this.keyPrefix + 'REF'] || false;
};

Solo.prototype.getMessage = function() {
    return this.fields[this.keyPrefix + 'MSG'] || false;
};

Solo.prototype.getCurrency = function() {
    return this.fields[this.keyPrefix + 'CUR'] || 'EUR';
};

Solo.prototype.getReceiverName = function() {
    return this.fields[this.keyPrefix + 'RCV_NAME'] || false;
};

Solo.prototype.getReceiverAccount = function() {
    return this.fields[this.keyPrefix + 'RCV_ACCOUNT'] || false;
};

Solo.prototype.editSenderName = function() {
    return true;
};

Solo.prototype.showSenderName = function() {
    return false;
};

Solo.prototype.editSenderAccount = function() {
    return true;
};

Solo.prototype.showSenderAccount = function() {
    return false;
};

Solo.prototype.showReceiverName = function() {
    return !!this.getReceiverName();
};

Solo.prototype.showReceiverAccount = function() {
    return !!this.getReceiverAccount();
};

Solo.prototype.getSuccessTarget = function() {
    return this.fields[this.keyPrefix + this.bank.returnAddress] || '';
};

Solo.prototype.getCancelTarget = function() {
    return this.fields[this.keyPrefix + this.bank.cancelAddress] || this.fields[this.keyPrefix + this.bank.returnAddress] || '';
};

Solo.prototype.getRejectTarget = function() {
    return this.fields[this.keyPrefix + this.bank.rejectAddress] || this.fields[this.keyPrefix + this.bank.returnAddress] || '';
};

// -- kohustuslikud meetodid

Solo.prototype.calculateHash = function() {
    let list = [];

    if (!Solo.signatureOrder[this.version]) {
        return;
    }

    if (!Solo.signatureOrder[this.version][this.service]) {
        return;
    }

    Solo.signatureOrder[this.version][this.service].forEach(vk => {
        let val = this.fields[this.keyPrefix + vk] || '';
        list.push(val);
    });

    list.push(this.record.secret);
    list.push('');

    this.sourceHash = list.join('&');
};

Solo.prototype.normalizeValues = function() {
    let keys = Object.keys(this.fields);

    for (let i = 0, len = keys.length; i < len; i++) {
        if (this.fields[keys[i]] || this.fields[keys[i]] === 0) {
            this.fields[keys[i]] = this.fields[keys[i]].toString().trim();
        } else {
            this.fields[keys[i]] = '';
        }
    }
};

Solo.prototype.getFields = function() {
    let fields = {};
    Solo.signatureOrder[this.version][this.service].forEach(key => {
        if (this.fields[this.keyPrefix + key]) {
            fields[this.keyPrefix + key] = this.fields[this.keyPrefix + key];
        }
    });

    if (this.fields[this.keyPrefix + 'RETURN_MAC']) {
        fields[this.keyPrefix + 'RETURN_MAC'] = this.fields[this.keyPrefix + 'RETURN_MAC'];
    }

    return fields;
};

function SoloValidator(bank, fields, service, version, keyPrefix, soloAlgo) {
    this.bank = (typeof bank === 'string' ? banks[bank] || banks.ipizza || {} : bank) || {};
    this.fields = fields || {};
    this.service = service || 'PAYMENT-IN';
    this.version = version || '0002';
    this.keyPrefix = keyPrefix || '';
    this.soloAlgo = (soloAlgo || 'md5').toUpperCase();

    this.errors = [];
    this.warnings = [];
}

SoloValidator.prototype.validateFields = function() {
    this.errors = [];
    this.warnings = [];

    Solo.serviceFields[this.service].forEach(field => {
        if (!this['validate_' + field]) {
            return;
        }

        let response = this['validate_' + field](),
            value = (this.fields[this.keyPrefix + field] || '').toString();

        if (typeof response === 'string') {
            this.errors.push({
                field: this.keyPrefix + field,
                value: (this.fields[this.keyPrefix + field] || '').toString(),
                error: response
            });
        } else if (this.bank.fieldLength && this.bank.fieldLength[field] && value.length > this.bank.fieldLength[field]) {
            this.warnings.push({
                field: this.keyPrefix + field,
                value,
                warning: util.format('Välja %s pikkus on %s sümbolit, lubatud on %s', this.keyPrefix + field, value.length, this.bank.fieldLength[field])
            });
        }
    });
};

/* VERSION */
SoloValidator.prototype.validate_VERSION = function() {
    let value = (this.fields[this.keyPrefix + 'VERSION'] || '').toString();

    if (!value) {
        return util.format('Teenuse versiooni %s väärtust ei leitud', this.keyPrefix + 'VERSION');
    }

    if (!value.match(/^\d{4}$/)) {
        return util.format('Teenuse versiooni %s ("%s") väärtus peab olema neljakohaline number', this.keyPrefix + 'VERSION', value);
    }

    if (Solo.versions.indexOf(value) < 0) {
        return util.format(
            'Teenuskoodi %s ("%s") väärtus ei ole toetatud. Kasutada saab järgmisi väärtuseid: %s',
            this.keyPrefix + 'VERSION',
            value,
            Solo.versions.join(', ')
        );
    }

    return true;
};

/* MAC */
SoloValidator.prototype.validate_MAC = function() {
    let value = (this.fields[this.keyPrefix + 'MAC'] || '').toString();

    if (!value) {
        return util.format('Allkirja parameeter %s peab olema määratud', this.keyPrefix + 'MAC');
    }

    if (!value.match(/^[A-F0-9]+$/)) {
        return util.format('Allkirja parameeter %s peab olema HEX formaadis ning sisaldama ainult suurtähti ning numbreid', this.keyPrefix + 'MAC');
    }

    let len = value.length;

    if (this.soloAlgo === 'md5' && len !== 32) {
        if (len === 40) {
            return util.format('Allkirja parameeter %s peab olema MD5 formaadis, kuid tundub olevat SHA1 formaadis', this.keyPrefix + 'MAC');
        }
        if (len === 64) {
            return util.format('Allkirja parameeter %s peab olema MD5 formaadis, kuid tundub olevat SHA256 formaadis', this.keyPrefix + 'MAC');
        }
    }

    if (this.soloAlgo === 'sha1' && len !== 40) {
        if (len === 32) {
            return util.format('Allkirja parameeter %s peab olema SHA1 formaadis, kuid tundub olevat MD5 formaadis', this.keyPrefix + 'MAC');
        }
        if (len === 64) {
            return util.format('Allkirja parameeter %s peab olema SHA1 formaadis, kuid tundub olevat SHA256 formaadis', this.keyPrefix + 'MAC');
        }
    }

    if (this.soloAlgo === 'sha256' && len !== 64) {
        if (len === 32) {
            return util.format('Allkirja parameeter %s peab olema SHA256 formaadis, kuid tundub olevat MD5 formaadis', this.keyPrefix + 'MAC');
        }
        if (len === 40) {
            return util.format('Allkirja parameeter %s peab olema SHA256 formaadis, kuid tundub olevat SHA1 formaadis', this.keyPrefix + 'MAC');
        }
    }

    return true;
};

/* STAMP */
SoloValidator.prototype.validate_STAMP = function() {
    let value = (this.fields[this.keyPrefix + 'STAMP'] || '').toString();

    if (!value) {
        return util.format('Maksekorralduse kood %s peab olema määratud', this.keyPrefix + 'STAMP');
    }

    if (!value.match(/^\d+$/)) {
        return util.format('Maksekorralduse kood %s peab olema numbriline väärtus', this.keyPrefix + 'STAMP');
    }

    return true;
};

/* RCV_ID */
SoloValidator.prototype.validate_RCV_ID = function() {
    let value = (this.fields[this.keyPrefix + 'RCV_ID'] || '').toString();

    if (!value) {
        return util.format('Päringu koostaja tunnus %s peab olema määratud', this.keyPrefix + 'RCV_ID');
    }

    return true;
};

/* RCV_ACCOUNT */
SoloValidator.prototype.validate_RCV_ACCOUNT = function() {
    let field = this.keyPrefix + 'RCV_ACCOUNT';
    let value = (this.fields[field] || '').toString();

    if (!value) {
        return true;
    }

    let clen = IBAN.countries[this.bank.country].length - 6;
    let bban = value.substr(-clen);

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

/* RCV_NAME */

/* LANGUAGE */
SoloValidator.prototype.validate_LANGUAGE = function() {
    let value = (this.fields[this.keyPrefix + 'LANGUAGE'] || '').toString();

    if (!value) {
        return util.format('Päringu koostaja tunnus %s peab olema määratud', this.keyPrefix + 'LANGUAGE');
    }

    if (!value.match(/^\d$/)) {
        return util.format('Keelevaliku tunnus %s peab olema ühekohaline number', this.keyPrefix + 'LANGUAGE');
    }

    return true;
};

/* AMOUNT */
SoloValidator.prototype.validate_AMOUNT = function() {
    let value = (this.fields[this.keyPrefix + 'AMOUNT'] || '').toString();

    if (!value) {
        return util.format('Makse summa %s peab olema määratud', this.keyPrefix + 'AMOUNT');
    }

    if (!value.match(/^\d{0,}(\.\d{1,2})?$/)) {
        return util.format('Makse summa %s peab olema kujul "123.45"', this.keyPrefix + 'AMOUNT');
    }

    return true;
};

/* REF */
SoloValidator.prototype.validate_REF = function() {
    let value = (this.fields[this.keyPrefix + 'REF'] || '').toString(),
        refNumber;

    if (!value) {
        return true;
    }

    if (!value.match(/^\d{2,}$/)) {
        return util.format('Viitenumber %s ("%s") peab olema vähemalt kahekohaline number', this.keyPrefix + 'REF', value);
    }

    refNumber = tools.getReferenceCode(value.substr(0, value.length - 1));

    if (refNumber !== value) {
        return util.format('Viitenumber %s on vigane - oodati väärtust "%s", tegelik väärtus on "%s"', this.keyPrefix + 'REF', refNumber, value);
    }

    return true;
};

/* TAX_CODE */
SoloValidator.prototype.validate_TAX_CODE = function() {
    let value = (this.fields[this.keyPrefix + 'TAX_CODE'] || '').toString();

    if (!value && this.version === '0004') {
        return util.format('Maksu kood %s peab olema versiooni %s puhul määratud', this.keyPrefix + 'TAX_CODE', '0004');
    }

    return true;
};

/* DATE */
SoloValidator.prototype.validate_DATE = function() {
    let value = (this.fields[this.keyPrefix + 'DATE'] || '').toString();

    if (!value) {
        return util.format('Maksekorralduse tähtaeg %s peab olema määratud', this.keyPrefix + 'DATE');
    }

    if (value.toUpperCase() !== 'EXPRESS') {
        return util.format('Maksekorralduse tähtaaja %s ainus lubatud väärtus on %s', this.keyPrefix + 'DATE', 'EXPRESS');
    }

    return true;
};

/* MSG */
SoloValidator.prototype.validate_MSG = function() {
    let value = (this.fields[this.keyPrefix + 'MSG'] || '').toString();

    if (!value) {
        return util.format('Maksekorralduse selgitus %s peab olema määratud', this.keyPrefix + 'MSG');
    }

    if (value.length > 210) {
        return util.format(
            'Maksekorralduse selgituse %s maksimaalne lubatud pikkus on %s sümbolit (hetkel on kasutatud %s)',
            this.keyPrefix + 'MSG',
            210,
            value.length
        );
    }

    return true;
};

/* RETURN */
SoloValidator.prototype.validate_RETURN = function() {
    let value = (this.fields[this.keyPrefix + 'RETURN'] || '').toString();

    if (!value) {
        return util.format('Tagasisuunamise aadress %s peab olema määratud', this.keyPrefix + 'RETURN');
    }

    if (!tools.validateUrl(value)) {
        return util.format('Tagasisuunamise aadress %s peab olema korrektne URL', this.keyPrefix + 'RETURN');
    }

    return true;
};

/* CANCEL */
SoloValidator.prototype.validate_CANCEL = function() {
    let value = (this.fields[this.keyPrefix + 'CANCEL'] || '').toString();

    if (!value) {
        return util.format('Tagasisuunamise aadress %s peab olema määratud', this.keyPrefix + 'CANCEL');
    }

    if (!tools.validateUrl(value)) {
        return util.format('Tagasisuunamise aadress %s peab olema korrektne URL', this.keyPrefix + 'CANCEL');
    }

    return true;
};

/* REJECT */
SoloValidator.prototype.validate_REJECT = function() {
    let value = (this.fields[this.keyPrefix + 'REJECT'] || '').toString();

    if (!value) {
        return util.format('Tagasisuunamise aadress %s peab olema määratud', this.keyPrefix + 'REJECT');
    }

    if (!tools.validateUrl(value)) {
        return util.format('Tagasisuunamise aadress %s peab olema korrektne URL', this.keyPrefix + 'REJECT');
    }

    return true;
};

/* CONFIRM */
SoloValidator.prototype.validate_CONFIRM = function() {
    let value = (this.fields[this.keyPrefix + 'CONFIRM'] || '').toString();

    if (!value) {
        return util.format('Maksekorralduse kinnitus %s peab olema määratud', this.keyPrefix + 'CONFIRM');
    }

    if (value.toUpperCase() !== 'YES') {
        return util.format(
            'Maksekorralduse kinnituse %s ainus lubatud väärtus on %s, vastasel korral ei saa makse õnnestumisest teada',
            this.keyPrefix + 'CONFIRM',
            'YES'
        );
    }

    return true;
};

/* KEYVERS */
SoloValidator.prototype.validate_KEYVERS = function() {
    let value = (this.fields[this.keyPrefix + 'KEYVERS'] || '').toString();

    if (!value) {
        return util.format('Võtme versioon %s peab olema määratud', this.keyPrefix + 'KEYVERS');
    }

    if (!value.match(/^\d{4}$/)) {
        return util.format('Võtme versioon %s peab olema neljakohaline number, näiteks "0001"', this.keyPrefix + 'KEYVERS');
    }

    return true;
};

/* CUR */
SoloValidator.prototype.validate_CUR = function() {
    let value = (this.fields[this.keyPrefix + 'CUR'] || '').toString();

    if (!value) {
        return util.format('Valuuta %s peab olema määratud', this.keyPrefix + 'CUR');
    }

    if (Solo.allowedCurrencies.indexOf(value) < 0) {
        return util.format('Valuuta %s on tundmatu väärtusega %s, kuid lubatud on %s', this.keyPrefix + 'CUR', value, Solo.allowedCurrencies.join(', '));
    }

    return true;
};

Solo.genPaidCode = function(nr) {
    let date = new Date(),
        year = date.getFullYear(),
        month = date.getMonth() + 1,
        day = date.getDate(),
        stamp = String(year) + (month < 10 ? '0' : '') + month + (day < 10 ? '0' : '') + day;

    return 'PEPM' + stamp + ((nr && String(nr).lpad(12)) || Math.floor(1 + Math.random() * 1000000000000));
};

Solo.generateForm = function(payment, project, callback) {
    tools.incrTransactionCounter(project.uid, (err, transactionId) => {
        if (err) {
            return callback(err);
        }

        let paymentFields = {};
        payment.fields.forEach(field => {
            paymentFields[field.key] = field.value;
        });

        let transaction = new Solo(project.bank, paymentFields, payment.charset);
        transaction.service = 'PAYMENT-OUT';
        transaction.record = project;

        paymentFields[transaction.keyPrefix + 'RETURN_VERSION'] = paymentFields[transaction.keyPrefix + 'VERSION'];
        paymentFields[transaction.keyPrefix + 'RETURN_STAMP'] = paymentFields[transaction.keyPrefix + 'STAMP'];
        paymentFields[transaction.keyPrefix + 'RETURN_REF'] = paymentFields[transaction.keyPrefix + 'REF'];
        paymentFields[transaction.keyPrefix + 'RETURN_PAYER_NAME'] = payment.payment.senderName || '';
        paymentFields[transaction.keyPrefix + 'RETURN_PAYER_ACCOUNT'] = payment.payment.senderAccount || '';
        paymentFields[transaction.keyPrefix + 'RETURN_TAX_CODE'] = paymentFields[transaction.keyPrefix + 'TAX_CODE'];
        paymentFields[transaction.keyPrefix + 'RETURN_MSG'] = paymentFields[transaction.keyPrefix + 'MSG'];
        paymentFields[transaction.keyPrefix + 'RETURN_PAID'] = payment.state === 'PAYED' ? Solo.genPaidCode(transactionId) : '';

        transaction.sign(err => {
            if (err) {
                return callback(err);
            }

            let method = 'GET',
                fields = transaction.getFields(),
                payload = tools.stringifyQuery(fields, payment.charset),
                url = payment.state === 'PAYED' ? payment.successTarget : payment.state === 'REJECTED' ? payment.rejectTarget : payment.cancelTarget,
                hostname = (urllib.parse(url).hostname || '').toLowerCase().trim(),
                localhost = !!hostname.match(/^localhost|127\.0\.0\.1$/);

            url += (url.match(/\?/) ? '&' : '?') + payload;

            if (payment.state === 'PAYED' && !!project.soloAutoResponse && !localhost) {
                fetchUrl(
                    url,
                    {
                        method,
                        agent: false,
                        maxResponseLength: 100 * 1024 * 1024,
                        timeout: 10000,
                        disableRedirects: true,
                        userAgent: config.hostname + ' (automaatsed testmaksed)',
                        rejectUnauthorized: false
                    },
                    (err, meta, body) => {
                        if (err) {
                            payment.autoResponse = {
                                status: false,
                                error: err.message,
                                method,
                                url,
                                fields: false
                            };
                        } else {
                            payment.autoResponse = {
                                statusCode: meta.status,
                                headers: meta.responseHeaders,
                                body: body && body.toString()
                            };
                        }
                        payment.responseFields = fields;
                        payment.responseHash = transaction.sourceHash;
                        payment.returnMethod = method;
                        callback(null, {
                            method,
                            url,
                            payload
                        });
                    }
                );
            } else {
                if (localhost && !!project.soloAutoResponse) {
                    payment.autoResponse = {
                        status: false,
                        error: 'localhost automaatpäringud ei ole lubatud',
                        method,
                        url,
                        fields: false
                    };
                }

                payment.responseFields = fields;
                payment.responseHash = transaction.sourceHash;
                payment.returnMethod = method;
                return callback(null, {
                    method,
                    url,
                    payload
                });
            }
        });
    });
};
