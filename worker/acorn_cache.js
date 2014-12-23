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
        
        lastOutput = filterDefine(parse(input, options));
        lastInput = input;
        return lastOutput;
    };
    
    acornLoose.parse_dammit = function(input, options) {
        if (input === lastInputLoose)
            return lastOutputLoose;
        
        lastOutputLoose = filterDefine(parse_dammit(input, options));
        lastInputLoose = input;
        return lastOutputLoose;
    };

    function filterDefine(ast) {
        // HACK: replace 'define(function(require, exports, module)' with
        //               'define(function()' to fix exported symbols
        ast.body.forEach(function(statement) {
            // define(function(...) {})
            if (statement.type === "ExpressionStatement"
                && statement.expression.type === "CallExpression"
                && statement.expression.callee.name === "define"
                && statement.expression.arguments.length
                && statement.expression.arguments[0].type === "FunctionExpression") {
                var func = statement.expression.arguments[0];
                func.params = func.params.filter(function(p) {
                    return ["require", "exports", "module"].indexOf(p.name) === -1;
                });
            }
        });
        return ast;
    }
};

});