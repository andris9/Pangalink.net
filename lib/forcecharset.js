'use strict';

const encodinglib = require('encoding');
const onHeaders = require('on-headers');

module.exports = function(req, res, next) {
    // proxy

    let write = res.write;
    let end = res.end;
    let buffer;
    let bufferLen;

    res.write = (chunk, encoding) => {
        if (!chunk || !chunk.length) {
            return true;
        }

        if (!buffer && !/^utf[-_]?8$/i.test(res.forceCharset)) {
            buffer = [];
            bufferLen = 0;
        }

        if (!buffer) {
            write.call(res, chunk, encoding);
        } else {
            if (typeof chunk === 'string') {
                chunk = Buffer.from(chunk, encoding || 'utf-8');
            }
            buffer.push(chunk);
            bufferLen += chunk.length;
        }

        return true;
    };

    res.end = (chunk, encoding) => {
        if (chunk) {
            res.write(chunk, encoding);
        }

        if (buffer) {
            let buf = bufferLen ? Buffer.concat(buffer, bufferLen) : Buffer.from(0);
            let out = encodinglib.convert(buf, res.forceCharset);

            res.setHeader('Content-Length', out.length);

            if (res.forceCharset) {
                let type = res
                    .getHeader('content-type')
                    .split(';')
                    .shift();
                res.setHeader('content-type', type + '; charset=' + res.forceCharset);
            }

            write.call(res, out, 'buffer');
        }
        return end.call(res);
    };

    onHeaders(res, () => {
        // head
        if (req.method === 'HEAD') {
            return;
        }

        if (!/^utf[-_]?8$/i.test(res.forceCharset)) {
            buffer = [];
            bufferLen = 0;
        }
    });

    next();
};
