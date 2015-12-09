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
        var builtinSigs = JSON.parse(require("text!lib/tern_from_ts/sigs/__list.json")).sigs;
        var builtinTrusted = [
            "meteor"
        ];
        var plugin = new Plugin("Ajax.org", main.consumes);
        
        var defaultPlugins = options.plugins;
        var defaultDefs = options.defs;
        
        var defs = {};
        var preferenceDefs = {};
        
        var loaded = false;
        function load() {
            if (loaded) return false;
            loaded = true;
            
            language.registerLanguageHandler("plugins/c9.ide.language.javascript.tern/worker/tern_worker");

            for (var sig in builtinSigs) {
                registerDef(
                    sig,
                    "lib/tern_from_ts/sigs/" + builtinSigs[sig].main,
                    // TODO: register "extra" defs?
                    {
                        experimental: builtinTrusted.indexOf(sig) == -1,
                        url: builtinSigs[sig].url
                    }
                );
            }
            registerDef("Angular.js", "tern/plugin/angular", { url: "https://angularjs.org/" });

            getPlugins(function callback(e) {
                var pluginName;
                var pluginPath;
                for (pluginName in defaultPlugins) {
                    pluginPath = defaultPlugins[pluginName];
                    e.push({
                        name: pluginName,
                        enabled: true,
                        path: pluginPath
                    });
                }
            });

            var defsToAdd = [];
            var defIndex;
            var d;
            for (defIndex in defaultDefs) {
                d = defaultDefs[defIndex];
                defs[d.name] = d.path;
                if (d.enabled) {
                    defsToAdd.push(d.path);
                }
            }
            language.getWorker(function(err, worker) {
                if (err) return console.error(err);
                worker.emit("tern_set_def_enabled", {
                    data: {
                        name: "",
                        def: defsToAdd,
                        enabled: true
                    }
                });
            });
        }
                    
        function registerDef(name, def, options) {
            options = options || {};
            options.name = name;
            defs[name] = def;
            preferenceDefs[name] = options;
            if (options.enabled)
                setDefEnabled(name, true);
        }

        function setDefEnabled(name, enabled) {
            var defsDefinedByPlugin = ["angular", "node", "component", "requirejs"];
            if (!defs[name] && defsDefinedByPlugin.indexOf(name) === -1)
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
        
        function setTernServerOptions(ternServerOptions) {
            language.getWorker(function(err, worker) {
                if (err) return console.error(err);
                worker.emit("tern_set_server_options", { data:ternServerOptions});
            });
        }
        
        function getPlugins(callback) {
            language.getWorker(function(err, worker) {
                if (err) return console.error(err);
                worker.on("tern_read_plugins", function tern_read_plugins(e) {
                    var backupPluginStatus;
                    worker.off(tern_read_plugins);
                    backupPluginStatus = JSON.stringify(e.data);
                    callback(e.data);
                    if (JSON.stringify(e.data) != backupPluginStatus) {
                        // state of plugins have changed, update ternWorker
                        worker.emit("tern_update_plugins", { data: e.data });
                    }
                });
                worker.emit("tern_get_plugins", { data: null });
            });
        }
        
        function setTernRequestOptions(ternRequestOptions) {
            language.getWorker(function(err, worker) {
                if (err) return console.error(err);
                worker.emit("tern_set_request_options", { data:ternRequestOptions });
            });

        }
        
        function getDefs() {
            return preferenceDefs;
        }
        
        plugin.on("load", load);
        plugin.on("unload", function() {
            loaded = false;
            defs = {};
            preferenceDefs = {};
        });
        
        plugin.freezePublicAPI({
            /**
             * Callback function for getting tern definition list from directly tern server
             * @typedef {Object} pluginInfo
             * @property {String} name - name of the plugin
             * @property {boolean} enabled - Setting it false marks plugin for removal
             * @property {String} path - Parameter to provide while loading a new plugin
             *
             * This callback is to retrieve names of definitions
             * @callback getTernDefNamesCallback
             * @param {Array.String} names Array of names
             *
             * This callback is to retrieve plugin info
             * @callback ternPluginsCallback
             * @param {Array.pluginInfo} e list of plugins with status
             */

            /**
             * Add a tern definition that users can enable.
             * @param {String} name
             * @param {String|Object} def              The definition or a URL pointing to the definiton
             * @param {Object} [options]
             * @param {Boolean} [options.enabled]      Whether to enable this definition by default
             * @param {Boolean} [options.hidden]       Hide this definition from the preferences UI
             */
            registerDef: registerDef,
            
            /**
             * Enable or disable a definition.
             * @param name
             */
            setDefEnabled: setDefEnabled,
            
            /**
             * Sets tern server options
             * @param {Object} ternServerOptions
             */
            setTernServerOptions: setTernServerOptions,
             
             /**
              * Gets list of loaded tern plugins. When retrieved can disable plugins and add new ones
              * 
              * @param {ternPluginsCallback} callback required function to process status of plugins
              */
            getPlugins: getPlugins,
            
            /**
             * Sets tern request options
             * @param {Object} ternRequestOptions
             */
            setTernRequestOptions: setTernRequestOptions,
            
            /**
             * Get a list of all definitions.
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