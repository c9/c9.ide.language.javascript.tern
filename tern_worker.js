define(function(require, exports, module) {
    
// TODO: we already have a version of acorn and probably shouldn't include it twice?
//       (let alone run it twice)
require("acorn/acorn");
require("acorn/acorn_loose");
require("acorn/util/walk");

// TODO: move deps to node_modules?

var tern = require("tern/lib/tern");
var baseLanguageHandler = require('plugins/c9.ide.language/base_handler');
var handler = module.exports = Object.create(baseLanguageHandler);
var tree = require("treehugger/tree");
var util = require("plugins/c9.ide.language/worker_util");

var TERN_PLUGINS = {
    angular: require("tern/plugin/angular") && true,
    component: require("tern/plugin/component") && true,
    doc_comment: require("tern/plugin/doc_comment") && true,
    node: require("tern/plugin/node") && true,
    requirejs: require("tern/plugin/requirejs") && true,
    // TODO: https://github.com/Slava/tern-meteor
};

var ternWorker;
var fileCache = {};
var dirCache = {};
var lastCacheRead = 0;
var MAX_CACHE_AGE = 60 * 1000 * 10;

handler.init = function(callback) {
    ternWorker = new tern.Server({
        async: true,
        plugins: TERN_PLUGINS,
        reuseInstances: true,
        getFile: function(file, callback) {
            // TODO: optimize, handle file changes
            util.readFile(file, function(err, data) {
                if (err) return callback(err);
    
                callback(null, data);
            });
        }
    });
    ternWorker.on("beforeLoad", function(e) {
        var file = e.name;
        var dir = dirname(e.name);
        
        if (!dirCache[dir]) {
            handler.sender.emit("watchDir", { path: dir });
        }
        
        fileCache[file] = fileCache[file] || {};
        fileCache[file].used = Date.now();
        dirCache[dir] = dirCache[dir] || {};
        dirCache[dir].used = Date.now();
        dirCache[dir][file] = true;
        lastCacheRead = Date.now();
    });
    setInterval(garbageCollect, 60000);
    callback();
};

function garbageCollect() {
    var minAge = lastCacheRead - MAX_CACHE_AGE;
    
    for (var file in fileCache) {
        if (fileCache[file].used < minAge) {
            ternWorker.delFile(file);
            delete fileCache[file];
        }
    }
    
    for (var dir in dirCache) {
        if (dirCache[dir].used < minAge) {
            handler.sender.emit("unwatchDir", { path: dir });
            delete dirCache[file];
        }
    }
}
    
handler.handlesLanguage = function(language) {
    return language === "javascript";
};

handler.getIdentifierRegex = function() {
    // Allow slashes for package names
    return (/[a-zA-Z_0-9\$\/]/);
};

handler.getCompletionRegex = function() {
    return (/^[\.]$/);
};

handler.analyze = function(value, ast, callback, minimalAnalysis) {
    ternWorker.addFile(this.path, value);
    callback();
};

handler.complete = function(doc, fullAst, pos, currentNode, callback) {
    ternWorker.addFile(this.path, doc.getValue());
    
    var options = {
        type: "completions",
        pos: pos,
        types: true,
        origins: true,
        docs: true,
        urls: true,
        guess: false,
        caseInsensitive: false,
    };
    handler.$request(options, function(err, result) {
        if (err) {
            console.error(err);
            return callback();
        }
        options.guess = true;
        handler.$request(options, function(err, guess) {
            if (err) {
                console.error(err);
                return callback();
            }

            // Only include local guesses, not wild guesses
            // like random angular.js properties on any object
            guess.completions.forEach(function(c) {
                if (!c.type || c.type === "fn()?")
                    result.completions.push(c);
            });

            callback(result.completions.map(function(c) {
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
                    doc: (c.type ? "Type: " + c.type + "<p>" : "")
                        + (c.doc ? c.doc.replace(/^\* /g, "") : ""),
                    isFunction: isFunction
                };
            }));

        })
    });
};

handler.jumpToDefinition = function(doc, fullAst, pos, currentNode, callback) {
    ternWorker.addFile(this.path, doc.getValue());
    this.$request({
        type: "definition",
        pos: pos,
        types: true,
        origins: true,
        docs: true,
        urls: true,
        caseInsensitive: false,
    }, function(err, result) {
        if (err) {
            console.error(err);
            return callback();
        }
        if (!result.file)
            return callback();
        callback({
            path: result.file,
            row: result.start.line,
            column: result.start.ch,
            icon: getIcon(result)
        });
    });
};

handler.tooltip = function(doc, fullAst, cursorPos, currentNode, callback) {
    if (!currentNode)
        return callback();
    var argIndex = -1;
    
    var callNode = getCallNode(currentNode, cursorPos);
    var displayPos;
    
    if (callNode) {
        var argPos = { row: callNode[1].getPos().sl, column: callNode[1].getPos().sc }; 
        if (argPos.row >= 9999999999)
            argPos = cursorPos;
      
        displayPos = argPos;
        argIndex = this.getArgIndex(callNode, doc, cursorPos);
    }
    else if (currentNode.isMatch('Var(_)')) {
        displayPos = { row: currentNode.getPos().sl, column: currentNode.getPos().sc };
        argIndex = -1;
        // Don't display tooltip at end of identifier (may just have been typed in)
        if (cursorPos.column === currentNode.getPos().ec)
            return callback();
    }
    else {
        return callback();
    }
    
    if (argIndex === -1 && callNode)
        return callback();

    if (!callNode)
        return callback(); // TODO: support this case??

    ternWorker.addFile(this.path, doc.getValue());
    this.$request({
        type: "type",
        pos: callNode.getPos(),
        types: true,
        origins: true,
        docs: true,
        urls: true,
        caseInsensitive: false,
    }, function(err, result) {
        if (err) {
            console.error(err);
            return callback();
        }
        if (!result.type || !result.type.match(/^fn\(/))
            return callback();

        var rangeNode = callNode && callNode.getPos().sc < 99999 ? callNode : currentNode;
        var signature = getSignature(result);
        signature.parameters[argIndex].active = true;

        callback({
            hint: {
                signatures: [{
                    name: result.name,
                    doc: result.doc && result.doc.replace(/^\* /g, ""),
                    parameters: signature.parameters,
                    returnType: signature.returnType
                }],
            },
            displayPos: displayPos,
            pos: rangeNode.getPos()
        });
    });
};

/**
 * Gets the index of the selected function argument, or returns -1 if N/A.
 */
handler.getArgIndex = function(node, doc, cursorPos) {
    var cursorTreePos = { line: cursorPos.row, col: cursorPos.column };
    var result = -1;
    node.rewrite(
        'Call(e, args)', function(b) {
            // Try to determine at which argument the cursor is located in order
            // to be able to show a label
            result = -1;
            var line = doc.getLine(cursorPos.row);
            if (line[b.args.getPos().ec + 1] && line[b.args.getPos().ec + 1].match(/[ ,]/))
                b.args.getPos().ec++;

            if (b.args.length === 0 && this.getPos().ec - 1 === cursorPos.column) {
                result = 0;
            }
            else if (b.args.length === 0 && line.substr(cursorPos.column).match(/^\s*\)/)) {
                result = 0;
            }
            else if (!tree.inRange(this.getPos(), cursorTreePos, true)) {
                return this;
            }
            else if (cursorPos.row === this.getPos().sl && line.substr(0, cursorPos.column + 1).match(/,\s*\)$/)) {
                result = b.args.length;
                return this;
            }
            for (var i = 0; i < b.args.length; i++) {
                if (b.args[i].cons === "ERROR" && result === -1) {
                    result = i;
                    break;
                }
                b.args[i].traverseTopDown(function() {
                    var pos = this.getPos();
                    if (this === node) {
                        result = i;
                        return this;
                    }
                    else if (pos && pos.sl <= cursorPos.row && pos.sc <= cursorPos.column) {
                        if (pos.sl === cursorPos.row && pos.ec === cursorPos.column - 1 && line[pos.ec] === ")")
                            return result = -1;
                        result = i;
                    }
                });
            }
            return this;
        }
    );
    return result;
};

