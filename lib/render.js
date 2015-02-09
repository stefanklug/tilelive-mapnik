var mapnik = require('mapnik');
var Step = require('step');
var mime = require('mime')

var MapnikSource = require('./mapnik_backend');

var EARTH_RADIUS = 6378137;
var EARTH_DIAMETER = EARTH_RADIUS * 2;
var EARTH_CIRCUMFERENCE = EARTH_DIAMETER * Math.PI;
var MAX_RES = EARTH_CIRCUMFERENCE / 256;
var ORIGIN_SHIFT = EARTH_CIRCUMFERENCE/2;


exports['calculateMetatile'] = calculateMetatile;
function calculateMetatile(options) {
    var z = +options.z, x = +options.x, y = +options.y;
    var total = 1 << z;
    var resolution = MAX_RES / total;

    // Make sure we start at a metatile boundary.
    x -= x % options.metatile;
    y -= y % options.metatile;

    // Make sure we don't calculcate a metatile that is larger than the bounds.
    var metaWidth  = Math.min(options.metatile, total, total - x);
    var metaHeight = Math.min(options.metatile, total, total - y);

    // Generate all tile coordinates that are within the metatile.
    var tiles = [];
    for (var dx = 0; dx < metaWidth; dx++) {
        for (var dy = 0; dy < metaHeight; dy++) {
            tiles.push([ z, x + dx, y + dy ]);
        }
    }

    var minx = (x * 256) * resolution - ORIGIN_SHIFT;
    var miny = -((y + metaHeight) * 256) * resolution + ORIGIN_SHIFT;
    var maxx = ((x + metaWidth) * 256) * resolution - ORIGIN_SHIFT;
    var maxy = -((y * 256) * resolution - ORIGIN_SHIFT);
    return {
        width: metaWidth * options.tileSize,
        height: metaHeight * options.tileSize,
        x: x, y: y,
        tiles: tiles,
        bbox: [ minx, miny, maxx, maxy ]
    };
}

function calculateMetatileWithBounds(options) {
	var z = +options.z, x = +options.x, y = +options.y;
	//the number of tiles on one axis given the depth
    var total = 1 << z;

	//the highest resolution (e.g. meters per pixel on zoom level 0)
    if(!options.maxScale) {
    	throw new Error("maxScale not defined");
    }
    
	//meters per pixel to draw for this scale
    var resolution = options.maxScale / total;

    // Make sure we start at a metatile boundary.
    x -= x % options.metatile;
    y -= y % options.metatile;

    // Make sure we don't calculcate a metatile that is larger than the bounds.
    var metaWidth  = Math.min(options.metatile, total, total - x);
    var metaHeight = Math.min(options.metatile, total, total - y);

    // Generate all tile coordinates that are within the metatile.
    var tiles = [];
    for (var dx = 0; dx < metaWidth; dx++) {
        for (var dy = 0; dy < metaHeight; dy++) {
            tiles.push([ z, x + dx, y + dy ]);
        }
    }

	//calculate geo coordinates based on the bounds
	/* the bounds are [west, south, east, north]
	 but we don't know the direction of the axis yet */
	var b = options.bounds;

	// positive direction means increasing to the right (east) and to bottom (south)
	var xdir = (b[0] < b[2]) ? 1 : -1;
	var ydir = (b[1] > b[3]) ? 1 : -1;
	
	
	var meterPerTile = 256 * resolution;
	var west, north, east, south;
	
	if(options.origin && options.origin[0] == 's') {
		south = b[1] - (y * meterPerTile * ydir);
		north = south - (metaHeight * meterPerTile * ydir);
	} else {
		//the grid defaults to north west origin
		north = (y * meterPerTile * ydir) + b[3];
	    south = north + (metaHeight * meterPerTile * ydir);
	}
    
	if(options.origin && options.origin[1] == 'e') {
		east = b[2] - (x * meterPerTile * xdir);
		west = east - (metaHeight * meterPerTile * xdir);
	} else {
		//the grid defaults to north west origin
		west = (x * meterPerTile * xdir) + b[0];
		east = west + (metaWidth * meterPerTile * xdir);
	}
	
	var res = {
	        width: metaWidth * options.tileSize,
	        height: metaHeight * options.tileSize,
	        x: x, y: y,
	        tiles: tiles,
	        bbox: [ Math.min(west, east), 
	                Math.min(north, south),
	                Math.max(west, east),
	                Math.max(north, south) ]
	    };
	
	//check that the bounds are within the map bounds
	var mapWidth = Math.abs(b[0]-b[2]);
	var mapHeight = Math.abs(b[1]-b[3]);
	var metatileWidth = Math.abs(east-west);
	var metatileHeight = Math.abs(north-south);
	
	//compare the centers
	if( Math.abs((east + west)/2 - (b[0]+b[2])/2) > mapWidth/2 + metatileWidth/2 ||
		Math.abs((north + south)/2 - (b[1]+b[3])/2)	> mapHeight/2 + metatileHeight/2 ) {
		res.error = new Error("tile outside of map");
	}
    
    return res;
}
	

