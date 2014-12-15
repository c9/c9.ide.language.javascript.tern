define(function(require, exports, module) {

var acorn = require("acorn/acorn");
var acornLoose = require("acorn/acorn_loose");

module.exports.init = function() {
    var parse = acorn.parse;
    var parse_dammit = acornLoose.parse_dammit;
    
    var lastInput;
    var lastOutput;
    var lastInputLoose;
    var lastOutputLoose;
    
    acorn.parse = function(input, options) {
        if (input === lastInput)
            return lastOutput;
        if (input === lastInputLoose)
            return lastOutputLoose;
        
        lastOutput = parse(input, options);
        lastInput = input;
        return lastOutput;
    };
    
    acornLoose.parse_dammit = function(input, options) {
        if (input === lastInputLoose)
            return lastOutputLoose;
        
        lastOutputLoose = parse_dammit(input, options);
        lastInputLoose = input;
        return lastOutputLoose;
    };
};

});