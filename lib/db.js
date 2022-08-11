'use strict';

const config = require('config');
const mongodb = require('mongodb');
const log = require('npmlog');

const { MongoClient } = mongodb;

const setupIndexes = require('../indexes');

let dbObj;

module.exports.init = async function (callback) {
    const mongoClient = await MongoClient.connect(config.mongodb.url, {
        useNewUrlParser: true,
        useUnifiedTopology: true
    });

    module.exports.connection = mongoClient;
    dbObj = module.exports.database = mongoClient.db(config.mongodb.db);

    for (const indexGroup of setupIndexes || []) {
        for (let index of indexGroup.indexes) {
            try {
                await module.exports.database.collection(indexGroup.collection).createIndexes([index]);
            } catch (err) {
                log.error('Mongo', 'Failed to create index %s/%s %s', indexGroup.collection, index.name, err.message);
            }
        }
    }

    return module.exports.database;
};

module.exports.save = function (collectionName, record, callback) {
    record = record || {};
    let id = record._id;

    if (id) {
        let data = {};
        Object.keys(record || {}).forEach(key => {
            if (!['_id'].includes(key)) {
                data[key] = record[key];
            }
        });

        dbObj.collection(collectionName).findOneAndUpdate(
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
        dbObj.collection(collectionName).insertOne(
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
};

module.exports.findOne = function (collectionName, query, callback) {
    dbObj.collection(collectionName).findOne(query, (err, record) => {
        if (err) {
            return callback(err);
        }
        callback(null, record || false);
    });
};

module.exports.modify = function (collectionName, query, update, callback) {
    dbObj.collection(collectionName).findOneAndUpdate(
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
};

module.exports.count = function (collectionName, query, callback) {
    dbObj.collection(collectionName).countDocuments(query, (err, count) => {
        if (err) {
            return callback(err);
        }
        return callback(null, Number(count) || 0);
    });
};

module.exports.find = function (collectionName, query, fields, options, callback) {
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

    dbObj
        .collection(collectionName)
        .find(query, options)
        .toArray((err, docs) => {
            if (err) {
                return callback(err);
            }
            return callback(null, [].concat(docs || []));
        });
};

module.exports.remove = function (collectionName, query, callback) {
    dbObj.collection(collectionName).remove(
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
};
