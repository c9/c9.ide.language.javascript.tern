define(function(require, exports, module) {
    
// TODO: we already have a version of acorn and probably shouldn't include it twice
require("acorn/acorn");
require("acorn/acorn_loose");
require("acorn/util/walk");

// TODO: move deps to node_modules? (lib/...)

var tern = require("./lib/tern/lib/tern");
require("./lib/tern/lib/signal");
require("./lib/tern/lib/def");
require("./lib/tern/lib/infer");
require("./lib/tern/lib/comment");
require("./lib/tern/plugin/angular");
require("./lib/tern/plugin/component");
require("./lib/tern/plugin/doc_comment");
require("./lib/tern/plugin/node");
require("./lib/tern/plugin/requirejs");


var baseLanguageHandler = require('plugins/c9.ide.language/base_handler');
var handler = module.exports = Object.create(baseLanguageHandler);
var ternWorker = new tern.Server({
    getFile: function(file, c) {
        debugger;
    }
});
    
handler.handlesLanguage = function(language) {
    return language === "javascript";
};

handler.analyze = function(value, ast, callback, minimalAnalysis) {
    ternWorker.addFile(this.path, value);
    callback();
};

// TODO: call this.server.delFile() when needed

handler.tooltip = function(doc, fullAst, cursorPos, currentNode, callback) {
    // TODO
    callback();
};

handler.complete = function(doc, fullAst, pos, currentNode, callback) {
    ternWorker.addFile(this.path, doc.getValue());
    this.$request({
        type: "completions",
        pos: pos,
        types: true,
        origins: true,
        docs: true,
        urls: true,
        caseInsensitive: false,
    }, function(err, data) {
        if (err) {
            console.error(err);
            return callback();
        }
        callback(data.completions.map(function(c) {
            var isFunction = c.type && c.type.match(/^fn\(/);
            var fullName = c.name
                + (isFunction
                 ? "(" + getParameterNames(c).join(", ") + ")"
                 : "");
            return {
                name: fullName,
                replaceText: c.name + (isFunction ? "(^^)" : ""),
                icon: getIcon(c),
                priority: 4,
                isContextual: !c.guess,
                docHead: fullName,
                doc: c.doc || c.type,
                isFunction: isFunction
            };
        }));
    });
}

function getIcon(property) {
    var type = property.type;
    if (!type) {
        return "unknown";
    }
    else if (type.match(/^fn\(/)) {
        return property.guess ? "method" : "method2";
    }
    else {
        return property.guess ? "property" : "property2";
    }
}

function getParameterNames(property) {
    var type = property.type;
    var results = [""];
    var resultIndex = 0;
    var depth = 0;
    var inSubtype = false;
    var inReturn = false;
    for (var i = "fn(".length; i < type.length; i++) {
        switch (type[i]) {
            case "(":
                depth++; break;
            case ")":
                depth--; break;
            case ":":
                inSubtype = true; break;
            case ",":
                if (depth)
                    break;
                inSubtype = false;
                results.push("");
                resultIndex++;
                break;
            case "-": // ->
                if (depth)
                    break;
                i++;
                depth++;
                inSubtype = false;
                inReturn = true;
                break;
            default:
                if (!depth && !inSubtype)
                    results[resultIndex] += type[i];
        }
    }

    return results;
}

handler.$request = function(query, callback) {
    query.file = this.path;

    if (query.pos)
        query.end = query.start = { line: query.pos.row, ch: query.pos.column };

    ternWorker.request(
        {
            query: query,
        },
        callback
    );
}

});
