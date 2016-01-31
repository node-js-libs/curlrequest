var util = require('util')
  , fs = require('fs')
  , spawn = require('./spawn')
  , errors = require('./errors')
  , cwd = process.cwd();

/**
 * Make some curl opts friendlier.
 */

var curl_map = {
    timeout: 'max-time'
  , redirects: 'max-redirs'
  , method: 'request'
  , useragent: 'user-agent'
};

/**
 * Default user-agents.
 */

var user_agents = require('./useragents.js')
  , user_agents_len = user_agents.length;

/**
 * Default request headers.
 */

var default_headers = {
    'Accept': '*/*'
  , 'Accept-Charset': 'ISO-8859-1,utf-8;q=0.7,*;q=0.3'
  , 'Accept-Language': 'en-US,en;q=0.8'
};

/**
 * Make a request with cURL.
 *
 * @param {Object|String} options (optional) - see `man curl`
 * @param {Function} callback (optional)
 * @api public
 */

exports.request = function (options, callback) {
    if (arguments.length === 1) {
        var defaults = options;
        return function (options, callback) {
            if (typeof options === 'function') {
                callback = options;
                options = {};
            } else if (typeof options === 'string') {
                options = { url: options };
            }
            for (var key in defaults) {
                if (typeof options[key] === 'undefined') {
                    options[key] = defaults[key];
                }
            }
            exports.request.call(this, options, callback);
        };
    }

    if (options.retries) {
        var remaining = options.retries;
        delete options.retries;
        return (function curl() {
            exports.request(options, function (err) {
                if (!err || !--remaining) {
                    return callback.apply(this, arguments);
                }
                process.nextTick(curl);
            });
        })();
    }

    if (typeof options === 'string') {
        options = { url: options };
    } else {
        options = exports.copy(options);
    }

    for (var key in curl_map) {
        if (typeof options[key] !== 'undefined') {
            options[curl_map[key]] = options[key];
            delete options[key];
        }
    }

    var curl
      , curl_path = 'curl'
      , args = ['--silent', '--show-error', '--no-buffer']
      , start = new Date
      , err
      , stderr = ''
      , stdoutlen
      , stdout = new Buffer(stdoutlen = 0)
      , encoding
      , complete
      , cleanup
      , postprocess
      , require_str
      , require_not_str
      , scope = {}
      , cmd = 'curl'
      , timeout;

    function finish() {
        if (options.fail && stderr) {
            err = String(stderr).replace(/^curl: \(\d+\) /, ''); // "curl: (22) The requested URL returned error..." => "The requested URL returned error..."
        } else if (err in errors) {
            err = errors[err];
        }
        callback.call(scope, err, stdout, {
            cmd: cmd
          , args: args
          , time: (new Date().getTime() - start.getTime())
        });
        complete = true;
    }

    //Allow for a custom curl path
    if (options.curl_path) {
        curl_path = options.curl_path;
        delete options.curl_path;
    }

    //Follow location by default
    if ('max-redirs' in options) {
        options.location = !!options['max-redirs'];
    } else {
        options.location = true;
        options['max-redirs'] = 3;
    }

    //Add an additional setTimeout for max-time
    if (options['max-time']) {
        timeout = setTimeout(function () {
            if (complete) return;
            stderr = 'timeout', stdout = null;
            finish();
            if (curl && curl.kill) curl.kill('SIGKILL');
        }, 1000 * options['max-time']);
    }

    //Default encoding is utf8. Set encoding = null to get a buffer
    if (!options.encoding && options.encoding !== null) {
        options.encoding = 'utf8';
    }
    encoding = options.encoding;
    if (encoding === 'ascii') {
        options['use-ascii'] = true;
    }
    delete options.encoding;

    //Parse POST data
    if (options.data && typeof options.data === 'object') {
        var data = [];
        for (var key in options.data) {
            data.push(encodeURIComponent(key) + '=' + encodeURIComponent(options.data[key]));
        }
        options.data = data.join('&');
    }

    //Check for the occurrence of a string and fail if not found
    if (options.require) {
        require_str = options.require;
        if (!Array.isArray(require_str)) {
            require_str = [require_str];
        }
        delete options.require;
    }

    //Check for the occurrence of a string and fail if found
    if (options.require_not) {
        require_not_str = options.require_not;
        if (!Array.isArray(require_not_str)) {
            require_not_str = [require_not_str];
        }
        delete options.require_not;
    }

    //Call the callback in a custom scope
    if (options.scope) {
        scope = options.scope;
        delete options.scope;
    }

    //Apply a post-processing function?
    if (options.process) {
        postprocess = options.process;
        delete options.process;
    }

    //Setup default headers
    var key, headers = {};
    for (key in default_headers) {
        headers[key] = default_headers[key];
    }
    if (options.headers) {
        var normalised_key;
        for (key in options.headers) {
            normalised_key = key.replace(/[_-]/g, ' ').split(' ').map(function (str) {
                if (str.length) {
                    str = str[0].toUpperCase() + str.substr(1);
                }
                return str;
            }).join('-');
            headers[normalised_key] = options.headers[key];
        }
        delete options.headers;
    }
    options.header = options.header || [];
    for (key in headers) {
        options.header.push(key + ': ' + headers[key]);
    }

    //Select a random user agent if one wasn't provided
    if (!headers['User-Agent'] && !options['user-agent']) {
        options['user-agent'] = user_agents[Math.random() * user_agents_len | 0];
    }

    //Prepare curl args
    var key, values;
    for (key in options) {
        if (key === 'pretend') {
            continue;
        }
        values = Array.isArray(options[key]) ? options[key] : [options[key]];
        values.forEach(function (value) {
            args.push('--' + key);
            if (true !== value) {
                args.push(value);
            }
        });
    }

    if (options.file) {
        cmd = 'cat';
        args = [options.file];
    }

    //Simulate the spawn?
    if (options.pretend) {
        return finish();
    }

    //Spawn the process
    var child = spawn(cmd, args, { cwd: options.cwd || cwd }, function (curl) {

        //Collect stdout
        curl.stdout.on('data', function (data) {
            if (complete) return;
            var len = data.length, prev = stdout;
            stdout = new Buffer(len + stdoutlen);
            prev.copy(stdout, 0, 0, stdoutlen);
            data.copy(stdout, stdoutlen, 0, len);
            stdoutlen += len;
        });

        //Pipe stderr to the current process?
        if (options.stderr) {
            if (options.stderr === true) {
                curl.stderr.pipe(process.stderr);
                delete options.stderr
            }
        }

        curl.stderr.on('data', function (data) {
          if (complete) return;
          stderr += data;
        });

        //Handle curl exit
        curl.on('close', function (code) {
            try {
                err = code;
                if (complete) return;
                if (encoding) {
                    stdout = stdout.toString(encoding);
                }
                if (postprocess && stdout) {
                    stdout = postprocess(stdout);
                }
                if (require_str) {
                    var valid = false;
                    if (!encoding) {
                        stdout = stdout.toString();
                    }
                    var str;
                    for (var i = 0, l = require_str.length; i < l; i++) {
                        str = require_str[i];
                        if ((util.isRegExp(str) && str.test(stdout)) || stdout.indexOf(str) !== -1) {
                            valid = true;
                            break;
                        }
                    }
                    if (!valid) {
                        err = 'response does not contain required string: ' + str;
                        stdout = null
                    } else if (!encoding) {
                        stdout = new Buffer(stdout);
                    }
                }
                if (require_not_str) {
                    var valid = true;
                    if (!encoding) {
                        stdout = stdout.toString();
                    }
                    var str;
                    for (var i = 0, l = require_not_str.length; i < l; i++) {
                        str = require_not_str[i];
                        if ((util.isRegExp(str) && str.test(stdout)) || stdout.indexOf(str) !== -1) {
                            valid = false;
                            break;
                        }
                    }
                    if (!valid) {
                        err = 'response contains bad string: ' + str;
                        stdout = null
                    } else if (!encoding) {
                        stdout = new Buffer(stdout);
                    }
                }
            } catch (e) {
                err = typeof e === 'object' ? e.message || '' : e;
            }
            finish();
            if (timeout) clearTimeout(timeout);
        });
    });
};

