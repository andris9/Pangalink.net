'use strict';

const util = require('util');
const banks = require('../banks');
const tools = require('../tools');
const db = require('../db');
const crypto = require('crypto');

module.exports = Aab;

function Aab(bank, fields, charset) {
    this.bank = (typeof bank === 'string' ? banks[bank] || banks.ipizza || {} : bank) || {};
    this.fields = fields || {};

    this.normalizeValues();

    this.version = Aab.detectVersion(this.bank, this.fields);

    this.language = Aab.detectLanguage(this.bank, this.fields);
    this.charset = charset || Aab.detectCharset(this.bank, this.fields);

    this.uid = this.fields.AAB_RCV_ID;

    this.service = 'PAYMENT-IN';
}

Aab.samplePayment = function(project, urlPrefix, options, callback) {
    let bank = banks[project.bank] || banks.ipizza,
        charsetValue;

    charsetValue = 'iso-8859-1';

    let testFields = {
        AAB_VERSION: '0002',
        AAB_STAMP: '12345',
        AAB_RCV_ID: project.uid,
        AAB_RCV_ACCOUNT: options.acc || '3936363002092492',
        AAB_RCV_NAME: options.name || 'ÕIE MÄGER',
        AAB_AMOUNT: options.amount || '150',
        AAB_REF: options.ref || '1234561',
        AAB_DATE: 'EXPRESS',
        AAB_MSG: options.msg || 'testmakseÄ',
        AAB_CUR: 'EUR',
        AAB_CONFIRM: 'YES',
        AAB_LANGUAGE: '3',
        AAB_KEYVERS: '0001',
        AAB_RETURN: '%RETURN%'
    };

    if (bank.cancelAddress && bank.cancelAddress !== 'AAB_RETURN') {
        testFields[bank.cancelAddress] = '%CANCEL%';
    }

    if (bank.rejectAddress && bank.rejectAddress !== 'AAB_RETURN') {
        testFields[bank.rejectAddress] = '%REJECT%';
    }

    let payment = new Aab(project.bank, testFields, charsetValue);
    payment.record = project;

    payment.editable = {
        name: {
            field: 'AAB_RCV_NAME',
            name: 'Saaja nimi',
            value: testFields.AAB_RCV_NAME
        },
        acc: {
            field: 'AAB_RCV_ACCOUNT',
            name: 'Saaja konto',
            value: testFields.AAB_RCV_ACCOUNT
        },
        amount: {
            field: 'AAB_AMOUNT',
            name: 'Summa',
            value: testFields.AAB_AMOUNT
        },
        msg: {
            field: 'AAB_MSG',
            name: 'Kirjeldus',
            value: testFields.AAB_MSG
        },
        ref: {
            field: 'AAB_REF',
            name: 'Viitenumber',
            value: testFields.AAB_REF
        }
    };

    payment.signClient(err => {
        if (err) {
            return callback(err);
        }
        callback(null, payment, charsetValue);
    });
};

Aab.detectVersion = function(bank, fields) {
    return fields.AAB_VERSION || '0002';
};

Aab.detectLanguage = function(bank, fields) {
    bank = (typeof bank === 'string' ? banks[bank] || banks.ipizza || {} : bank) || {};

    let language = (fields.AAB_LANGUAGE || '1').trim();
    if (!Aab.languages[language]) {
        return Aab.defaultLanguage;
    } else {
        return Aab.languages[language];
    }
};

Aab.detectCharset = function(bank) {
    bank = (typeof bank === 'string' ? banks[bank] || {} : bank) || {};
    return bank.defaultCharset;
};

Aab.versions = ['0002'];

Aab.allowedCurrencies = ['EUR'];

Aab.languages = {
    1: 'FIN',
    2: 'SWE'
};

Aab.defaultLanguage = 'FIN';

Aab.serviceFields = {
    // Maksekorraldus
    'PAYMENT-IN': [
        'AAB_VERSION',
        'AAB_STAMP',
        'AAB_RCV_ID',
        'AAB_RCV_ACCOUNT',
        'AAB_RCV_NAME',
        'AAB_LANGUAGE',
        'AAB_AMOUNT',
        'AAB_REF',
        'AAB_TAX_CODE',
        'AAB_DATE',
        'AAB_MSG',
        'AAB_RETURN',
        'AAB_CANCEL',
        'AAB_REJECT',
        'AAB_MAC',
        'AAB_CONFIRM',
        'AAB_KEYVERS',
        'AAB_CUR'
    ]
};

