var child = require('child_process')
  , cwd = process.cwd();

/**
 * Make curl opts friendlier.
 */

var curl_map = {
    retries: 'retry'
  , timeout: 'max-time'
  , redirects: 'max-redirs'
};

/**
 * Make a request with cURL.
 *
 * @param {Object|String} options (optional) - sent as --<key> <value> to curl
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

    var curl
      , args = ['--silent', '--show-error', '--no-buffer']
      , start = new Date
      , stderr = ''
      , stdoutlen
      , stdout = new Buffer(stdoutlen = 0)
      , encoding
      , complete
      , cleanup
      , chunk
      , timeout;

    //Follow location by default
    if (!options['max-redirs']) {
        options.location = true;
        options['max-redirs'] = 3;
    }

    //Add an additional setTimeout for max-time
    if (options['max-time']) {
        timeout = setTimeout(function () {
            if (complete) return;
            callback('timeout', null, {
                cmd: 'curl ' + args.join(' ')
              , time: (new Date().getTime() - start.getTime())
            });
            complete = true;
            if (curl && curl.kill) curl.kill('SIGKILL');
        }, 1000 * options['max-time']);
    }

    //If no encoding is specified just return a buffer
    if (options.encoding) {
        encoding = options.encoding;
        if (encoding === 'ascii') {
            options['use-ascii'] = true;
        }
        delete options.encoding;
    }

    //Call the callback each time we receive a chunk?
    if (options.chunk) {
        chunk = true;
        delete options.chunk;
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
        if (chunk) {
            return callback(null, encoding ? data.toString(encoding) : data);
        }
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

    //Handle exit
    curl.on('exit', function () {
        if (complete) return;
        complete = true;
        stderr = stderr.length ? stderr.trim().split('\n',1)[0] : null;
        var debug = {
            cmd: 'curl ' + args.join(' ')
          , time: (new Date().getTime() - start.getTime())
        }
        if (chunk) {
            callback(stderr, null, debug);
        } else {
            callback(stderr, encoding ? stdout.toString(encoding) : stdout, debug);
        }
        if (timeout) clearTimeout(timeout);
    });
};

