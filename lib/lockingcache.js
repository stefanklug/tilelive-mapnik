module.exports = LockingCache;
function LockingCache(generate, timeout) {
    this.callbacks = {};
    this.timeouts = {};
    this.results = {};

    // When there's no generator function, you
    this.generate = generate || function() {};

    // Timeout cached objects after 1 minute by default.
    // A value of 0 will cause it to not cache at all beyond, just return the result to
    // all locked requests.
    this.timeout = (typeof timeout === "undefined") ? 60000 : timeout;
}

LockingCache.prototype.get = function(id, callback) {
    if (!this.callbacks[id]) this.callbacks[id] = [];
    this.callbacks[id].push(callback);
    var cb_id = {id:id, index:(this.callbacks[id].length -1)};

    if (this.results[id]) {
        this.trigger(id);
    } else {
        var ids = this.generate.call(this, id);
        if (!ids || ids.indexOf(id) < 0) {
            this.put(id, new Error("Generator didn't generate this item"));
        } else ids.forEach(function(id) {
            this.results[id] = this.results[id] || true;
        }, this);
    }
    
    return cb_id;
};

LockingCache.prototype.removeCallback = function(cb_id) {
	this.callbacks[cb_id.id][cb_id.index] = null;
	if(!this.hasCallbacks(cb_id.id)) {
		this.del(cb_id.id);
	}
};

LockingCache.prototype.hasCallbacks = function(id) {
	var callbacks = this.callbacks[id];
	for(var i=0; i<callbacks.length; i++) {
		if(callbacks[i] !== null) {
			return true;
		}
	}
	return false;
};

LockingCache.prototype.del = function(id) {
    delete this.results[id];
    delete this.callbacks[id];
    if (this.timeouts[id]) {
        clearTimeout(this.timeouts[id]);
        delete this.timeouts[id];
    }
};

LockingCache.prototype.put = function(id) {
    if (this.timeout > 0) {
        this.timeouts[id] = setTimeout(this.del.bind(this, id), this.timeout);
    }
    this.results[id] = Array.prototype.slice.call(arguments, 1);
    if (this.callbacks[id] && this.callbacks[id].length) {
        this.trigger(id);
    }
};

LockingCache.prototype.clear = function() {
    for (var id in this.timeouts) {
        this.del(id);
    }
};

LockingCache.prototype.trigger = function(id) {
    if (this.results[id] && this.results[id] !== true) {
        process.nextTick(function() {
            var data = this.results[id];
            var callbacks = this.callbacks[id] || [];

            if (this.timeout === 0) {
                // instant purge with the first put() for a key
                // clears timeouts and results
                this.del(id);
            } else {
                delete this.callbacks[id];
            }

            callbacks.forEach(function(callback) {
            	if(callback) {
            		callback.apply(callback, data);
            	}
            });
        }.bind(this));
    }
};
