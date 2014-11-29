/**
 * Tern plugin for Cloud9
 */
define(function(require, exports, module) {
    main.consumes = [
        "Plugin", "language"
    ];
    main.provides = [];
    return main;

    function main(options, imports, register) {
        var language = imports.language;
        
        language.registerLanguageHandler("plugins/c9.ide.language.javascript.tern/tern_worker");
        register(null, {});
    }

});
