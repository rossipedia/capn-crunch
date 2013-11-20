glob = require("glob")
path = require("path")
fs = require("fs")
uglify = require("uglify-js")
CleanCSS = require("clean-css")
root = process.argv[2]
rootStat = undefined

unless root
  console.log "Usage: node index.js folder"
  process.exit -1

rootStat = fs.statSync(root)
unless rootStat and rootStat.isDirectory()
  console.log root + " is not a directory"
  process.exit -1

sourceExp = /\.(js|css)$/
minnedExp = /\.min\.(js|css)$/
getMinName = (fname) -> fname.replace sourceExp, ".min.$1"
isNotMinnedFile = (fname) -> not minnedExp.test(fname)
relPath = (fname) -> fname.replace root.replace(/\\/g, "/"), ""
getExt = (fname) -> sourceExp.exec(fname)[1]
fullPath = (fname) -> path.join root, fname

cleaner = new CleanCSS()
minifiers =
  js: (fname) -> uglify.minify(fname).code
  css: (fname) -> cleaner.minify fs.readFileSync fname, encoding: "utf-8"

needsMin = (fname) ->
  min = getMinName(fname)
  try
    fs.statSync(fname).mtime > fs.statSync(min).mtime
  catch e
    true # statSync threw on min file name

writeMinned = (fname) ->
  try
    minifier = minifiers[getExt(fname)]
    minFile = getMinName(fname)
    fs.writeFile minFile, minifier(fname), encoding: "utf-8" , (err) ->
      throw err  if err
      console.log "Wrote " + relPath(minFile)
  catch e
    console.log "Error minifying #{fname}: #{e}"

glob "**/*.{js,css}", cwd: root , (err, files) ->
  throw err  if err
  files = files.map(fullPath)
  files = files.filter(isNotMinnedFile)
  files = files.filter(needsMin)
  files.forEach writeMinned
