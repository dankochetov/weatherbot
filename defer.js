// Node.js promise libraries like node-promise or deferred for some reason did not work for me, so I've written my own simplified one

var defer = function() {
	this.isResolved = false;
	this.callbacks = [];
	return {
		then: function(callback) {
			if (this.isResolved)
				callback(this.value);
			else
				this.callbacks.push(callback);
		}.bind(this),

		resolve: function(val) {
			this.value = val;
			this.isResolved = true;
			for (var i in this.callbacks)
				this.callbacks[i](this.value);
		}.bind(this)
	};
};

module.exports = defer;