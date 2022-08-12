'use strict';

const config = require('config');
const express = require('express');
const router = new express.Router();
const banklink = require('../lib/banklink');
const tools = require('../lib/tools');

router.get('/preview/:payment', banklink.servePaymentPreview);

router.post('/final', servePaymentFinal);
router.post('/final/:payment', servePaymentFinal);

router.get('/:version/:bank', banklink.serveBanklink);
router.post('/:version/:bank', banklink.serveBanklink);

router.get('/:bank', banklink.serveBanklink);
router.post('/:bank', banklink.serveBanklink);

function servePaymentFinal(req, res) {
    let id = (req.params.payment || req.body.payment || req.query.payment || '').toString();

    if (!id.match(/^[a-fA-F0-9]{24}$/)) {
        req.flash('error', 'Vigane maksekorralduse identifikaator');
        res.redirect('/');
        return;
    }

    banklink.makePayment(id, req.body, req.user, (err, data) => {
        if (err) {
            req.flash('error', err.message || err);
            res.redirect(err.redirectUrl || '/');
            return;
        }

        res.forceCharset = data.forceCharset;
        res.set('content-type', 'text/html; charset=' + res.forceCharset);

        data.title =
            config.title ||
            (config.hostname || (req && req.headers && req.headers.host) || 'localhost')
                .replace(/:\d+$/, '')
                .toLowerCase()
                .replace(/^./, s => s.toUpperCase());
        data.proto = config.proto || 'http';
        data.hostname = config.hostname || (req && req.headers && req.headers.host) || 'localhost';
        data.googleAnalyticsID = config.googleAnalyticsID;

        data.isAuthorized = tools.checkAuthorized(req, data.project);

        res.render('banklink/final', data);
    });
}

module.exports = router;
