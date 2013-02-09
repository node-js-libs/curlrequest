#!/usr/bin/env node

// create a local REPL to speed up development on curl

var curl = require('./index')
  , repl = require("repl")
  ;

//A "local" node repl with a custom prompt
var local = repl.start("curl> ");

// Exposing the function "mood" to the local REPL's context.
local.context.curl = curl;

var d = curl.statement({ 'url' : 'http://johnweis.com', 'method' : 'POST', 'data' : { 'foo' : 'bar', '2' : '3' } });

local.context.d = d;

console.log(d);