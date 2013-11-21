var glob = require('glob'),
    path = require('path'),
    fs = require('fs'),
    uglify = require('uglify-js'),
    CleanCSS = require('clean-css'),
    less = require('less'),
    EventEmitter = require('events').EventEmitter,
    root = process.argv[2];

if (!root) {
  console.log('Usage: node capn-crunch folder');
  process.exit(-1);
}

var rootStat = fs.statSync(root);
if (!(rootStat && rootStat.isDirectory())) {
  console.log(root + " is not a directory");
  process.exit(-1);
}

var compileFromExts = ['less'];
var compileToExts = ['css'];
var minifyExts = ['js', 'css'];

var minifyOred = minifyExts.join('|')
var minSourceExp = new RegExp('\\.(' + minifyOred + ')$');
var minnedExp = new RegExp('\\.min\\.(' + minifyOred + ')$');
var minifyGlob = "**/*.{" + minifyExts.join(',') + "}";
var getMinName = function(fname) { return fname.replace(minSourceExp, '.min.$1'); };
var isNotMinnedFile = function (fname) { return !minnedExp.test(fname); };
var relPath = function(fname) { return fname.replace(root.replace(/\\/g, '/'), ''); };
var getExt = function(fname) { return /\.([^\.]+)$/.exec(fname)[1]; };
var fullPath = function(fname) { return path.join(root, fname); }

var events = new EventEmitter();

var compilers = {
  'less' : function(fname, cb) {
    fs.readFile(fname, {encoding: 'utf-8'}, function(e, source) {
      if (e) throw e;
      less.render(source, function(e,css) { if (e) throw e;
        cb(css);
      });
    });
  }
};

var cleaner = new CleanCSS();
var minifiers = {
  'js'   : function(fname) { return uglify.minify(fname).code; },
  'css'  : function(fname) { return cleaner.minify(fs.readFileSync(fname, {encoding: 'utf-8'})); }
};

var needsAction = function(source, out) {
  try { return fs.statSync(source).mtime > fs.statSync(out).mtime; }
  catch (e) { return true; }
};

var needsMin = function(fname) {
  return needsAction(fname, getMinName(fname));
};

var minify = function(fname) {
  try {
    fs.writeFile(getMinName(fname), minifiers[getExt(fname)](fname), {encoding:'utf-8'}, function(err) {
      if (err) throw err;
      events.emit('minified', fname);
    });
  } catch (e) {
    console.log("Error minifying " + fname + ": " + e);
  }
};

var getCompiledName = function(fname) {
  var ext = getExt(fname);
  return fname.replace(new RegExp('\\.' + ext + '$'), '.' + compileToExts[compileFromExts.indexOf(ext)]);
};

var needsCompile = function(fname) {
  return needsAction(fname, getCompiledName(fname));
};

var compile = function(fname) {
  var compiler = compilers[getExt(fname)];
  compiler(fname, function(output) {
    fs.writeFile(getCompiledName(fname), output, {encoding:'utf-8'}, function(e) {
      events.emit('compiled', fname);
    });
  });
};

var compileGlob = "**/*." + (compileFromExts.length < 2 ? compileFromExts[0] : ('{' + compileFromExts.join(',') + '}'));
var compileAll = function() {
  glob(compileGlob, {cwd: root}, function(err, files) {
    if (err) throw err;
    files = files.map(fullPath);
    files = files.filter(needsCompile);
    if (files.length === 0) {
      events.emit('compile-done');
      return;
    }

    var compiled = 0;

    var done = function(fname) {
      if (++compiled === files.length) {
        events.emit('compile-done');
      }
    };

    events.on('compiled', done);
    files.forEach(function(fname) { compile(fname, done); });
  });
}

var minifyAll = function() {
  glob(minifyGlob, {cwd: root}, function(err, files) {
    if (err) throw err;
    files = files.map(fullPath);
    files = files.filter(isNotMinnedFile); // Js no likey negative look-behind
    files = files.filter(needsMin);

    if(files.length === 0) {
      events.emit('minify-done');
      return;
    }

    var minified = 0;
    var done = function(fname) {
      if(++minified === files.length) {
        events.emit('minify-done');
      }
    };
    events.on('minified', done);
    files.forEach(function(fname) { minify(fname, done); });
  });
};

events.on('begin', function() { compileAll(); })
      .on('minified', function(fname) { console.log('minified: ' + relPath(getMinName(fname))); })
      .on('compiled', function(fname) { console.log('compiled: ' + relPath(getCompiledName(fname))); })
      .on('compile-done', function() { minifyAll(); })
      .emit('begin');
