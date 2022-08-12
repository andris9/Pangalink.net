'use strict';

// This is the main file. Here we set globals as well

let config = require('wild-config');
let log = require('npmlog');

log.level = config.log.level;

// Handle error conditions
process.on('SIGTERM', () => {
    log.warn('PROCESS', 'Exited on SIGTERM');
    process.exit(0);
});

process.on('SIGINT', () => {
    log.warn('PROCESS', 'Exited on SIGINT');
    process.exit(0);
});

process.on('uncaughtException', err => {
    log.error('UNCAUGHT', err.stack);
});

process.on('uncaughtException', err => {
    log.error('UNCAUGHT', err.stack);
    process.exit(1);
});

// Start the server
log.info('WORKER', 'Starting worker ' + process.pid);
require('./server');
