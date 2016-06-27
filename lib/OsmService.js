var PgConnector = require('./PgConnector');

function readTemplate(file) {
    var FS = require('fs');
    var Path = require('path');
    var path = Path.join(__dirname, file);
    var str = FS.readFileSync(path, 'UTF-8');
    return getTemplate(str);
}

function getTemplate(str) {
    var array = str.split(/\$\{|\}/gim);
    return function(f) {
        var result = '';
        for (var i = 0; i < array.length; i++) {
            var s = array[i];
            if (i % 2 === 0) {
                result += s;
            } else {
                var val = f(s);
                if (val) {
                    result += val;
                }
            }
        }
        return result;
    }
}

var SQL_TEMPLATE_FILES = {
    LoadRelationInfo : 'service.LoadRelationInfo.sql',
    LoadRelationGeometry : 'service.LoadRelationGeometry.sql',
    LoadRelationLinesGeometry : 'service.LoadRelationLinesGeometry.sql',
    LoadRelationMembers : 'service.LoadRelationMembers.sql',
    LoadRelationMembersWithInfo : 'service.LoadRelationMembersWithInfo.sql',
    LoadEntityRelations : 'service.LoadEntityRelations.sql',
    LoadEntityInfo : 'service.LoadEntityInfo.sql',
    SearchEntityInfo : 'service.SearchEntityInfo.sql',
    SearchEntityInfoInRelation : 'service.SearchEntityInfoInRelation.sql',
};

