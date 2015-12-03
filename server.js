'use strict';

let config = require('config');
let pathlib = require('path');
let express = require('express');
let app = express();
let flash = require('connect-flash');
let session = require('express-session');
let MongoStore = require('connect-mongo')(session);
let routes = require('./lib/routes');
let cookieParser = require('cookie-parser');
let morgan = require('morgan');
let compression = require('compression');
let passport = require('passport');
let fs = require('fs');
let https = require('https');
let http = require('http');
let tools = require('./lib/tools');
let db = require('./lib/db');
let st = require('st');
let log = require('npmlog');

let mount = st({
    path: pathlib.join(__dirname, 'www', 'static'),
    url: '/',
    dot: false,
    index: false,
    passthrough: true,

    cache: { // specify cache:false to turn off caching entirely
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
app.use(compression({
    filter: (req, res) => {
        if (res && req.path === '/updates_feed') {
            return false;
        } else {
            return compression.filter(req, res);
        }
    }
}));

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
app.use(session({
    store: new MongoStore({
        url: config.mongodb.url,
        ttl: config.session.ttl
    }),
    secret: config.session.secret,
    saveUninitialized: true,
    resave: false
}));

// setup user handling
app.use(passport.initialize());
app.use(passport.session());

// setup flash messages
app.use(flash());

// Log requests to console
app.use(morgan(config.log.interface, {
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
}));

// Use EJS template engine
app.set('view engine', 'ejs');

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
        log.info('DB', 'Database opened');
        server.listen(app.get('port'), () => {
            log.info('SERVER', 'Web server running on port ' + app.get('port'));
        });
    }
});
