
define(function(require, exports, module) {

var plugin = require("./architect_resolver_plugin");
var worker = require("plugins/c9.ide.language/worker");

var ready;

worker.sender.emit("architectPlugins");
worker.sender.on("architectPluginsResult", function(e) {
    plugin.setArchitectPlugins(e.data);
    ready = true;
});

module.exports.onReady = function(callback) {
    if (ready)
        return callback();
    
    worker.sender.once("architectPluginsResult", function() {
        setTimeout(callback);
    });
};

});