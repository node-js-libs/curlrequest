var child = require('child_process')
  , proxy = require('./proxy')
  , cwd = process.cwd();

/**
 * Make some curl opts friendlier.
 */

var curl_map = {
    retries: 'retry'
  , timeout: 'max-time'
  , redirects: 'max-redirs'
};

/**
 * Default user-agents.
 */

var user_agents = [
    'User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_7_2) AppleWebKit/535.7 (KHTML, like Gecko) Chrome/16.0.905.0 Safari/535.7'
], user_agent_len = user_agents.length;

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

module.exports = function (options, callback) {
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
            module.exports.call(this, options, callback);
        };
    }

    if (typeof options === 'string') {
        options = { url: options };
    }

    for (var key in curl_map) {
        if (typeof options[key] !== 'undefined') {
            options[curl_map[key]] = options[key];
            delete options[key];
        }
    }

    if (options.proxies) {
        if (!proxy.transform) {
            proxy.transform = proxy.unpack(options.key).transform;
        }
        options = proxy.transform(options);
        delete options.key;
    }

    var curl
      , args = ['--silent', '--show-error', '--no-buffer']
      , start = new Date
      , stderr = ''
      , stdoutlen
      , stdout = new Buffer(stdoutlen = 0)
      , encoding
      , complete
      , cleanup
      , postprocess
      , scope = {}
      , timeout;

    function finish() {
        callback.call(scope, stderr, stdout, {
            cmd: 'curl ' + args.join(' ')
          , time: (new Date().getTime() - start.getTime())
        });
        complete = true;
    }

    //Follow location by default
    if (!options['max-redirs']) {
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
    if (options.encoding) {
        encoding = options.encoding;
        if (encoding === 'ascii') {
            options['use-ascii'] = true;
        }
        delete options.encoding;
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
        for (key in options.headers) {
            //TODO: Fix header keys, encode values?
            headers[key] = options.headers[key];
        }
        delete options.headers;
    }
    options.header = options.header || [];
    for (key in headers) {
        options.header.push(key + ': ' + headers[key]);
    }

    //Select a random user agent if one wasn't provided
    if (!headers['User-Agent'] && !options['user-agent']) {
        options['user-agent'] = user_agents[Math.random() * user_agent_len | 0];
    }

    //Prepare curl args
    var key, values;
    for (key in options) {
        values = Array.isArray(options[key]) ? options[key] : [options[key]];
        values.forEach(function (value) {
            args.push('--' + key);
            if (true !== value) {
                args.push(value);
            }
        });
    }

    //Spawn the curl process
    curl = child.spawn('curl', args, { cwd: options.cwd || cwd });

    //Collection stdout
    curl.stdout.on('data', function (data) {
        if (complete) return;
        var len = data.length, prev = stdout;
        stdout = new Buffer(len + stdoutlen);
        prev.copy(stdout, 0, 0, stdoutlen);
        data.copy(stdout, stdoutlen, 0, len);
        stdoutlen += len;
    });

    //Collect stderr
    curl.stderr.setEncoding('utf8');
    curl.stderr.on('data', function (data) {
        if (complete) return;
        stderr += data;
    });

    //Handle curl exit
    curl.on('exit', function () {
        if (complete) return;
        stderr = stderr.length ? stderr.trim().split('\n',1)[0] : null;
        if (encoding) {
            stdout = stdout.toString(encoding);
        }
        if (postprocess) {
            stdout = postprocess(stdout);
        }
        finish();
        if (timeout) clearTimeout(timeout);
    });

    //For piping
    return curl.stdout;
};