function getCallNode(currentNode, cursorPos) {
    var result;
    currentNode.traverseUp(
        'Call(e, args)', function(b, node) {
            result = node;
            return node;
        },
        function(node) {
            // Show tooltip only on first line if call spans multiple lines
            var pos = node.getPos();
            if (pos && pos.sl !== cursorPos.row)
                return node;
        }
    );
    return result;
}

function getIcon(property) {
    if (property.guess)
        return "unknown";
    if (!property.type) {
        return "property2";
    }
    else if (property.type.match(/^fn\(/)) {
        return property.type === "fn()?" ? "method2" : "method";
    }
    else {
        return "property";
    }
}

function getParameterNames(property) {
    return getSignature(property).parameters.map(function(p) {
        return p.name;
    });
}

function dirname(path) {
    return path.replace(/[\/\\][^\/\\]*$/, "");
}

/**
 * Parse tern type strings.
 * (Would have been useful if tern exposed type objects, but this works.)
 */
function getSignature(property) {
    var sig = property.type;
    var parameters = [{ name: "", type: "" }];
    var parameterIndex = 0;
    var returnType = "";
    var depth = 0;
    var inType = false;
    var inReturn = false;
    for (var i = "fn(".length; i < sig.length; i++) {
        switch (sig[i]) {
            case "(":
                depth++; break;
            case ")":
                depth--; break;
            case ":":
                inType = true; break;
            case ",":
                if (depth)
                    break;
                inType = false;
                parameters.push({ name: "", type: "" });
                parameterIndex++;
                break;
            case " ":
                break;
            case "-": // ->
                if (depth)
                    break;
                i++;
                depth++;
                inType = false;
                inReturn = true;
                break;
            default:
                if (inReturn)
                    returnType += sig[i];
                else if (!depth && !inType)
                    parameters[parameterIndex].name += sig[i];
                else if (inType)
                    parameters[parameterIndex].type += sig[i];
        }
    }

    return {
        parameters: parameters,
        returnType: returnType || undefined
    };
}

handler.$request = function(query, callback) {
    query.file = this.path;

    if (query.pos)
        query.end = query.start = { line: query.pos.row || query.pos.sl || 0, ch: query.pos.column || query.pos.sc || 0 };
    query.lineCharPositions = true;

    ternWorker.request(
        {
            query: query,
        },
        callback
    );
}

});
