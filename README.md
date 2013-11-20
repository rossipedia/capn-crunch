Capn Crunch
===========

A minimal recursive js/css minifier.

Usage
-----

```
$ node capn-crunch.js ~/path/to/content/folder
```

Capn Crunch will traverse the folder that is passed as an argument, 
as well as all subfolders, looking for any files that ends in 
either \*.css or \*.js and minifies any file found.

#### Only when needed

Capn Crunch will look for an existing \*.min.js or \*.min.css file 
and compare the modification time of the existing minified file 
against the source file, and will only re-minify if the source 
file has been modified more recently.

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
