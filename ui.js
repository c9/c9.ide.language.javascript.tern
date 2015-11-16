define(function(require, exports, module) {
    main.consumes = [
        "Plugin", "preferences"
    ];
    main.provides = ["language.tern.ui"];
    return main;

    function main(options, imports, register) {
        var Plugin = imports.Plugin;
        
        var plugin = new Plugin("Ajax.org", main.consumes);
        var prefs = imports.preferences;
        
        var loaded = false;
        function load() {
            if (loaded) return;
            loaded = true;
            
            prefs.add({
                "Language" : {
                    position: 500,
                    "Tern" : {
                        position: 100,
                        "Tern Completions" : {
                            type: "checkbox",
                            path: "user/language/@continuousCompletion",
                            position: 4000
                        },
                    }
                }
            });
        }
        
        plugin.on("load", load);
        plugin.on("unload", function() {
            loaded = false;
        });
        
        plugin.freezePublicAPI({
        });
        
        /**
         * Tern-based code completion for Cloud9.
         */
        register(null, {
            "language.tern.ui": plugin
        });
    }

});