exports['sliceMetatile'] = sliceMetatile;
function sliceMetatile(source, image, options, meta, callback) {
    var tiles = {};

    Step(function() {
        var group = this.group();
        meta.tiles.forEach(function(c) {
            var next = group();
            var key = [options.format, c[0], c[1], c[2]].join(',');
            //default grid origin is nw (top left)
            var x = (c[1] - meta.x) * options.tileSize;
            var y = (c[2] - meta.y) * options.tileSize;
            //handle different grid origins
            if(options.origin && options.origin[0] == 's') {
            	//meta.height - options.tileSize is the top pixel of the first tile when measureing from bottom
            	y = meta.height - options.tileSize - y;
            }
            
            if(options.origin && options.origin[1] == 'e') {
            	x = meta.width - options.tileSize - x;
            }
            
            getImage(source, image, options, x, y, function(err, image) {
                tiles[key] = {
                    image: image,
                    headers: options.headers
                };
                next();
            });
        });
    }, function(err) {
        if (err) return callback(err);
        callback(null, tiles);
    });
}

exports['encodeSingleTile'] = encodeSingleTile;
function encodeSingleTile(source, image, options, meta, callback) {
    var tiles = {};
    var key = [options.format, options.z, options.x, options.y].join(',');
    getImage(source, image, options, 0, 0, function(err, image) {
        if (err) return callback(err);
        tiles[key] = { image: image, headers: options.headers };
        callback(null, tiles);
    });
}

function getImage(source, image, options, x, y, callback) {
    var view = image.view(x, y, options.tileSize, options.tileSize);
    view.isSolid(function(err, solid, pixel) {
        if (err) return callback(err);
        var pixel_key = '';
        if (solid) {
            if (options.format === 'utf') {
                // TODO https://github.com/mapbox/tilelive-mapnik/issues/56
                pixel_key = pixel.toString();
            } else {
                // https://developer.mozilla.org/en-US/docs/JavaScript/Reference/Operators/Bitwise_Operators
                var a = (pixel>>>24) & 0xff;
                var r = pixel & 0xff;
                var g = (pixel>>>8) & 0xff;
                var b = (pixel>>>16) & 0xff;
                pixel_key = options.format + r +','+ g + ',' + b + ',' + a;
            }
        }
        // Add stats.
        options.source._stats.total++;
        if (solid !== false) options.source._stats.solid++;
        if (solid !== false && image.painted()) options.source._stats.solidPainted++;
        // If solid and image buffer is cached skip image encoding.
        if (solid && source.solidCache[pixel_key]) return callback(null, source.solidCache[pixel_key]);
        // Note: the second parameter is needed for grid encoding.
        options.source._stats.encoded++;
        try {
            view.encode(options.format, options, function(err, buffer) {
                if (err) {
                    return callback(err);
                }
                if (solid !== false) {
                    // @TODO for 'utf' this attaches an extra, bogus 'solid' key to
                    // to the grid as it is not a buffer but an actual JS object.
                    // Fix is to propagate a third parameter through callbacks all
                    // the way back to tilelive source #getGrid.
                    buffer.solid = pixel_key;
                    source.solidCache[pixel_key] = buffer;
                }
                return callback(null, buffer);
            });
        } catch (err) {
            return callback(err);
        }
    });
}

