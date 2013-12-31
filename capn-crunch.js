var glob = require('glob'),
    path = require('path'),
    fs = require('fs'),
    uglify = require('uglify-js'),
    CleanCSS = require('clean-css'),
    less = require('less'),
    EventEmitter = require('events').EventEmitter,
    url = require('url'),
    util = require('util'),
    crypto = require('crypto'),
    staticRoot = process.argv[2],
    siteRoot = process.argv[3]; // for resolving css url()'s that start with /

if (!staticRoot) {
  console.log('Usage: node capn-crunch folder');
  process.exit(-1);
}

if (!siteRoot) {
  siteRoot = root;
}

var events = new EventEmitter();

var rootStat = fs.statSync(staticRoot);
if (!(rootStat && rootStat.isDirectory())) {
  console.log(root + " is not a directory");
  process.exit(-1);
}

var filesGlob = "**/*.{less,css,js}";
var exclude = /(\.min\.(css|js)$)|(^_(.+?)\.less$)/;

function processLess(file, source, done) {
  var dirname = path.dirname(file);
  var options = {paths:[dirname], compress:true};
  less.render(source, options, function(e, css) {
    if (e) fileError(file, e);
    css = cacheBreakCss(file, css);
    done(null, css);
  });
}

var cleaner = new CleanCSS();
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

var cacheBreakers = {};
function getCacheBreaker(file) {
  if(typeof cacheBreakers[file] === 'undefined') {
    cacheBreakers[file] = getHash(file);
  }

  return cacheBreakers[file];
}

function isSiteLocalImagePath(file) {
  switch(file.charAt(0)) {
    case '.': return true;
    case '/': return file.charAt(1) != '/';
    default: return false;
  }
}

function cacheBreakCss(file, css) {
  return css.replace(/url\((['"]?)(.+?)\1\)/g, function(match, quote, p1) {
    // anything else isn't a file ref on the web site
    if(!isSiteLocalImagePath(p1)) {
      return match;
    }
    // Local or absolute
    var startFrom = file[0] == '/' ? siteRoot : path.dirname(file);
    var urlpath = path.normalize(path.join(startFrom, p1));
    var hash;
    try {
      hash = getCacheBreaker(urlpath);
    } catch (e) {
      fileError(file, 'error cache-breaking rule ' + match + '\n' + e.toString());
    }
    var broken = 'url(' + quote + p1 + '?v=' + hash.substr(0,12) + quote + ')';
    // console.log(' -> broke ' + broken);
    return broken;
  });
}

var compressor = uglify.Compressor({warnings:false});
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
  'less' : {
    name : function (name) { return name.replace(/\.less$/, '.min.css'); },
    code : processLess
  },
  'css'  : {
    name : function (name) { return name.replace(/\.css$/, '.min.css'); },
    code : processCss,
    // Only process if the less file is also not present
    condition: function(name) { return !fs.existsSync(name.replace(/\.css$/, '.less')); }
  },
  'js'   : {
    name : function (name) { return name.replace(/\.js/, '.min.js'); },
    code : processJs
  }
};

function fileError(filename, e) {
  if (e.constructor !== Error) {
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
  fs.readFile(filename, {encoding:'utf-8'}, function(e, contents) {
    if (e) fileError(filename,e);
    events.emit('file-read', filename, contents);
  });
}

function processFile(filename, contents) {
  var transformer = transformers[getExtension(filename)].code;
  if (!transformer) throw new Error('Unknown file format: ' + filename);
  transformer(filename, contents, function(e, output) {
    if (e) fileError(filename,e);
    events.emit('file-processed', filename, output);
  });
};

function writeOutputFile(filename, output) {
  var outfilename = getOutputName(filename);
  fs.writeFile(outfilename, output, {encoding:'utf-8'}, function(e) {
    if (e) fileError(filename,e);
    events.emit('file-saved', filename, outfilename);
  });
};

function findFiles(root) {
  glob(filesGlob, {cwd:root}, function(e, files) {
    if (e) fileError(filename,e);
    // Convert to abs path
    files = files.map(function(f) { return path.join(root, f); });
    // Global Exclude
    files = files.filter(function(f) { return !exclude.test(path.basename(f)); });
    // Conditial check
    files = files.filter(shouldRead);

    // sort
    var ordering = ['less', 'css', 'js'];
    files.sort(function(a,b) {
      var ax = getExtension(a);
      var bx = getExtension(b);
      return ax != bx
        ? (ordering.indexOf(ax) - ordering.indexOf(bx))
        : a.localeCompare(b);
    });

    events.emit('files-found', files);

    // This essentially processes files sequentially
    // Done this way so that we get output on the console
    // as files are processed.
    //
    // If you don't care about that, the following is probably
    // much simpler:
    //
    //     files.forEach(function(file){ events.emit('file-found', file); });
    //

    var pump = function() {
      if(files.length > 0) {
        var file = files.shift();
        events.emit('file-found', file);
      } else {
        events.removeListener('file-saved', pump);
      }
    };

    events.on('file-saved', pump)
    pump();
  });
};


var processedCount = 0;
var totalToProcess = 0;

events.on('begin', function() { console.time('crunch'); })
      .on('begin', findFiles)
      .on('files-found', function(files) {
        totalToProcess = files.length;
        console.log('found ' + totalToProcess + ' files');
      })
      .on('file-found', readFile)
      .on('file-read', processFile)
      .on('file-processed', writeOutputFile)
      .on('file-saved', function(oldname, newname) {
        console.log('compiled [' + getExtension(oldname) + ']: ' + newname);
        if(++processedCount === totalToProcess)
          events.emit('done');
      })
      .on('done', function() { console.timeEnd('crunch'); })
      .emit('begin', staticRoot);

process.on('uncaughtException', function(e) {
  if(e.stack) {
    console.log(e.stack);
  } else {
    console.log(e);
  }
  process.exit(-1);
});