function OsmService(options) {
    this.options = options || {};
    var dbUrl = this._getDbUrl();
    this.connector = new PgConnector({
        url : dbUrl,
        log : this._log.bind(this)
    });
    this._sql = {};
    var sql = SQL_TEMPLATE_FILES;
    for ( var key in sql) {
        var file = sql[key];
        this._sql[key] = readTemplate(file);
    }
}
OsmService.prototype = {

    // --------------------------------------------------------------------
    // Internal utility methods

    _getDbUrl : function() {
        var conf = this.options;
        var cred = conf.user;
        if (conf.password) {
            cred += ':' + conf.password;
        }
        if (cred && cred !== '') {
            cred += '@';
        }
        var dbUrl = 'postgres://' + cred + conf.host + ':' + conf.port + '/'
                + conf.dbname;
        return dbUrl;
    },

    // --------------------------------------------------------------------

    _log : function(msg) {
        console.log(msg);
    },

    _getIds : function(options) {
        var id = options.params.id || '';
        return id.split(',');
    },

    _execSql : function(sql, options) {
        return this.connector.exec({
            query : sql,
            offset : +options.offset || 0,
            limit : +options.limit || 100
        });
    },

    _run : function(action) {
        var that = this;
        return Promise.resolve().then(function() {
            return action.call(that);
        }).then(function(result) {
            return {
                data : result
            }
        });
    },

    // --------------------------------------------------------------------

    /**
     * Returns information about the specified relation.
     */
    loadRelation : rest('/relation/:id', 'get', function(options) {
        var that = this;
        return that._run(function() {
            var ids = that._getIds(options);
            var sql = that._sql.LoadRelationInfo(function(key) {
                return key === 'ids' ? ids.join(',') : undefined;
            });
            return that._execSql(sql, options).then(function(results) {
                return ids.length > 1 ? results : results[0];
            });
        });
    }),

    /** Returns an aggregated geometry for the specified relation. */
    loadRelationLinesGeometry : rest('/relation/:id/lines', 'get', function(
            options) {
        var that = this;
        return that._run(function() {
            var ids = that._getIds(options);
            var sql = that._sql.LoadRelationLinesGeometry(function(key) {
                return key === 'ids' ? ids.join(',') : undefined;
            });
            return that._execSql(sql, options).then(function(results) {
                results = results.map(function(f) {
                    return extend({}, {
                        id : f.id
                    }, f.geometry);
                });
                return ids.length > 1 ? results : results[0];
            });
        });
    }),

    /** Returns an aggregated geometry for the specified relation. */
    loadRelationGeometry : rest('/relation/:id/geometry', 'get', function(
            options) {
        var that = this;
        return that._run(function() {
            var ids = that._getIds(options);
            var sql = that._sql.LoadRelationGeometry(function(key) {
                return key === 'ids' ? ids.join(',') : undefined;
            });
            return that._execSql(sql, options).then(function(results) {
                results = results.map(function(f) {
                    return extend({}, {
                        id : f.id
                    }, f.geometry);
                });
                return ids.length > 1 ? results : results[0];
            });
        });
    }),

    /** Returns full members information. */
    loadRelationMembersWithInfo : rest('/relation/full/:id', 'get', function(
            options) {
        var that = this;
        return that._run(function() {
            var ids = that._getIds(options);
            var sql = that._sql.LoadRelationMembersWithInfo(function(key) {
                return key === 'ids' ? ids.join(',') : undefined;
            });
            return that._execSql(sql, options);
        });
    }),

    /** Returns a list of all member identifiers. */
    loadRelationMembers : rest('/relation/:id/members', 'get',
            function(options) {
                var that = this;
                return that._run(function() {
                    var ids = that._getIds(options);
                    var sql = that._sql.LoadRelationMembers(function(key) {
                        return key === 'ids' ? ids.join(',') : undefined;
                    });
                    return that._execSql(sql, options).then(function(results) {
                        return ids.length > 1 ? results : results[0];
                    });
                });
            }),

    // ----------------------------------------------------------------------
    _getWhereStatement : function(propertiesCriteria) {
        var params = {}
        function serialize(val) {
            if (Array.isArray(val)) {
                return '(' + val.map(serialize) + ')';
            } else {
                if (typeof val === 'string') {
                    val = "'" + val + "'";
                } else {
                    val = JSON.stringify(val);
                }
                val = val.replace(/\*/gim, '%');
                return val;
            }
        }
        function getType(val) {
            for (var i = 0; i < val.length; i++) {
                var v = +val[i];
                if (!isNaN(v))
                    return 'numeric';
            }
            return undefined;
        }
        Object.keys(propertiesCriteria).forEach(function(key) {
            var val = propertiesCriteria[key];
            if (val === null) {
                params[key] = {
                    operator : 'IS NOT',
                    value : 'NULL'
                };
            } else if (Array.isArray(val)) {
                params[key] = {
                    value : serialize(val),
                    operator : 'IN',
                    type : getType(val)
                }
            } else if (typeof val === 'object') {
                params[key] = val;
            } else if (typeof val === 'string') {
                params[key] = {
                    value : serialize(val),
                    operator : 'ILIKE'
                };
            } else if (!isNaN(+val)) {
                params[key] = {
                    value : serialize(val),
                    operator : '=',
                    type : 'numeric'
                };
            } else {
                params[key] = {
                    value : serialize(val),
                    operator : '='
                };
            }
        });

        var where = '';
        where += Object.keys(params).map(function(k) {
            var o = params[k];
            var key = "(R.properties->'" + k + "')";
            if (o.type) {
                key += "::" + o.type;
            }
            return "(" + key + ' ' + o.operator + " " + o.value + ")"
        }).join(' AND ');
        return where;
    },

    /**
     * Returns information about the specified entity (id, properties +
     * geometry).
     */
    searchEntityInfo : rest('/search', 'get', function(options) {
        var that = this;
        return that._run(function() {
            var where = that._getSearchWhereStatement(options);
            if (where) {
                where = 'WHERE (' + where + ')';
            }
            var sql = that._sql.SearchEntityInfo(function(key) {
                return key === 'where' ? where : undefined;
            });
            // console.log('SEARCH SQL: ', sql);
            return that._execSql(sql, options);
        });
    }),

    /**
     * Returns information about the specified entity (id, properties +
     * geometry).
     */
    searchEntityInfoInRelation : rest('/relation/:id/search', 'get', function(
            options) {
        var that = this;
        return that._run(function() {
            var where = that._getSearchWhereStatement(options);
            if (where) {
                where = ' AND (' + where + ')';
            }
            var ids = that._getIds(options);
            var sql = that._sql.SearchEntityInfoInRelation(function(key) {
                if (key === 'where')
                    return where;
                if (key === 'ids')
                    return ids.join(',');
            });
            // console.log('RELATION SEARCH SQL: ', sql);
            return that._execSql(sql, options);
        });
    }),

    _getSearchWhereStatement : function(options) {
        var where = options.where;
        if (!where) {
            var propertiesCriteria;
            try {
                var query = options.query;
                propertiesCriteria = JSON.parse(query.properties);
            } catch (err) {
                return [];
            }
            where = this._getWhereStatement(propertiesCriteria);
        }
        return where;
    },

    /**
     * Returns information about the specified entity (id, properties +
     * geometry).
     */
    loadEntityInfo : rest('/entity/:id', 'get', function(options) {
        var that = this;
        return that._run(function() {
            var ids = that._getIds(options);
            var sql = that._sql.LoadEntityInfo(function(key) {
                return key === 'ids' ? ids.join(',') : undefined;
            });
            return that._execSql(sql, options).then(function(results) {
                return ids.length > 1 ? results : results[0];
            });
        });
    }),

    /**
     * Returns all relations associated with the specified entity.
     */
    loadEntityRelations : rest('/entity/:id/relations', 'get',
            function(options) {
                var that = this;
                return that._run(function() {
                    var ids = that._getIds(options);
                    var sql = that._sql.LoadEntityRelations(function(key) {
                        return key === 'ids' ? ids.join(',') : undefined;
                    });
                    return that._execSql(sql, options);
                });
            }),

};
module.exports = OsmService;

/**
 * This utility function "annotates" the specified object methods by the
 * corresponding REST paths and HTTP methods.
 */
function rest(path, http, method) {
    method.http = http;
    method.path = path;
    return method;
}
