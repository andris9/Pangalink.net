'use strict';

const config = require('config');
const MongoClient = require('mongodb').MongoClient;

let dbObj;

module.exports.init = function(callback) {
    MongoClient.connect(
        config.mongodb.url,
        {
            useNewUrlParser: true,
            reconnectTries: 100000,
            reconnectInterval: 1000
        },
        (err, db) => {
            if (err) {
                return callback(err);
            }
            if (db.s && db.s.options && db.s.options.dbName) {
                db = db.db(db.s.options.dbName);
            }
            module.exports.database = dbObj = db;
            return callback(null, db);
        }
    );
};

module.exports.save = function(collectionName, record, callback) {
    record = record || {};
    let id = record._id;

    dbObj.collection(collectionName, (err, collection) => {
        if (err) {
            return callback(err);
        }

        if (id) {
            let data = {};
            Object.keys(record || {}).forEach(key => {
                if (!['_id'].includes(key)) {
                    data[key] = record[key];
                }
            });
            collection.findOneAndUpdate(
                {
                    _id: id
                },
                { $set: data },
                {
                    upsert: true, // insert as new if not found
                    returnOriginal: false // return updated record
                },
                (err, record) => {
                    if (err) {
                        return callback(err);
                    }
                    callback(null, (record && record.value && record.value._id) || false);
                }
            );
        } else {
            collection.insertOne(
                record,
                {
                    w: 1,
                    j: true
                },
                (err, result) => {
                    if (err) {
                        return callback(err);
                    }
                    callback(null, (result && result.insertedId) || false);
                }
            );
        }
    });
};

module.exports.findOne = function(collectionName, query, callback) {
    dbObj.collection(collectionName, (err, collection) => {
        if (err) {
            return callback(err);
        }
        collection.findOne(query, (err, record) => {
            if (err) {
                return callback(err);
            }
            callback(null, record || false);
        });
    });
};

module.exports.modify = function(collectionName, query, update, callback) {
    dbObj.collection(collectionName, (err, collection) => {
        if (err) {
            return callback(err);
        }

        collection.findOneAndUpdate(
            query,
            update,
            {
                upsert: true, // insert as new if not found
                returnOriginal: false // return updated record
            },
            (err, record) => {
                if (err) {
                    return callback(err);
                }
                callback(null, (record && record.value) || false);
            }
        );
    });
};

module.exports.count = function(collectionName, query, callback) {
    dbObj.collection(collectionName, (err, collection) => {
        if (err) {
            return callback(err);
        }
        collection.find(query).count((err, count) => {
            if (err) {
                return callback(err);
            }
            return callback(null, Number(count) || 0);
        });
    });
};

module.exports.find = function(collectionName, query, fields, options, callback) {
    dbObj.collection(collectionName, (err, collection) => {
        if (err) {
            return callback(err);
        }
        if (!callback && typeof options === 'function') {
            callback = options;
            options = undefined;
        }
        if (!callback && typeof fields === 'function') {
            callback = fields;
            fields = undefined;
        }
        options = options || {};
        fields = fields || {};

        if (fields) {
            options.projection = fields;
        }

        if (!('limit' in options)) {
            options.limit = 1000;
        }

        collection.find(query, options).toArray((err, docs) => {
            if (err) {
                return callback(err);
            }
            return callback(null, [].concat(docs || []));
        });
    });
};

module.exports.remove = function(collectionName, query, callback) {
    dbObj.collection(collectionName, (err, collection) => {
        if (err) {
            return callback(err);
        }
        collection.remove(
            query,
            {
                w: 1,
                j: true
            },
            (err, removed) => {
                if (err) {
                    return callback(err);
                }
                callback(null, removed);
            }
        );
    });
};
