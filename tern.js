/**
 * Tern plugin for Cloud9
 */
define(function(require, exports, module) {
    main.consumes = [
        "Plugin", "language", "watcher", "tree"
    ];
    main.provides = ["language.tern"];
    return main;

    function main(options, imports, register) {
        var Plugin = imports.Plugin;
        var language = imports.language;
        var watcher = imports.watcher;
        var tree = imports.tree;
        
        var plugin = new Plugin("Ajax.org", main.consumes);
        var watched = {};
        var worker;
        
        var loaded = false;
        function load() {
            if (loaded) return false;
            loaded = true;
            
            language.registerLanguageHandler("plugins/c9.ide.language.javascript.tern/tern_worker");
            
            language.getWorker(function(err, _worker) {
                if (err) return console.error(err);
                
                worker = _worker;
                worker.on("watchDir", watchDir);
                worker.on("unwatchDir", unwatchDir);
                watcher.on("unwatch", onWatchRemoved);
                watcher.on("directory", onWatchChange);
            });
        }
    
        function watchDir(e) {
            var path = e.data.path;
            watcher.watch(path);
            watched[path] = true;
        }
        
        function unwatchDir(e) {
            var path = e.data.path;
            watched[path] = false;
            // HACK: don't unwatch if visible in tree
            if (tree.getAllExpanded().indexOf(path) > -1)
                return;
            watcher.unwatch(path);
        }
        
        function onWatchRemoved(e) {
            // HACK: check if someone removed my watcher
            if (watched[e.path])
                watchDir(e.path);
        }
        
        function onWatchChange(e) {
            if (watched[e.path])
                worker.emit("watchDirResult", { data: e });
        }
        
        plugin.on("load", load);
        
        register(null, {
            "language.tern": plugin
        });
    }

});
