define(function(require, exports, module) {
    
var acornCache = require("./acorn_cache");
var tern = require("tern/lib/tern");
var baseLanguageHandler = require('plugins/c9.ide.language/base_handler');
var handler = module.exports = Object.create(baseLanguageHandler);
var tree = require("treehugger/tree");
var util = require("plugins/c9.ide.language/worker_util");
var completeUtil = require("plugins/c9.ide.language/complete_util");
var filterDocumentation = require("plugins/c9.ide.language.jsonalyzer/worker/ctags/ctags_util").filterDocumentation;
var architectResolver = require("./architect_resolver_worker");
var inferCompleter = require("plugins/c9.ide.language.javascript.infer/infer_completer");

// TODO: async fetch?
var TERN_DEFS = [
    JSON.parse(completeUtil.fetchText("lib/tern/defs/browser.json")),
    JSON.parse(completeUtil.fetchText("lib/tern/defs/ecma5.json")),
    JSON.parse(completeUtil.fetchText("lib/tern/defs/jquery.json")),
    JSON.parse(completeUtil.fetchText("lib/tern/defs/underscore.json")),
    // JSON.parse(completeUtil.fetchText("tern/defs/chai.json")),
];

var TERN_PLUGINS = {
    angular: require("tern/plugin/angular") && true,
    component: require("tern/plugin/component") && true,
    doc_comment: require("tern/plugin/doc_comment") && true,
    node: require("tern/plugin/node") && true,
    requirejs: require("tern/plugin/requirejs") && true,
    architect_resolver: architectResolver && true,
    // TODO: only include meteor completions if project has a .meteor folder,
    //       or if we find 1 or more meteor globals anywhere
    // TODO: maybe enable this meteor plugin again?
    // meteor: require("./lib/tern-meteor/meteor") && true,
    // TODO: use https://github.com/borisyankov/DefinitelyTyped
};

var ternWorker;
var fileCache = {};
var dirCache = {};
var lastAddPath;
var lastAddValue;
var lastCacheRead = 0;
var MAX_CACHE_AGE = 60 * 1000 * 10;
var MAX_FILE_SIZE = 200 * 1024;
    
handler.handlesLanguage = function(language) {
    // Note that we don't really support jsx here,
    // but rather tolerate it using error recovery...
    return language === "javascript" || language === "jsx";
};

handler.getCompletionRegex = function() {
    return (/^[\.]$/);
};

handler.getMaxFileSizeSupported = function() {
    // .25 of current base_handler default
    return .25 * 10 * 1000 * 80;
};

handler.init = function(callback) {
    ternWorker = new tern.Server({
        async: true,
        defs: TERN_DEFS,
        plugins: TERN_PLUGINS,
        dependencyBudget: MAX_FILE_SIZE,
        reuseInstances: true,
        getFile: function(file, callback) {
            if (!file.match(/[\/\\][^/\\]*\.[^/\\]*$/))
                file += ".js";
            util.stat(file, function(err, stat) {
                if (stat && stat.size > MAX_FILE_SIZE) {
                    err = new Error("File is too large to include");
                    err.code = "ESIZE";
                }
                
                if (err)
                    return done(err);

                fileCache[file] = fileCache[file] || {};
                fileCache[file].mtime = stat.mtime;
        
                util.readFile(file, { allowUnsaved: true }, function(err, data) {
                    if (err) return done(err);

                    lastAddPath = null; // invalidate cache
                    done(null, data);
                });
            });

            function done(err, result) {
                try {
                    callback(err, result);
                }
                catch (err) {
                    console.error(err.stack);
                }
            }
        }
    });
    acornCache.init();
    inferCompleter.setExtraModules(ternWorker.cx.definitions.node);
    
    ternWorker.on("beforeLoad", function(e) {
        var file = e.name;
        var dir = dirname(e.name);
        
        if (!dirCache[dir])
            util.$watchDir(dir, handler);
        
        fileCache[file] = fileCache[file] || {};
        dirCache[dir] = dirCache[dir] || {};
        dirCache[dir].used = Date.now();
        dirCache[dir][file] = true;
        lastCacheRead = Date.now();
    });
    util.$onWatchDirChange(onWatchDirChange);
    setInterval(garbageCollect, 60000);
    callback();
};

function onWatchDirChange(e) {
    var dir = e.data.path.replace(/\/?$/, "/");
    e.data.files.forEach(function(stat) {
        var file = dir + stat.name;
        if (!fileCache[file] || fileCache[file].mtime >= stat.mtime)
            return;
        ternWorker.delFile(file);
        delete fileCache[file];
        lastAddPath = null; // invalidate local file cache
    });
}

function garbageCollect() {
    var minAge = lastCacheRead - MAX_CACHE_AGE;
    
    for (var file in fileCache) {
        if (fileCache[file].used < minAge) {
            ternWorker.delFile(file);
            delete fileCache[file];
            if (lastAddPath === file)
                lastAddPath = null;
        }
    }
    
    for (var dir in dirCache) {
        if (dirCache[dir].used < minAge) {
            handler.sender.emit("unwatchDir", { path: dir });
            delete dirCache[file];
        }
    }
}

handler.analyze = function(value, ast, callback, minimalAnalysis) {
    if (fileCache[this.path])
        return callback();

    // Pre-analyze  the first time we see a file, loading any imports
    fileCache[this.path] = {
        mtime: 0, // prefer reloading since we may be unsaved
        used: Date.now()
    };
    addTernFile(this.path, value);

    if (architectResolver.ready) {
        ternWorker.flush(callback);
    }
    else {
        handler.sender.once("architectPluginsResult", function() {
            setTimeout(handler.$flush.bind(handler, function(err) {
                if (err) console.error(err.stack || err);
                callback();
            }));
        });
    }
};

handler.complete = function(doc, fullAst, pos, currentNode, callback) {
    addTernFile(this.path, doc.getValue());
    
    var options = {
        type: "completions",
        pos: pos,
        types: true,
        origins: true,
        docs: true,
        urls: true,
        guess: true,
        caseInsensitive: false,
    };
    handler.$request(options, function(err, result) {
        if (err) {
            console.error(err.stack || err);
            return callback();
        }

        callback(result.completions.map(function(c) {
            // Avoid random suggestions like angular.js properties on any object
            if (c.guess && c.type && c.type !== "fn()?)")
               return;
            var icon = getIcon(c);

            // Clean up messy node completions
            if (c.name[0] === '"') {
                if (c.origin !== "node")
                    return;
                c.name = c.name.replace(/"(.*)"/, "$1");
                icon = "package";
            }

            var isContextual = currentNode.cons === "PropAccess" && !c.guess;
                        
            var isFunction = c.type && c.type.match(/^fn\(/)
            var isAnonymous = c.type && c.type.match(/^{/);
            var parameters = isFunction && getSignature(c).parameters.map(function(p) {
                return p.name + (p.type && p.type !== "?" ? " : " + p.type : "");
            }).join(", ");
            var doc = (c.type && !isFunction && !isAnonymous && c.type !== "?" ? "Type: " + c.type + "<p>" : "")
                    + (c.doc ? filterDocumentation(c.doc) : "");
            var fullName = c.name
                + (isFunction ? "(" + parameters + ")" : "");
            return {
                id: c.name,
                name: fullName,
                replaceText: c.name + (isFunction ? "(^^)" : ""),
                icon: icon,
                priority: 5,
                isContextual: isContextual,
                docHead: doc && fullName,
                doc: (c.origin ? "Origin: " + c.origin + "<p>" : "") + doc,
                isFunction: isFunction
            };
        }).filter(function(c) {
            return c;
        }));
    });
};

handler.jumpToDefinition = function(doc, fullAst, pos, currentNode, callback) {
    addTernFile(this.path, doc.getValue());
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
            console.error(err.stack || err);
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

/* UNDONE: getRenamePositions(); doesn't appear to properly handle local references
   e.g. var foo = child_process.exec(); foo(); -> foo can't be renamed
handler.getRenamePositions = function(doc, fullAst, pos, currentNode, callback) {
    addTernFile(this.path, doc.getValue());
    this.$request({
        type: "definition",
        pos: pos,
        types: true,
        origins: true,
        docs: true,
        urls: true,
        caseInsensitive: false,
    }, function(err, def) {
        if (err) {
            console.error(err.stack || err);
            return callback();
        }
        if (handler.path !== def.file) {
            console.error("Multi-file rename not supported");
            return callback();
        }

        handler.$request({
            type: "refs",
            pos: pos,
            types: true,
            origins: true,
            docs: true,
            urls: true,
            caseInsensitive: false,
        }, function(err, refs) {
            if (err) {
                console.error(err.stack || err);
                return callback();
            }

            var allIds = [def].concat(refs.refs);
            var selected = allIds.filter(function(id) {
                return pos.row === id.start.line
                    && id.start.ch <= pos.column && pos.column < id.end.ch;
            });
            if (!selected.length) {
                console.error("Could not find selected identifier");
                return callback();
            }

            callback({
                length: def.end.ch - def.start.ch,
                pos: { row: selected[0].start.line, column: selected[0].start.ch },
                others: allIds.filter(function(ref) {
                    return ref.file === handler.path;
                }).map(function(ref) {
                    return { row: ref.start.line, column: ref.start.ch };
                }),
            });
        });
    });
};
*/

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

    addTernFile(this.path, doc.getValue());
    this.$request({
        type: "type",
        pos: { row: callNode[0].getPos().el, column: callNode[0].getPos().ec },
        types: true,
        origins: true,
        docs: true,
        urls: true,
        caseInsensitive: false,
    }, function(err, result) {
        if (err) {
            console.error(err.stack || err);
            return callback();
        }
        if (!result.type || !result.name || !result.type.match(/^fn\(/))
            return callback();

        var rangeNode = callNode && callNode.getPos().sc < 99999 ? callNode : currentNode;
        var signature = getSignature(result);
        if (signature.parameters[argIndex])
            signature.parameters[argIndex].active = true;

        signature.parameters.forEach(function(p) {
            if (p.type === "?")
                delete p.type;
        });
        if (signature.returnType === "?")
            delete signature.returnType;

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
    if (property.guess || !property.type || property.type === "fn()?") {
        // These were found in calls or property accesses and are uncertain
        return property.type ? "method2" : "property2";
    }
    else if (property.type.match(/^fn\(/)) {
        return "method"; // property.doc ? "method" : "method2";
    }
    else {
        return "property"; // property.doc ? "property" : "property2";
    }
}

function addTernFile(path, value) {
    if (lastAddPath === path && lastAddValue === value)
        return;
    lastAddPath = path;
    lastAddValue = value;
    ternWorker.addFile(path, value);
}

function dirname(path) {
    return path.replace(/[\/\\][^\/\\]*$/, "");
}

/**
 * Parse tern type strings.
 * (Would have been useful if tern exposed type objects, but this works.)
 */
function getSignature(property) {
    if (!property.type || !property.type.match(/^fn\(/))
        return { parameters: [] };
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
                else if (!depth && inType)
                    parameters[parameterIndex].type += sig[i];
        }
    }

    if (parameters[0].name === "")
        parameters.shift();

    return {
        parameters: parameters,
        returnType: returnType || undefined
    };
}

handler.$request = function(query, callback) {
    query.file = this.path;

    if (query.pos)
        query.end = query.start = {
            line: query.pos.row || query.pos.sl || 0,
            ch: query.pos.column || query.pos.sc || 0
        };
    query.lineCharPositions = true;

    try {
        ternWorker.request(
            {
                query: query,
            },
            done
        );
    }
    catch (err) {
        if (isDone) throw err;
        return done(err);
    }

    var isDone;
    function done(err, result) {
        isDone = true;
        callback(err, result);
    }
};

handler.$flush = function(callback) {
    try {
        ternWorker.flush(ternWorker, done);
    }
    catch (err) {
        if (isDone) throw err;
        return done(err);
    }

    var isDone;
    function done(err, result) {
        isDone = true;
        callback(err, result);
    }
}

});
