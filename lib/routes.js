/* eslint global-require: 0 */
'use strict';

const tools = require('./tools');

// Main router function
module.exports = function(app) {
    app.use('/', require('../routes/front'));
    app.use('/account', require('../routes/account'));
    app.use('/banklink', require('../routes/banklink'));
    app.use('/project', require('../routes/project'));
    app.use('/projects', require('../routes/projects'));
    app.use('/payment', require('../routes/payment'));
    app.use('/tools', require('../routes/tools'));
    app.use('/api', require('../routes/api'));

    app.get('/docs/:name', serveDocs);
};

function serveDocs(req, res) {
    tools.renderDocs(req.params.name, (err, content) => {
        if (err) {
            req.flash('error', err.message || err || 'Dokumentatsiooni viga');
            res.redirect('/');
            return;
        }
        res.render('index', {
            pageTitle: 'Info',
            page: '/docs',
            name: req.params.name,
            content
        });
    });
}
