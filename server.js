'use strict';

const config = require('config');
const pathlib = require('path');
const express = require('express');
const app = express();
const flash = require('connect-flash');
const session = require('express-session');
const MongoStore = require('connect-mongo')(session);
const routes = require('./lib/routes');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const compression = require('compression');
const passport = require('passport');
const fs = require('fs');
const https = require('https');
const http = require('http');
const tools = require('./lib/tools');
const db = require('./lib/db');
const st = require('st');
const log = require('npmlog');
const packageInfo = require('./package.json');
const moment = require('moment');
const setupIndexes = require('./indexes');
const urllib = require('url');

moment.locale('et');

const csrf = require('csurf')({
    cookie: true
});

const mount = st({
    path: pathlib.join(__dirname, 'www', 'static'),
    url: '/',
    dot: false,
    index: false,
    passthrough: true,

    cache: {
        // specify cache:false to turn off caching entirely
        content: {
            max: 1024 * 1024 * 64
        }
    },

    // gzip is handled by express
    gzip: false
});

let server;

// Setup SSL
if (config.web.ssl) {
    config.web.ssl.key = fs.readFileSync(config.web.ssl.key, 'utf-8');
    config.web.ssl.cert = fs.readFileSync(config.web.ssl.cert, 'utf-8');

    if (config.web.ssl.ca) {
        config.web.ssl.ca = [].concat(config.web.ssl.ca).map(ca => fs.readFileSync(ca, 'utf-8'));
    }
}

// HTTP port to listen
app.set('port', config.web.port);

// do not expose express version
app.disable('x-powered-by');

// Define path to EJS templates
app.set('views', pathlib.join(__dirname, 'www', 'views'));

// Redirect to specified hostname if required
app.use((req, res, next) => {
    if (!config.web.forceDomain) {
        return next();
    }

    if (req.header('host') === config.web.forceDomain) {
        next();
    } else {
        res.redirect(301, (config.web.forceProtocol || (config.web.ssl ? 'https:' : 'http:')) + '//' + config.web.forceDomain + req.path);
    }
});

// Use gzip compression
app.use(
    compression({
        filter: (req, res) => {
            if (res && req.path === '/updates_feed') {
                return false;
            } else {
                return compression.filter(req, res);
            }
        }
    })
);

// if res.forceCharset is set, convert ecoding for output
// this is needed to serve non-utf8 transactions
app.use(require('./lib/forcecharset'));

// Define static content path
app.use((req, res, next) => {
    mount(req, res, () => {
        next();
    });
});

// Parse cookies
app.use(cookieParser(config.session.secret));

// Parse POST requests. We need to use homecooked parser as the input might
// include non-utf8 input that needs to be converted to utf8
app.use(require('./lib/bodyparser'));

// detect transaction information, bank type, language etc.
app.use(tools.checkEncoding);

// setup session handling, store everything to MongoDB
app.use(
    session({
        store: new MongoStore({
            url: config.mongodb.url,
            ttl: config.session.ttl
        }),
        secret: config.session.secret,
        saveUninitialized: true,
        resave: false
    })
);

// setup user handling
app.use(passport.initialize());
app.use(passport.session());

// setup flash messages
app.use(flash());

// Log requests to console
app.use(
    morgan(config.log.interface, {
        stream: {
            write: message => {
                message = (message || '').toString();
                if (message) {
                    log.info('HTTP', message.replace('\n', '').trim());
                }
            }
        },
        skip: (req, res) => {
            // ignore ping requests
            if (res && req.query && req.query.monitor === 'true') {
                return true;
            }
            return false;
        }
    })
);

// Use EJS template engine
app.set('view engine', 'ejs');

app.use((...args) => {
    if (/^\/(api|banklink)\//.test(args[0].url)) {
        // skip CSRF check for api calls
        return args[2]();
    }
    if (args[0].method === 'POST' && /^\/project\/[a-f0-9]{24}\b/.test(args[0].url)) {
        return args[2]();
    }
    return csrf(...args);
});

app.use((req, res, next) => {
    db.database.collection('user').findOne({ role: 'admin' }, { fields: { _id: true, username: true, role: true } }, (err, admin) => {
        if (err) {
            return next(err);
        }
        res.locals.adminUser = admin;
        return next();
    });
});

app.use((req, res, next) => {
    res.locals.csrfToken = req.csrfToken && req.csrfToken();

    db.database.collection('settings').findOne({ env: process.env.NODE_ENV || 'development' }, (err, settings) => {
        if (err) {
            return next(err);
        }

        settings = settings || {};

        let urlParts = urllib.parse(settings.url || '/');

        res.locals.logoUrl = req.logoUrl = 'logo' in settings ? settings.logo : config.logoUrl;

        res.locals.proto = req.siteProto =
            (urlParts.protocol ? urlParts.protocol.substr(0, urlParts.protocol.length - 1) : '') || config.proto || req.protocol || 'http';
        res.locals.hostname = req.siteHostname = (urlParts.host || config.hostname || (req.headers && req.headers.host) || 'localhost').replace(
            /:(80|443)$/,
            ''
        );
        res.locals.title = req.siteTitle = settings.title || config.title || packageInfo.name;

        res.locals.packageTitle = packageInfo.name;

        res.locals.messages = {
            success: req.flash('success'),
            error: req.flash('error'),
            info: req.flash('info')
        };
        res.locals.user = req.user;
        res.locals.googleAnalyticsID = config.googleAnalyticsID;

        req.emailName = 'emailName' in settings ? settings.emailName : settings.title || req.siteTitle;
        req.emailAddress = settings.emailAddress || 'pangalink@' + req.siteHostname;

        res.locals.version = packageInfo.version;
        next();
    });
});

// Use routes from routes.js
routes(app);

// create server instance
if (config.web.ssl) {
    server = https.createServer(config.web.ssl, app);
} else {
    server = http.createServer(app);
}

server.on('error', err => {
    log.err('SERVER', err);
    process.exit(1);
});

// open database
db.init(err => {
    if (err) {
        log.err('DB', err);
        process.exit(1);
    } else {
        let indexpos = 0;
        let ensureIndexes = err => {
            if (err) {
                log.silly('mongo', 'Failed creating index', err.message);
            }
            if (indexpos >= setupIndexes.length) {
                log.info('mongo', 'Setup indexes for %s collections', setupIndexes.length);

                server.listen(app.get('port'), () => {
                    log.info('SERVER', 'Web server running on port ' + app.get('port'));
                    // downgrade user and group if needed
                    if (config.group) {
                        try {
                            process.setgid(config.group);
                            log.info('App', 'Changed group to "%s" (%s)', config.group, process.getgid());
                        } catch (E) {
                            log.error('App', 'Failed to change group to "%s" (%s)', config.group, E.message);
                            return process.exit(1);
                        }
                    }
                    if (config.user) {
                        try {
                            process.setuid(config.user);
                            log.info('App', 'Changed user to "%s" (%s)', config.user, process.getuid());
                        } catch (E) {
                            log.error('App', 'Failed to change user to "%s" (%s)', config.user, E.message);
                            return process.exit(1);
                        }
                    }
                });
                return;
            }
            let index = setupIndexes[indexpos++];
            log.silly('mongo', 'Creating index %s %s', indexpos, JSON.stringify(index.indexes));
            db.database.collection(index.collection).createIndexes(index.indexes, ensureIndexes);
        };
        log.info('DB', 'Database opened');
        ensureIndexes();
    }
});
