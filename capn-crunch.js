var glob = require('glob'),
    path = require('path'),
    fs = require('fs'),
    uglify = require('uglify-js'),
    CleanCSS = require('clean-css'),
    less = require('less'),
    EventEmitter = require('events').EventEmitter,
    util = require('util'),
    root = process.argv[2];

if (!root) {
  console.log('Usage: node capn-crunch folder');
  process.exit(-1);
}

var events = new EventEmitter();

var rootStat = fs.statSync(root);
if (!(rootStat && rootStat.isDirectory())) {
  console.log(root + " is not a directory");
  process.exit(-1);
}

var filesGlob = "**/*.{less,css,js}";
var exclude = /\.min\.(css|js)$/;

function processLess(file, source, done) {
  var dirname = path.dirname(file);
  var options = {paths:[dirname], compress:true};
  less.render(source, options, done);
}

var cleaner = new CleanCSS();
function processCss(file, source, done) {
  var minCss = cleaner.minify(source);
  done(null, minCss);
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
    name: function (name) { return name.replace(/\.less$/, '.min.css'); },
    code: processLess
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
    if (e) throw e;
    events.emit('file-read', filename, contents);
  });
}

function processFile(filename, contents) {
  var transformer = transformers[getExtension(filename)].code;
  if (!transformer) throw new Error('Unknown file format: ' + filename);
  transformer(filename, contents, function(e, output) {
    if (e) throw e;
    events.emit('file-processed', filename, output);
  });
};

function writeOutputFile(filename, output) {
  var outfilename = getOutputName(filename);
  fs.writeFile(outfilename, output, {encoding:'utf-8'}, function(e) {
    if (e) throw e;
    events.emit('file-saved', filename, outfilename);
  });
};

function findFiles() {
  glob(filesGlob, {cwd:root}, function(e, files) {
    if (e) throw e;
    // Convert to abs path
    files = files.map(function(f) { return path.join(root, f); });
    // Global Exclude
    files = files.filter(function(f) { return !exclude.test(f); });
    // Conditial check
    files = files.filter(shouldRead);
    events.emit('files-found', files);

    var pump = function() {
      if(files.length > 0) {
        var file = files.shift();
        events.emit('file-found', file);
      } else {
        events.removeListener('file-saved', pump);
      }
    };

    events.on('file-saved', pump);
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
      .emit('begin');
