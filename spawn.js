var child = require('child_process');

/**
 * Limit the amount of processes that can be spawned per tick.
 */

var spawned = 0
  , max_per_tick = 10
  , resetting = false;

/**
 * See `child_process.spawn()`.
 */

module.exports = function (cmd, args, options, callback) {
    var args = Array.prototype.slice.call(arguments);
    if (spawned < max_per_tick) {
        spawned++;
        callback(child.spawn.apply(child, args.slice(0, -1)));
    } else {
        if (!resetting) {
            resetting = true;
            process.nextTick(function () {
                spawned = 0;
                resetting = false;
            });
        }
        process.nextTick(function () {
            module.exports.apply(null, args);
        });
    }
};

