var glob = require('glob'),
    path = require('path'),
    fs = require('fs'),
    uglify = require('uglify-js'),
    CleanCSS = require('clean-css'),
    root = process.argv[2],

if (!root) {
  console.log('Usage: node clamps.js folder');
  process.exit(-1);
}

var rootStat = fs.statSync(root);
if (!(rootStat && rootStat.isDirectory())) {
  console.log(root + " is not a directory");
  process.exit(-1);
}

var sourceExp = /\.(js|css)$/;
var minnedExp = /\.min\.(js|css)$/;
var getMinName = function(fname) { return fname.replace(sourceExp, '.min.$1'); };
var isNotMinnedFile = function (fname) { return !minnedExp.test(fname); };
var relPath = function(fname) { return fname.replace(root.replace(/\\/g, '/'), ''); };
var getExt = function(fname) { return sourceExp.exec(fname)[1]; };
var fullPath = function(fname) { return path.join(root, fname); }

var cleaner = new CleanCSS();
var minifiers = {
  'js'   : function(fname) { return uglify.minify(fname).code; },
  'css'  : function(fname) { return cleaner.minify(fs.readFileSync(fname, {encoding: 'utf-8'})); }
};

var needsMin = function(fname) {
  var min = getMinName(fname);
  try { return fs.statSync(fname).mtime > fs.statSync(min).mtime; } 
  catch (e) { return true; }
};

var writeMinned = function(fname) {
  fs.writeFile(getMinName(fname), minifiers[getExt(fname)](fname), {encoding:'utf-8'}, function(err) {
    if (err) throw err;
    console.log('Wrote ' + relPath(minFile));
  });
};

glob("**/*.{js,css}", {cwd: root}, function(err, files) {
  if (err) throw err;
  files = files.map(fullPath);
  files = files.filter(isNotMinnedFile);
  files = files.filter(needsMin);
  files.forEach(writeMinned);
});
