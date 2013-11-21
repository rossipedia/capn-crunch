Capn Crunch
===========

A minimal recursive less compiler and js/css minifier.

Usage
-----

```
$ node capn-crunch.js ~/path/to/content/folder
```

Capn crunch is a minimal less, css, and js processor. Less files are compiled 
to minified CSS files (no intermediate css step), CSS and JS files are minified/compressed.

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
* [less][4]

[1]:https://github.com/isaacs/node-glob
[2]:http://lisperator.net/uglifyjs
[3]:https://github.com/GoalSmashers/clean-css
[4]:http://lesscss.org/

Also works on Node for Windows
