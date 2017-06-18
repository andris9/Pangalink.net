'use strict';

module.exports = {
    log: {
        // npm log level
        level: 'silly',

        // See Connect logger middleware help for http logger options
        interface: 'tiny'
    },

    // Domain name to be used all around the page,
    hostname: '',

    // Protocol to be used (if behind proxy might not autodetect correctly),
    proto: '',

    // Name of the service,
    title: 'Pangalinker',

    // www/public/images/
    logoUrl: '/images/logo.png',

    // HTTP/S server configuration,
    web: {
        // Which port to listen (anything below 1000 requires root user. 80 is HTTP and 443 HTTPS,
        port: 3480,

        // If behind proxy, then the protocol the user sees is not what pangalink.net actually uses.,
        // Pangalink.net might be using HTTP internally but user should only use HTTPS addresses,

        // forceProtocol: 'https:',
        forceProtocol: false,

        // Always redirect to this domain, if something else was used. Optional, might be left blank,

        // forceDomain: 'pangalink.net',
        forceDomain: false

        // If you want to enable HTTPS (if you are not behind HTTPS proxy):,
        // ssl: {,
        //     key: abspath_to_private_key,,
        //     cert: abspath_to_server_certificate,,
        //     ca: [optional_root_ca1_path, optional_root_ca2_path, ...],
        // }
    },

    // Express session configuration,
    session: {
        secret: 'some_random_value',
        ttl: 3600
    },

    // SMTP configuration,
    mail: {
        smtp: {
            // by default the app tries to send mail using sendmail binary
            sendmail: true,
            newline: 'unix'
        },
        /*
        // alternatively, configure SMTP relay to use
        smtp: {
            service: 'SendGrid',
            auth: {
                user: 'username',
                pass: 'password'
            },
            debug: false
        },
        */

        defaults: {
            // Sender address
            from: {
                name: 'Pangalink.net',
                address: 'pangalink@localhost'
            }
        }
    },

    // Mongodb configuration,
    mongodb: {
        url: 'mongodb://127.0.0.1:27017/pangalink',

        indexes: [
            {
                collection: 'user',
                data: {
                    username: 1
                }
            },
            {
                collection: 'user',
                data: {
                    role: 1
                }
            },
            {
                collection: 'user',
                data: {
                    token: 1
                }
            },
            {
                collection: 'project',
                data: {
                    owner: 1
                }
            },
            {
                collection: 'project',
                data: {
                    authorized: 1
                }
            },
            {
                collection: 'project',
                data: {
                    name: 1
                }
            },
            {
                collection: 'project',
                data: {
                    uid: 1
                }
            },
            {
                collection: 'project',
                data: {
                    created: -1
                }
            },
            {
                collection: 'payment',
                data: {
                    date: -1
                }
            },
            {
                collection: 'payment',
                data: {
                    project: 1
                }
            }
        ]
    },

    // How many rows in one page (transaction logs etc.),
    pagingCount: 30,

    // How many before and after links are shown in the paging section,
    pagingRange: 5,

    // Default bit size for certificates,
    keyBitsize: 2048,

    // Google Analytics ID,
    googleAnalyticsID: false
};
