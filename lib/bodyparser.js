'use strict';

// custom POST body parser to handle data in non-utf8 encoding

const urllib = require('url');
const he = require('he');

module.exports = bodyParser;

function bodyParser(req, res, next) {
    let data = [];
    let length = 0;
    let maxLength = 4 * 1024 * 1024;

    if (req.method === 'GET' && req.originalUrl.indexOf('?') >= 0) {
        req.body = {};
        req.encodedBody = {};
        req.rawBody = new Buffer(urllib.parse(req.originalUrl, false, false).query || '', 'utf-8');
        return parseUrlencodedBody(req, res, next);
    }

    req.on('error', next);

    req.on('data', chunk => {
        if (length + chunk.length <= maxLength) {
            data.push(chunk);
            length += chunk.length;
        } else if (length < maxLength) {
            chunk = chunk.slice(0, length - maxLength);
            data.push(chunk);
            length += chunk.length;
        }
    });

    req.on('end', () => {
        let contentType = parseHeaderLine('content-type', req.headers['content-type']);

        req.body = {};
        req.encodedBody = {};

        if (length) {
            req.rawBody = Buffer.concat(data, length);

            switch (contentType.value) {
                case 'application/x-www-form-urlencoded':
                    parseUrlencodedBody(req, res, next);
                    break;
                case 'multipart/form-data':
                    parseMultipartBody(req, res, contentType.boundary, next);
                    break;
                case 'application/json':
                    try {
                        req.body = JSON.parse(new Buffer(req.rawBody, 'utf-8'));
                    } catch (E) {
                        // ignore
                    }
                    next();
                    break;
                default:
                    next();
            }
        } else {
            next();
        }
    });
}

function parseUrlencodedBody(req, res, next) {
    let str = (req.rawBody || '').toString('binary');

    str.split('&').forEach(part => {
        let parts = part.split('='),
            key = decodeURIComponent(parts.shift()),
            value = (parts.join('=') || '').replace(/\+/g, ' '),
            encodedChars = (value.match(/%[0-9a-fA-F]{2}/g) || []).length,
            buf,
            len = value.length - encodedChars * 2,
            pos = 0;

        if (encodedChars > 0) {
            buf = new Buffer(len);
            for (let i = 0, l = value.length; i < l; i++) {
                if (value[i] === '%' && value.substr(i, 3).match(/^%[0-9a-fA-F]{2}$/)) {
                    buf[pos] = parseInt(value.substr(i + 1, 2), 16);
                    i += 2;
                } else {
                    buf[pos] = value.charAt(i) !== '+' ? value.charCodeAt(i) : 0x20;
                }

                pos++;
            }
            value = buf;
        } else {
            value = new Buffer(value, 'binary');
        }

        if (key && value && value.length) {
            let lkey = key;
            if (/\[\]$/.test(lkey)) {
                lkey = lkey.substr(0, lkey.length - 2);
                req.body[lkey] = [].concat(req.body[lkey] || []).concat(value.toString('utf-8'));
            } else {
                req.body[lkey] = value.toString('utf-8');
            }
            req.encodedBody[key] = value;
        }
    });

    next();
}

function parseMultipartBody(req, res, boundary, next) {
    let str = (req.rawBody || '').toString('binary');
    let boundaryRe = (boundary || '').replace(/[\\^$*+?.():=!|{},[\]]/g, '\\$1');
    let re = new RegExp('\\-\\-' + boundaryRe + '\\r?\\n((.|\\r|\\n)+?)(?=\\r?\\n\\-\\-' + boundaryRe + '|$)', 'g');

    str.replace(re, (original, contents) => {
        let header = '',
            match;

        if ((match = contents.match(/\r?\n\r?\n/))) {
            header = contents.substr(0, match.index);
            contents = contents.substr(match.index + match[0].length);
        }

        let headers = parseHeaders(header),
            key,
            value;

        if (headers['content-disposition'] && headers['content-disposition'].value === 'form-data') {
            key = headers['content-disposition'].name;
        }
        value = new Buffer(he.decode(contents || ''), 'binary');

        if (key && value && value.length) {
            req.body[key] = value.toString('utf-8');
            req.encodedBody[key] = value;
        }
    });

    next();
}

function parseHeaderLine(key, value) {
    key = (key || '').trim().toLowerCase();
    value = (value || '').trim();

    let returnObject = {};

    value.split(';').forEach((part, i) => {
        part = (part || '').trim();
        if (!i) {
            returnObject.value = part;
            return;
        }
        let parts = part.split('='),
            lkey = (parts.shift() || '').toLowerCase().trim(),
            lval = parts.join('=').trim().replace(/^[''\s<]+|[''\s<]+$/g, '');

        if (lkey && lval) {
            returnObject[lkey] = lval;
        }
    });

    return returnObject;
}

function parseHeaders(headers) {
    let headerObj = {};
    headers.split('\n').forEach(line => {
        line = line || '';
        if (!line) {
            return;
        }
        let parts = line.split(':'),
            key = (parts.shift() || '').trim().toLowerCase(),
            value = (parts.join(':') || '').trim();
        if (value) {
            headerObj[key] = parseHeaderLine(key, value);
        }
    });

    return headerObj;
}