Aab.signatureOrder = {
    '0002': {
        'PAYMENT-IN': ['AAB_VERSION', 'AAB_STAMP', 'AAB_RCV_ID', 'AAB_AMOUNT', 'AAB_REF', 'AAB_DATE', 'AAB_CUR'],
        'PAYMENT-OUT': ['AAB-RETURN-VERSION', 'AAB-RETURN-STAMP', 'AAB-RETURN-REF', 'AAB-RETURN-PAID']
    }
};

// ++ kohustuslikud meetodid

Aab.prototype.validateClient = function(callback) {
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
                            field: 'AAB_RCV_ID',
                            value: (this.fields.AAB_RCV_ID || '').toString(),
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
                            field: 'AAB_RCV_ID',
                            value: (this.fields.AAB_RCV_ID || '').toString(),
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

Aab.prototype.validateSignature = function(callback) {
    this.calculateHash();

    let mac;

    try {
        mac = crypto.createHash(this.record.soloAlgo).update(this.sourceHash).digest('hex').toUpperCase();
    } catch (E) {
        return callback(E);
    }

    if (mac === this.fields.AAB_MAC) {
        return callback(null, {
            success: true,
            errors: false,
            warnings: false
        });
    }

    callback(null, {
        success: false,
        errors: {
            field: this.fields.AAB_MAC,
            error: util.format('Allkirja parameetri %s valideerimine ebaõnnestus.', 'AAB_MAC'),
            download: true
        },
        warnings: false
    });
};

Aab.prototype.sign = function(callback) {
    this.calculateHash();

    try {
        this.fields['AAB-RETURN-MAC'] = crypto.createHash(this.record.soloAlgo).update(this.sourceHash).digest('hex').toUpperCase();
    } catch (E) {
        return callback(E);
    }

    callback(null, true);
};

Aab.prototype.signClient = function(callback) {
    this.calculateHash();

    try {
        this.fields.AAB_MAC = crypto.createHash(this.record.soloAlgo).update(this.sourceHash).digest('hex').toUpperCase();
    } catch (E) {
        return callback(E);
    }

    callback(null, true);
};

Aab.prototype.validateRequest = function(callback) {
    this.errors = [];

    if (this.errors.length > 3) {
        return callback(null, {
            success: !this.errors.length,
            errors: (this.errors.length && this.errors) || false,
            warnings: false
        });
    }

    let validator = new AabValidator(this.bank, this.fields, this.service, this.version, this.record.soloAlgo);
    validator.validateFields();
    this.errors = this.errors.concat(validator.errors);
    this.warnings = validator.warnings;

    callback(null, {
        success: !this.errors.length,
        errors: (this.errors.length && this.errors) || false,
        warnings: (this.warnings.length && this.warnings) || false
    });
};

Aab.prototype.getUid = function() {
    return this.fields.AAB_RCV_ID;
};

Aab.prototype.getCharset = function() {
    return this.charset;
};

Aab.prototype.getLanguage = function() {
    return tools.languages[this.language] || 'et';
};

Aab.prototype.getSourceHash = function() {
    return this.sourceHash || false;
};

Aab.prototype.getType = function() {
    return 'PAYMENT';
};

Aab.prototype.getAmount = function() {
    return this.fields.AAB_AMOUNT || '0';
};

Aab.prototype.getReferenceCode = function() {
    return this.fields.AAB_REF || false;
};

Aab.prototype.getMessage = function() {
    return this.fields.AAB_MSG || false;
};

Aab.prototype.getCurrency = function() {
    return this.fields.AAB_CUR || 'EUR';
};

Aab.prototype.getReceiverName = function() {
    return this.fields.AAB_RCV_NAME || false;
};

Aab.prototype.getReceiverAccount = function() {
    return this.fields.AAB_RCV_ACCOUNT || false;
};

Aab.prototype.editSenderName = function() {
    return true;
};

Aab.prototype.showSenderName = function() {
    return false;
};

Aab.prototype.editSenderAccount = function() {
    return true;
};

Aab.prototype.showSenderAccount = function() {
    return false;
};

Aab.prototype.showReceiverName = function() {
    return !!this.getReceiverName();
};

Aab.prototype.showReceiverAccount = function() {
    return !!this.getReceiverAccount();
};

Aab.prototype.getSuccessTarget = function() {
    return this.fields[this.bank.returnAddress] || '';
};

Aab.prototype.getCancelTarget = function() {
    return this.fields[this.bank.cancelAddress] || this.fields[this.bank.returnAddress] || '';
};

Aab.prototype.getRejectTarget = function() {
    return this.fields[this.bank.rejectAddress] || this.fields[this.bank.returnAddress] || '';
};

// -- kohustuslikud meetodid

Aab.prototype.calculateHash = function() {
    let list = [];

    if (!Aab.signatureOrder[this.version]) {
        return;
    }

    if (!Aab.signatureOrder[this.version][this.service]) {
        return;
    }

    Aab.signatureOrder[this.version][this.service].forEach(vk => {
        let val = this.fields[vk] || '';
        list.push(val);
    });

    list.push(this.record.secret);
    list.push('');

    this.sourceHash = list.join('&');
};

Aab.prototype.normalizeValues = function() {
    let keys = Object.keys(this.fields);

    for (let i = 0, len = keys.length; i < len; i++) {
        if (this.fields[keys[i]] || this.fields[keys[i]] === 0) {
            this.fields[keys[i]] = this.fields[keys[i]].toString().trim();
        } else {
            this.fields[keys[i]] = '';
        }
    }
};

Aab.prototype.getFields = function() {
    let fields = {};
    Aab.signatureOrder[this.version][this.service].forEach(key => {
        if (this.fields[key]) {
            fields[key] = this.fields[key];
        }
    });

    if (this.fields['AAB-RETURN-MAC']) {
        fields['AAB-RETURN-MAC'] = this.fields['AAB-RETURN-MAC'];
    }

    return fields;
};

function AabValidator(bank, fields, service, version, soloAlgo) {
    this.bank = (typeof bank === 'string' ? banks[bank] || banks.ipizza || {} : bank) || {};
    this.fields = fields || {};
    this.service = service || 'PAYMENT-IN';
    this.version = version || '0002';
    this.soloAlgo = (soloAlgo || 'md5').toUpperCase();

    this.errors = [];
    this.warnings = [];
}

AabValidator.prototype.validateFields = function() {
    this.errors = [];
    this.warnings = [];

    Aab.serviceFields[this.service].forEach(field => {
        if (!this['validate_' + field]) {
            return;
        }

        let response = this['validate_' + field](),
            value = (this.fields[field] || '').toString();

        if (typeof response === 'string') {
            this.errors.push({
                field,
                value: (this.fields[field] || '').toString(),
                error: response
            });
        } else if (this.bank.fieldLength && this.bank.fieldLength[field] && value.length > this.bank.fieldLength[field]) {
            this.warnings.push({
                field,
                value,
                warning: util.format('Välja %s pikkus on %s sümbolit, lubatud on %s', field, value.length, this.bank.fieldLength[field])
            });
        }
    });
};

/* VERSION */
AabValidator.prototype.validate_AAB_VERSION = function() {
    let value = (this.fields.AAB_VERSION || '').toString();

    if (!value) {
        return util.format('Teenuse versiooni %s väärtust ei leitud', 'AAB_VERSION');
    }

    if (!value.match(/^\d{4}$/)) {
        return util.format('Teenuse versiooni %s ("%s") väärtus peab olema neljakohaline number', 'AAB_VERSION', value);
    }

    if (Aab.versions.indexOf(value) < 0) {
        return util.format(
            'Teenuskoodi %s ("%s") väärtus ei ole toetatud. Kasutada saab järgmisi väärtuseid: %s',
            'AAB_VERSION',
            value,
            Aab.versions.join(', ')
        );
    }

    return true;
};

/* MAC */
AabValidator.prototype.validate_AAB_MAC = function() {
    let value = (this.fields.AAB_MAC || '').toString();

    if (!value) {
        return util.format('Allkirja parameeter %s peab olema määratud', 'AAB_MAC');
    }

    if (!value.match(/^[A-F0-9]+$/)) {
        return util.format('Allkirja parameeter %s peab olema HEX formaadis ning sisaldama ainult suurtähti ning numbreid', 'AAB_MAC');
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
AabValidator.prototype.validate_AAB_STAMP = function() {
    let value = (this.fields.AAB_STAMP || '').toString();

    if (!value) {
        return util.format('Maksekorralduse kood %s peab olema määratud', 'AAB_STAMP');
    }

    if (!value.match(/^\d+$/)) {
        return util.format('Maksekorralduse kood %s peab olema numbriline väärtus', 'AAB_STAMP');
    }

    return true;
};

/* RCV_ID */
AabValidator.prototype.validate_AAB_RCV_ID = function() {
    let value = (this.fields.AAB_RCV_ID || '').toString();

    if (!value) {
        return util.format('Päringu koostaja tunnus %s peab olema määratud', 'AAB_RCV_ID');
    }

    return true;
};

/* RCV_ACCOUNT */
/* RCV_NAME */

/* LANGUAGE */
AabValidator.prototype.validate_AAB_LANGUAGE = function() {
    let value = (this.fields.AAB_LANGUAGE || '').toString();

    if (!value) {
        return util.format('Päringu koostaja tunnus %s peab olema määratud', 'AAB_LANGUAGE');
    }

    if (!value.match(/^\d$/)) {
        return util.format('Keelevaliku tunnus %s peab olema ühekohaline number', 'AAB_LANGUAGE');
    }

    return true;
};

/* AMOUNT */
AabValidator.prototype.validate_AAB_AMOUNT = function() {
    let value = (this.fields.AAB_AMOUNT || '').toString();

    if (!value) {
        return util.format('Makse summa %s peab olema määratud', 'AAB_AMOUNT');
    }

    if (!value.match(/^\d{0,}(\.\d{1,2})?$/)) {
        return util.format('Makse summa %s peab olema kujul "123.45"', 'AAB_AMOUNT');
    }

    return true;
};

/* REF */
AabValidator.prototype.validate_AAB_REF = function() {
    let value = (this.fields.AAB_REF || '').toString(),
        refNumber;

    if (!value) {
        return true;
    }

    if (!value.match(/^\d{2,}$/)) {
        return util.format('Viitenumber %s ("%s") peab olema vähemalt kahekohaline number', 'AAB_REF', value);
    }

    refNumber = tools.getReferenceCode(value.substr(0, value.length - 1));

    if (refNumber !== value) {
        return util.format('Viitenumber %s on vigane - oodati väärtust "%s", tegelik väärtus on "%s"', 'AAB_REF', refNumber, value);
    }

    return true;
};

/* TAX_CODE */
AabValidator.prototype.validate_AAB_TAX_CODE = function() {
    let value = (this.fields.AAB_TAX_CODE || '').toString();

    if (!value && this.version === '0004') {
        return util.format('Maksu kood %s peab olema versiooni %s puhul määratud', 'AAB_TAX_CODE', '0004');
    }

    return true;
};

/* DATE */
AabValidator.prototype.validate_AAB_DATE = function() {
    let value = (this.fields.AAB_DATE || '').toString();

    if (!value) {
        return util.format('Maksekorralduse tähtaeg %s peab olema määratud', 'AAB_DATE');
    }

    if (value.toUpperCase() !== 'EXPRESS') {
        return util.format('Maksekorralduse tähtaaja %s ainus lubatud väärtus on %s', 'AAB_DATE', 'EXPRESS');
    }

    return true;
};

/* MSG */
AabValidator.prototype.validate_AAB_MSG = function() {
    let value = (this.fields.AAB_MSG || '').toString();

    if (!value) {
        return util.format('Maksekorralduse selgitus %s peab olema määratud', 'AAB_MSG');
    }

    if (value.length > 210) {
        return util.format('Maksekorralduse selgituse %s maksimaalne lubatud pikkus on %s sümbolit (hetkel on kasutatud %s)', 'AAB_MSG', 210, value.length);
    }

    return true;
};

/* RETURN */
AabValidator.prototype.validate_AAB_RETURN = function() {
    let value = (this.fields.AAB_RETURN || '').toString();

    if (!value) {
        return util.format('Tagasisuunamise aadress %s peab olema määratud', 'AAB_RETURN');
    }

    if (!tools.validateUrl(value)) {
        return util.format('Tagasisuunamise aadress %s peab olema korrektne URL', 'AAB_RETURN');
    }

    return true;
};

/* CANCEL */
AabValidator.prototype.validate_AAB_CANCEL = function() {
    let value = (this.fields.AAB_CANCEL || '').toString();

    if (!value) {
        return util.format('Tagasisuunamise aadress %s peab olema määratud', 'AAB_CANCEL');
    }

    if (!tools.validateUrl(value)) {
        return util.format('Tagasisuunamise aadress %s peab olema korrektne URL', 'AAB_CANCEL');
    }

    return true;
};

/* REJECT */
AabValidator.prototype.validate_AAB_REJECT = function() {
    let value = (this.fields.AAB_REJECT || '').toString();

    if (!value) {
        return util.format('Tagasisuunamise aadress %s peab olema määratud', 'AAB_REJECT');
    }

    if (!tools.validateUrl(value)) {
        return util.format('Tagasisuunamise aadress %s peab olema korrektne URL', 'AAB_REJECT');
    }

    return true;
};

/* CONFIRM */
AabValidator.prototype.validate_AAB_CONFIRM = function() {
    let value = (this.fields.AAB_CONFIRM || '').toString();

    if (!value) {
        return util.format('Maksekorralduse kinnitus %s peab olema määratud', 'AAB_CONFIRM');
    }

    if (value.toUpperCase() !== 'YES') {
        return util.format('Maksekorralduse kinnituse %s ainus lubatud väärtus on %s, vastasel korral ei saa makse õnnestumisest teada', 'AAB_CONFIRM', 'YES');
    }

    return true;
};

/* KEYVERS */
AabValidator.prototype.validate_AAB_KEYVERS = function() {
    let value = (this.fields.AAB_KEYVERS || '').toString();

    if (!value) {
        return util.format('Võtme versioon %s peab olema määratud', 'AAB_KEYVERS');
    }

    if (!value.match(/^\d{4}$/)) {
        return util.format('Võtme versioon %s peab olema neljakohaline number, näiteks "0001"', 'AAB_KEYVERS');
    }

    return true;
};

/* CUR */
AabValidator.prototype.validate_AAB_CUR = function() {
    let value = (this.fields.AAB_CUR || '').toString();

    if (!value) {
        return util.format('Valuuta %s peab olema määratud', 'AAB_CUR');
    }

    if (Aab.allowedCurrencies.indexOf(value) < 0) {
        return util.format('Valuuta %s on tundmatu väärtusega %s, kuid lubatud on %s', 'AAB_CUR', value, Aab.allowedCurrencies.join(', '));
    }

    return true;
};

Aab.genPaidCode = function(nr) {
    let date = new Date(),
        year = date.getFullYear(),
        month = date.getMonth() + 1,
        day = date.getDate(),
        stamp = String(year) + (month < 10 ? '0' : '') + month + (day < 10 ? '0' : '') + day;

    return stamp + ((nr && String(nr).lpad(12)) || Math.floor(1 + Math.random() * 1000000000000));
};

Aab.generateForm = function(payment, project, callback) {
    tools.incrTransactionCounter(project.uid, (err, transactionId) => {
        if (err) {
            return callback(err);
        }

        let paymentFields = {};
        payment.fields.forEach(field => {
            paymentFields[field.key] = field.value;
        });

        let transaction = new Aab(project.bank, paymentFields, payment.charset);
        transaction.service = 'PAYMENT-OUT';
        transaction.record = project;

        paymentFields['AAB-RETURN-VERSION'] = paymentFields.AAB_VERSION;
        paymentFields['AAB-RETURN-STAMP'] = paymentFields.AAB_STAMP;
        paymentFields['AAB-RETURN-REF'] = paymentFields.AAB_REF;
        paymentFields['AAB-RETURN-PAID'] = payment.state === 'PAYED' ? Aab.genPaidCode(transactionId) : '';

        transaction.sign(err => {
            if (err) {
                return callback(err);
            }

            let method = 'GET',
                fields = transaction.getFields(),
                payload = tools.stringifyQuery(fields, payment.charset),
                url = payment.state === 'PAYED' ? payment.successTarget : payment.state === 'REJECTED' ? payment.rejectTarget : payment.cancelTarget;

            url += (url.match(/\?/) ? '&' : '?') + payload;

            payment.responseFields = fields;
            payment.responseHash = transaction.sourceHash;
            payment.returnMethod = method;
            callback(null, {
                method,
                url,
                payload
            });
        });
    });
};
