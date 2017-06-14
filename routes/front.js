'use strict';

const express = require('express');
const router = new express.Router();

router.get('/', serveFront);
router.post('/', serveFront);

/**
 * Serves frontpage (/) of the website
 *
 * @param {Object} req HTTP Request object
 * @param {Object} req HTTP Response object
 */
function serveFront(req, res) {
    res.render('index', {
        pageTitle: 'pangalinkide testkeskkond',
        page: '/'
    });
}

module.exports = router;
