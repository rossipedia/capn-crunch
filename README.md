Capn Crunch
===========

A minimal recursive less compiler and js/css minifier.

Usage
-----

```
$ node capn-crunch.js ~/path/to/content/folder
```

Here's what happens:

1. Traverse folder and compile \*.less files to \*.css
2. Traverse folder and minify \*.js and \*.css files to \*.min.js and
   \*.min.css

Both steps above are only performed when the source file is newer than
the compiled/minified file.

#### Why? Isn't this a solved problem?

You'd think. However, I couldn't find a tool that was this simple.
Most existing tools either handle a single file at a time or assume
you're using express or other frameworks. I just needed something
that would walk a folder structure and minimize every js/css file encountered.

Dependencies
------------

* [node-glob][1]
* [uglify-js][2]
* [clean-css][3]

[1]:https://github.com/isaacs/node-glob
[2]:http://lisperator.net/uglifyjs
[3]:https://github.com/GoalSmashers/clean-css

Also works on Node for Windows