// Render png/jpg/tif image or a utf grid and return an encoded buffer
MapnikSource.prototype._renderMetatile = function(options, callback, checkIfStillNeeded) {
    var source = this;
	var meta;
	
    // Calculate bbox from xyz, respecting metatile settings.
    if(source._uri.query.bounds) {
    	options.bounds = _.map(source._uri.query.bounds.split(','), parseFloat);
    	options.maxScale = source._uri.query.maxScale;
    	options.origin = source._uri.query.origin;
		meta = calculateMetatileWithBounds(options);
	} else {
		meta = calculateMetatile(options);
	}
    
    
    
    console.log(meta);

    // Set default options.
    if (options.format === 'utf') {
        options.layer = source._info.interactivity_layer;
        options.fields = source._info.interactivity_fields;
        options.resolution = source._uri.query.resolution;
        options.headers = { 'Content-Type': 'application/json' };
        var image = new mapnik.Grid(meta.width, meta.height);
    } else {
        // NOTE: formats use mapnik syntax like `png8:m=h` or `jpeg80`
        // so we need custom handling for png/jpeg
        if (options.format.indexOf('png') != -1) {
            options.headers = { 'Content-Type': 'image/png' };
        } else if (options.format.indexOf('jpeg') != -1 ||
                   options.format.indexOf('jpg') != -1) {
            options.headers = { 'Content-Type': 'image/jpeg' };
        } else {
            // will default to 'application/octet-stream' if unable to detect
            options.headers = { 'Content-Type': mime.lookup(options.format.split(':')[0]) };
        }
        var image = new mapnik.Image(meta.width, meta.height);
    }

    options.scale = +source._uri.query.scale;

    // Add reference to the source allowing debug/stat reporting to be compiled.
    options.source = source;

    process.nextTick(function() {
    	//early out if the meta generation resulted in an error
    	if(meta.error) return callback(meta.error);
    	
        // acquire can throw if pool is draining
        try {
            source._pool.acquire(function(err, map) {
            	if(checkIfStillNeeded && checkIfStillNeeded() == false) {
            		return callback("Tile is not needed anymore");
            	}
            	
                if (err) {
                    return callback(err);
                }
                // Begin at metatile boundary.
                options.x = meta.x;
                options.y = meta.y;
                options.variables = { zoom: options.z };
                map.resize(meta.width, meta.height);
                map.extent = meta.bbox;
				map.bufferSize = options.tileSize;

				var renderOptions = {scale: options.scale};
		        if(source._uri.query.lockToScale) {
		        	renderOptions.scale = source._uri.query.lockToScale / map.scale();
				}

                try {
                    source._stats.render++;
                    map.render(image, renderOptions, function(err, image) {
                        process.nextTick(function() {
                            // Release after the .render() callback returned
                            // to avoid mapnik errors.
                            source._pool.release(map);
                        });
                        if (err) return callback(err);
                        if (meta.tiles.length > 1) {
                            sliceMetatile(source, image, options, meta, callback);
                        } else {
                            encodeSingleTile(source, image, options, meta, callback);
                        }
                    });
                } catch(err) {
                    process.nextTick(function() {
                        // Release after the .render() callback returned
                        // to avoid mapnik errors.
                        source._pool.release(map);
                    });
                    return callback(err);
                }
            });
        } catch (err) {
            return callback(err);
        }
    });

    // Return a list of all the tile coordinates that are being rendered
    // as part of this metatile.
    return meta.tiles.map(function(tile) {
        return options.format + ',' + tile.join(',');
    });
};
