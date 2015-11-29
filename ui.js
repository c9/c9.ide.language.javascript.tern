define(function(require, exports, module) {
    main.consumes = [
        "Plugin", "preferences", "ui", "Datagrid", "preferences.experimental", "language.tern"
    ];
    main.provides = ["language.tern.ui"];
    return main;

    function main(options, imports, register) {
        var Plugin = imports.Plugin;
        var prefs = imports.preferences;
        var ui = imports.ui;
        var Datagrid = imports.Datagrid;
        var tern = imports["language.tern"];
        var plugin = new Plugin("Ajax.org", main.consumes);
        var experimental = imports["preferences.experimental"];
        
        var ENABLED = experimental.addExperiment("libraries", false, "Language/JavaScript Library Completions in Project Settings");
        var datagrid;
        
        var loaded = false;
        function load() {
            if (loaded) return;
            loaded = true;
            
            if (!ENABLED) return;
            
            prefs.add({
                "Project": {
                    "Language Support" : {
                        position: 700,
                        "Tern Completions" : {
                            position: 200,
                            type: "custom",
                            name: "ternCompletions",
                            node: new ui.bar({
                                style: "padding:10px"
                            })
                        },
                    }
                }
            }, plugin);
            
            plugin.getElement("ternCompletions", initPreferences);
        }
        
        function initPreferences(elem) {
            var container = elem.$ext.appendChild(document.createElement("div"));
            datagrid = new Datagrid({
                container: container,
                enableCheckboxes: true,
                emptyMessage: "Loading...",
                minLines: 3,
                maxLines: 10,
                sort: function(array) {
                    return array.sort(function compare(a, b) {
                        return a.label.toLowerCase() > b.label.toLowerCase() ? 1 : -1;
                    });
                },
                columns : [
                    {
                        caption: "Name",
                        value: "name",
                        width: "100%",
                        type: "tree"
                    }, 
                    // {
                    //     caption: "Description",
                    //     value: "description",
                    //     width: "65%",
                    // }
                ],
            }, plugin);
            datagrid.once("draw", function() {
                var builtins = tern.getDefs(true);
                datagrid.on("check", onChange.bind(null, true));
                datagrid.on("uncheck", onChange.bind(null, false));
                datagrid.setRoot(Object.keys(builtins).map(function(b) {
                    return {
                        label: b,
                        description: '<a href="' + builtins[b].url + '">' + builtins[b].url + '</a>',
                        main: builtins[b].main,
                        extra: builtins[b].extra,
                    };
                }));
            });
        }
        
        function onChange(node) {
            tern.setDefEnabled(node.label, node.isChecked);
        }
        
        plugin.on("load", load);
        plugin.on("unload", function() {
            loaded = false;
            datagrid = null;
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