/**
 * Expose a helper for scraping urls from a page.
 */

var urls = /(?:href|src|HREF|SRC)=["']?([^"' >]+)/g;

exports.urls = function (data, regex) {
    var match, matches = [];
    while (match = urls.exec(data)) {
        if (regex && !regex.test(match[1])) {
            continue;
        }
        matches.push(match[1].replace(/[\r\n\t\s]/g, ''));
    }
    return matches;
};

/**
 * A helper for handling async concurrency.
 */

exports.concurrent = function (input, concurrency, fn) {
    if (arguments.length === 3) {
        var len = input.length, pos = 0, remaining = concurrency;
        for (var i = 0; i < concurrency; i++) {
            (function exec() {
                if (pos >= len) {
                    if (!--remaining) {
                        fn(null, function () {});
                    }
                } else {
                    fn(input[pos++], function () {
                        process.nextTick(exec);
                    });
                }
            })();
        }
    } else {
        fn = concurrency;
        concurrency = input;
        for (var i = 0; i < concurrency; i++) {
            (function exec() {
                fn(function () {
                    process.nextTick(exec);
                });
            })();
        }
    }
};

/**
 * A helper for copying an object.
 */

exports.copy = function (obj) {
    var copy = {};
    for (var i in obj) {
        if (Array.isArray(obj[i])) {
            copy[i] = obj[i].map(function (item) {
                return item;
            });
        } else if (typeof obj[i] === 'object') {
            copy[i] = obj[i] ? exports.copy(obj[i]) : null;
        } else {
            copy[i] = obj[i];
        }
    }
    return copy;
};

