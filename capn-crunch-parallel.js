(function () {

    var glob = require('glob'),
        path = require('path'),
        fs = require('fs'),
        uglify = require('uglify-js'),
        cleanCss = require('clean-css'),
        less = require('less'),
        eventEmitter = require('events').EventEmitter,
        crypto = require('crypto'),
        cluster = require('cluster'),
        http = require('http'),
        cpus = require('os').cpus().length,
        staticRoot = process.argv[2],
        siteRoot = process.argv[3]; // for resolving css url()'s that start with /

    var cacheFileLimit = 200;

    if (!staticRoot) {
        console.log('Usage: node node-less-compile folder');
        process.exit(-1);
    }

    if (!siteRoot) {
        siteRoot = root;
    }

    var events = new eventEmitter();

    var rootStat = fs.statSync(staticRoot);
    if (!(rootStat && rootStat.isDirectory())) {
        console.error(root + " is not a directory");
        process.exit(-1);
    }

    var filesGlob = "**/*.{less,css,js}";
    var exclude = /(\.min\.(css|js)$)|(^_(.+?)\.less$)/;

    function processLess(file, source, done) {
        var dirname = path.dirname(file);
        var options = { paths: [dirname], compress: true };
        less.render(source, options, function (e, css) {
            if (e) {
                fileError(file, e);
            }
            css = cacheBreakCss(file, css);
            done(null, css);
        });
    }

    var cleaner = new cleanCss();

    function processCss(file, source, done) {
        var minCss = cleaner.minify(source);
        minCss = cacheBreakCss(file, minCss);
        done(null, minCss);
    }

    function getHash(file) {
        var sha = crypto.createHash('sha1');
        sha.setEncoding('hex');
        var contents = fs.readFileSync(file);
        sha.write(contents);
        sha.end();
        return sha.read();
    }

    var cacheBreakers = {},
        outputCache = {};

    function getCacheBreaker(file) {
        if (typeof cacheBreakers[file] === 'undefined') {
            cacheBreakers[file] = getHash(file);
        }

        return cacheBreakers[file];
    }

    function isSiteLocalImagePath(file) {
        if (/^\/\//.test(file)) {
            return false;
        }
        if (/^http/.test(file)) {
            return false;
        }
        if (/^data:/.test(file)) {
            return false;
        }
        return true;
    }

    function cacheBreakCss(file, css) {
        return css.replace(/url\((['"]?)(.+?)\1\)/g, function (match, quote, p1) {
            // exclude already cache broken things
            if (/\?v=/g.test(match)) {
                return match;
            }

            // anything else isn't a file ref on the web site
            if (!isSiteLocalImagePath(p1)) {
                return match;
            }
            // remove things like IEfix on fonts
            p1 = p1.replace(/\?#?iefix$|#.*$/, '');

            // Local or absolute
            var startFrom = file[0] == '/' ? siteRoot : path.dirname(file);
            var urlpath = path.normalize(path.join(startFrom, p1));
            var hash;

            try {
                hash = getCacheBreaker(urlpath);
            } catch (e) {
                fileError(file, 'error cache-breaking rule "' + match + '" in "' + file + '";' + e.toString());
            }

            var broken = 'url(' + quote + p1 + '?v=' + hash.substr(0, 12) + quote + ')';
            return broken;
        });
    }

    var compressor = uglify.Compressor({ warnings: false });

    function processJs(file, source, done) {
        var ast = uglify.parse(source);
        ast.figure_out_scope();
        ast = ast.transform(compressor);
        ast.figure_out_scope();
        ast.compute_char_frequency();
        ast.mangle_names();
        var code = ast.print_to_string();
        done(null, code);
    }

    var transformers = {
        'less': {
            name: function (name) { return name.replace(/\.less$/, '.min.css'); },
            code: processLess
        },
        'css': {
            name: function (name) { return name.replace(/\.css$/, '.min.css'); },
            code: processCss,
            // Only process if the less file is also not present
            condition: function (name) { return !fs.existsSync(name.replace(/\.css$/, '.less')); }
        },
        'js': {
            name: function (name) { return name.replace(/\.js/, '.min.js'); },
            code: processJs
        }
    };

    function fileError(filename, e) {
        if (e.constructor !== Error) {
            console.error(e);
            throw new Error('error [' + filename + ']: ' + e);
        }
        throw e;
    }

    function getExtension(filename) {
        return filename.match(/\.([^\.]+)$/)[1];
    }

    function getOutputName(filename) {
        return transformers[getExtension(filename)].name(filename);
    }

    function shouldRead(filename) {
        var check = transformers[getExtension(filename)].condition;
        return !check || check(filename);
    }

    function readFile(filename) {
        fs.readFile(filename, { encoding: 'utf-8' }, function (e, contents) {
            if (e) fileError(filename, e);
            events.emit('file-read', filename, contents.trim());
        });
    }

    function cacheCheck(filename, contents) {
        // For short files, like a beta site, check output cache first
        if (contents.length <= cacheFileLimit) {
            process.send({ msg: 'cache-check', filename: filename, contents: contents });
        } else {
            events.emit('file-ready', filename, contents);
        }
    }

    function processFile(filename, contents) {
        var transformer = transformers[getExtension(filename)].code;
        if (!transformer) throw new Error('Unknown file format: ' + filename);
        transformer(filename, contents, function (e, output) {
            if (e) {
                fileError(filename, e);
            }
            if (contents.length <= cacheFileLimit) {
                process.send({ msg: 'cache-this', filename: filename, contents: contents, output: output });
            }
            events.emit('file-processed', filename, output);
        });
    };

    function writeOutputFile(filename, output) {
        var outfilename = getOutputName(filename);
        fs.writeFile(outfilename, output, { encoding: 'utf-8' }, function (e) {
            if (e) fileError(filename, e);
            events.emit('file-saved', filename, outfilename, output);
        });
    };

    function findFiles(root) {
        glob(filesGlob, { cwd: root }, function (e, files) {
            if (e) {
                fileError(filename, e);
            }

            // Convert to abs path
            files = files.map(function (f) { return path.join(root, f); });

            // Global Exclude
            files = files.filter(function (f) { return !exclude.test(path.basename(f)); });

            // Conditial check
            files = files.filter(shouldRead);

            // sort
            var ordering = ['less', 'css', 'js'];
            files.sort(function (a, b) {
                var ax = getExtension(a);
                var bx = getExtension(b);
                return ax != bx
                  ? (ordering.indexOf(ax) - ordering.indexOf(bx))
                  : a.localeCompare(b);
            });

            events.emit('files-found', files);
        });
    };

    function processFiles(files) {
        var workerCount = Math.min(files.length, cpus - 2),
            doneCount = 0;

        var pump = function (worker) {
            if (files.length > 0) {
                var file = files.shift();
                worker.send({ compileFile: file });
            } else {
                worker.kill();
                doneCount++;
                if (doneCount == workerCount) {
                    events.emit('done');
                }
            }
        };

        function startWorker() {
            var worker = cluster.fork();
            worker.on('listening', function (address) {
                console.log('Worker ' + worker.workerID + ' Started, Listening on ' + address.address + ':' + address.port);
                pump(worker);
            }).on('message', function (msg) {
                if (msg.msg == 'cache-check') {
                    var result = outputCache[msg.contents];
                    worker.send({ cacheResult: { filename: msg.filename, contents: msg.contents, output: result } });
                }
                if (msg.msg == 'cache-this') {
                    outputCache[msg.contents] = msg.output;
                }
                if (msg.msg == 'completed') {
                    pump(worker);
                }
            });
        }

        console.log(cpus + ' processor(s) detected, utilizing ' + workerCount + ' worker threads for ' + files.length + ' file(s).');

        for (var i = 0; i < workerCount; i++) {
            startWorker();
        }
    }

    if (cluster.isMaster) {
        events.on('begin', function () { console.time('Compile'); })
            .on('begin', findFiles)
            .on('files-found', function (files) {
                console.log('Found ' + files.length + ' files to process');
                processFiles(files);
            })
            .on('done', function () { console.timeEnd('Compile'); })
            .emit('begin', staticRoot);
    }
    else if (cluster.isWorker) {
        events.on('file-found', function (filename) {
            console.time('compiled [' + getExtension(filename) + ']: ' + getOutputName(filename));
            readFile(filename);
        })
            .on('file-read', cacheCheck)
            .on('file-ready', processFile)
            .on('file-processed', writeOutputFile)
            .on('file-saved', function (oldname, newname, output) {
                console.timeEnd('compiled [' + getExtension(oldname) + ']: ' + newname);
                process.send({ msg: 'completed', file: {}, result: output });
            });

        http.createServer(function (req, res) {
            res.writeHead(200);
            res.end("worker thread ahoy!\n");
        }).listen(8000);

        process.on('message', function (msg) {
            if (msg.compileFile) {
                events.emit('file-found', msg.compileFile);
            }
            if (msg.cacheResult) {
                var result = msg.cacheResult;
                if (result.output) {
                    writeOutputFile(result.filename, result.output);
                } else {
                    events.emit('file-ready', result.filename, result.contents);
                }
            }
        });
    }

    function handleError(e) {
        if (e.stack) {
            console.error(e.stack);
        } else {
            console.error(e);
        }
        process.exit(-1);
    }

    process.on('uncaughtException', handleError)
           .on('error', handleError);
})();
