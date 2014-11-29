define(function(require, exports, module) {
    
// TODO: we already have a version of acorn and probably shouldn't include it twice
require("acorn/acorn");
require("acorn/acorn_loose");
require("acorn/util/walk");

// TODO: move deps to node_modules? (lib/...)

require("./lib/tern/lib/signal");
require("./lib/tern/lib/tern");
require("./lib/tern/lib/def");
require("./lib/tern/lib/infer");
require("./lib/tern/lib/comment");
require("./lib/tern/plugin/angular");
require("./lib/tern/plugin/component");
require("./lib/tern/plugin/doc_comment");
require("./lib/tern/plugin/node");
require("./lib/tern/plugin/requirejs");


var baseLanguageHandler = require('plugins/c9.ide.language/base_handler');

var worker = module.exports = Object.create(baseLanguageHandler);
    
worker.handlesLanguage = function(language) {
    return language === "javascript";
};


});
