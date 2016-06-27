var FS = require('fs');
var PG = require('pg.js')

module.exports = PgConnector;

/**
 * This class provides some utility methods allowing to query Postgres database
 * and return resulting JSON objects using promises.
 *
 * @param options.url
 *            url of the Db connection
 */
function PgConnector(options) {
    var that = this;
    that.options = options || {};
    if (!that.options.url)
        throw new Error('DB connection URL is not defined');
}

/** Executes the specified query and returns a list of results - JSON objects */
PgConnector.prototype.exec = function(options) {
    var that = this;
    return that._connect(function(client) {
        var params = options.params || [];
        var query = that._prepareQuery(options);
        return new Promise(function(resolve, reject){
            return client.query(query, params, function(err, res){
                if (err) return reject(err);
                return resolve(res.rows);
            });
        });
    });
}

/** Prepares the specified query based on the given parameters */
PgConnector.prototype._prepareQuery = function(options) {
    var query = options.query;
    var limit = +options.limit;
    var offset = +options.offset;
    if (this.options.log) {
        this.options.log('SQL: ' + query);
    }
    query = 'select * from (' + query + ') as data ';
    if (!isNaN(offset) && offset > 0) {
        query += ' offset ' + offset;
    }
    if (!isNaN(limit) && limit >= 0) {
        query += ' limit ' + limit;
    }
    return query;
};

/**
 * Opens connection to the Db and calls the specified action with the
 * connection
 */
PgConnector.prototype._connect = function(action) {
    var that = this;
      return new Promise(function(resolve, reject){
        PG.connect(that.options.url, function(err, client, done) {
            return Promise.resolve().then(function() {
                if (err) { return reject(err); }
                return action(client);
            }).then(function(result) {
                resolve(result);
            }, function(err) {
                reject(err);
            }).then(done);
        })
    });
}
