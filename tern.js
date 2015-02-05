define(function(require, exports, module) {
    main.consumes = [
        "Plugin", "language",
        "language.tern.architect_resolver" // implicit worker-side dependency
    ];
    main.provides = ["language.tern"];
    return main;

    function main(options, imports, register) {
        var Plugin = imports.Plugin;
        var language = imports.language;
        
        var plugin = new Plugin("Ajax.org", main.consumes);
        var builtins = require("text!lib/tern_from_ts/sigs/__list.json");
        
        var defs = {};
        var preferenceDefs = {};
        
        var loaded = false;
        function load() {
            if (loaded) return false;
            loaded = true;
            
            language.registerLanguageHandler("plugins/c9.ide.language.javascript.tern/worker/tern_worker");
            
            var builtinSigs;
            try {
                builtinSigs = JSON.parse(builtins).sigs;
            }
            catch (e) {
                if (e) return console.error(e);
            }

            for (var sig in builtinSigs) {
                registerDef(sig, "lib/tern_from_ts/sigs/" + builtinSigs[sig].main);
                // TODO: register "extra" defs?
            }

            registerDef("jQuery", "lib/tern/defs/jquery.json", true),
            registerDef("Browser built-in", "lib/tern/defs/browser.json", true);
            registerDef("Underscore", "lib/tern/defs/underscore.json"),
            registerDef("Chai", "tern/defs/chai.json");
        }
        
        function registerDef(name, def, enable, hide) {
            defs[name] = def;
            if (!hide)
                preferenceDefs[name] = def;
            if (enable)
                setDefEnabled(name, true);
        }
        
        function setDefEnabled(name, enabled) {
            if (!defs[name])
                throw new Error("Definition " + name + " not found");
            
            language.getWorker(function(err, worker) {
                if (err) return console.error(err);
                
                worker.emit("tern_set_def_enabled", { data: {
                    name: name,
                    def: defs[name],
                    enabled: enabled !== false
                }});
            });
        }
        
        function getDefs(preferenceDefsOnly) {
            return preferenceDefsOnly ? preferenceDefs : defs;
        }
        
        plugin.on("load", load);
        plugin.on("unload", function() {
            loaded = false;
            defs = {};
            preferenceDefs = {};
        });
        
        plugin.freezePublicAPI({
            /**
             * Add a tern definition that users can enable.
             * @param {String} name
             * @param {String|Object} def   The definition or a URL pointing to the definiton
             * @param {Boolean} enable      Whether to enable this definition by default
             * @param {Boolean} hide        Hide this definition from the preferences UI
             */
            registerDef: registerDef,
            
            /**
             * Enable or disable a definition.
             * @param name
             */
            setDefEnabled: setDefEnabled,
            
            /**
             * Get a list of all definitions.
             * 
             * @param {Boolean} Return only definitions to show in preferences.
             * @return {String[]}
             */
            getDefs: getDefs
        });
        
        /**
         * Tern-based code completion for Cloud9.
         */
        register(null, {
            "language.tern": plugin
        });
    }

});
