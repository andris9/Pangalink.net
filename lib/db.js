'use strict';

const config = require('config');
const MongoClient = require('mongodb').MongoClient;

let dbObj;

module.exports.init = function(callback) {
    MongoClient.connect(config.mongodb.url, {}, (err, db) => {
        if (err) {
            return callback(err);
        }

        dbObj = db;

        let i = 0;
        let ensureIndexes = () => {
            if (i >= config.mongodb.indexes.length) {
                return callback(null, db);
            }

            let index = config.mongodb.indexes[i++];
            db.ensureIndex(index.collection, index.data, ensureIndexes);
        };

        ensureIndexes();
    });
};

module.exports.save = function(collectionName, record, callback) {
    record = record || {};
    let id = record._id;

    dbObj.collection(collectionName, (err, collection) => {
        if (err) {
            return callback(err);
        }

        if (id) {
            collection.findAndModify(
                {
                    _id: id
                },
                false,
                record,
                {
                    upsert: true, // insert as new if not found
                    new: true // return updated record
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

        collection.findAndModify(
            query,
            false,
            update,
            {
                upsert: true, // insert as new if not found
                new: true // return updated record
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

        if (!('limit' in options)) {
            options.limit = 1000;
        }

        collection.find(query, fields, options).toArray((err, docs) => {
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
