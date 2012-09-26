#!/usr/bin/env node

var f4js = require('fuse4js');
var dbus = require('dbus-native');
var xml2js = require('xml2js');

var options = {};
var bus = null;
var root = {     
};

function isDir(node) {
  return node.attr.mode === 040444; // TODO: check flag only
}

function lookup(path, cb) {
  // TODO: remove root as special case
  if (path === '/')
      return cb(root);

  var pathParts = path.split('/');
  var depth = 0;
  var name = pathParts[++depth]; 
  var node = root.children[name];
  while(node && (depth + 1 < pathParts.length)) {
      name = pathParts[++depth]; 
      if (!node.children || !node.attr && isDir(node)) 
      {
         expand(node, function() {
             lookup(path, cb); // TODO: don't start from beginning
         });
         return;
      }
      node = node.children[name];
  }
  cb(node); 
}

function introspect(destination, path, cb) {
  bus.invoke({
    destination:  destination,
    path:         path,
    'interface': 'org.freedesktop.DBus.Introspectable',
    member:       'Introspect'
  }, function(err, xml) {
    if (err) return cb(-1);
    var parser = new xml2js.Parser({explicitArray: true});
    parser.parseString(xml, function (err, result) {
      console.log(JSON.stringify(result, null, 4));
      cb(err, result);
    });
  });
}

function sendScript(destination, objectPath, iface, methodName, args)
{
    // TODO: build --session/system flag or DBUS_SESSION_BUS_ADDRESS variable depending on dbusfs input dlags
    var header = '#!/bin/sh\nif [ $1 = \'-v\' ]; then\n    literal=""\n    shift;\nelse\n    literal="=--literal"\nfi\n';
    //res += 'export DBUS_SESSION_BUS_ADDRESS=' + process.env.DBUS_SESSION_BUS_ADDRESS + '\n'; 
    res = 'dbus-send --system --print-reply$literal --dest=' + destination + ' ' + objectPath + ' ' + iface + '.' + methodName + ' ';
 
    var types = {
           s: 'string',
           n: 'int16',
           q: 'uint16',
           u: 'uint32',
           i: 'int32',
           t: 'uint64',
           x: 'int64',
           d: 'double',
           y: 'byte',
           b: 'boolean',
           o: 'objpath',
           v: 'variant' // variant is a container, but type is part 
                        // of an argument and we can use it the same way as simple types
    };

    var help = 'if [ $1 = \'--help\' ]; then\n';
   
    var arg;
    // + ' $1 $2 $3 $4\n';
    if (args) {

        // help
        var i;

        var argnum = 0;
        for (var i=0; i < args.length; ++i)
        {
            help += '    echo "' + args[i].$.name + ' ' + args[i].$.direction + ' ' + args[i].$.type + '"\n';
            if (args[i].$.direction === 'out')
                continue;
            argnum++;

            arg = args[i].$.type;
            if (arg[0] === 'a') {
                 if (arg[1] == '{') { // dict
                     res += 'dict:' + types[arg[2]] + ':' + types[arg[3]] + ':$' + argnum + ' ';
                     continue;
                 }
                 res += 'array:' + types[arg[1]] + ':$' + argnum + ' ';
                 break;
            } else {
                 res += types[arg[0]] + ':$' + argnum + ' ';
            }
            //res += '===\n' + JSON.stringify(args[i], null, 4) + '\n===\n';
        }
    }
    help += '    exit 0\nfi\n';
    res += '\n';
    return header + help + res;
}

function expand(node, cb) {
  
  var path = node.path;
  switch(node.type) {
  case 'root':
      console.log('should not be here');
      throw new Error('aaa');
  case 'service':
  case 'object-path':
          node.children = {};
          var pathParts = path.split('/');
          var destination = pathParts[1];
          var objectPath = path.substr(destination.length+1);
          if (objectPath === '')
              objectPath = '/';
         
          introspect(destination, objectPath, function(err, res) {

              if (!res)
                 return cb();

              if (res.node && res.node.interface) {
                 var name;
                 var ifaces = res.node.interface;
                 for (var i=0; i < ifaces.length; ++i)
                 {
                     var iface = ifaces[i];
                     name = iface.$.name;
                     node.children[name] = {
                         type: 'interface',
                         attr: { size: 4096, mode: 040444 },
                         path: node.path + '/' + name,
                         destination: destination,
                         objectPath: objectPath,
                         iface: name,
                         children: {}
                     };
                     nodeIface = node.children[name].children;
                     if (iface.method)
                     for (var j=0 && iface.method; j < iface.method.length; ++j)
                     {
                         var m = iface.method[j];
                         if (m.arg && m.arg.length === 1 && m.arg[0].$.direction === 'out' && m.arg[0].$.type === 'ao') {
                           var subnode = nodeIface[m.$.name] = {
                              type: 'objpath-method',
                              children: {},
                              destination: destination,
                              objectPath: objectPath,
                              iface: name,
                              method: m.$.name,
                              attr: { size: 4096, mode: 040444 }
                           };
                           var links = subnode.children;
                           (function(inputNode, destination, objectPath, name, memberName) {
                               var msg = {
                                   destination: destination,
                                   path: objectPath,
                                   interface: name,
                                   member: memberName // TODO: be consistent in member/method names
                               };
                               bus.invoke(msg, function(err, arr) {
                                   for (var i=0; i < arr.length; ++i) {
                                       var pathParts = arr[i].split('/');
                                       var localname = pathParts[pathParts.length - 1];
                                       links[localname] = {
                                           type: 'object-link',
                                           target: '/' + destination + '/' + arr[i],
                                           attr: { size: 0, mode: 0120755 }
                                       };
                                   }
                               });
                            })(node, destination, objectPath, name, m.$.name);
                         } else {
                           var script = sendScript(destination, objectPath, iface.$.name, m.$.name, m.arg);
                           nodeIface[m.$.name] = {
                              type: 'method',
                              destination: destination,
                              objectPath: objectPath,
                              iface: name,
                              args: m.arg,
                              path: node.path + '/' + m.$.name,
                              method: m.$.name,
                              content: script,
                              attr: { size: script.length, mode: 0100555 }
                           };
                         }
                     }
                     if (iface.property)
                     for (var j=0 && iface.property; j < iface.property.length; ++j)
                     {
                         var m = iface.property[j];
                         nodeIface[m.$.name] = {
                            type: 'property',
                            destination: destination,
                            objectPath: objectPath,
                            iface: name,
                            member: m.$.name,
                            access: m.$.access,
                            propertyType: m.$.type,
                            path: node.path + '/' + m.$.name,
                            content: script,
                            attr: null // calculate on getattr!
                         };
                     }
                 }
              }
              if (res.node && res.node.node) {
                 var name;
                 var nodes = res.node.node;
                 for (var i=0; i < nodes.length; ++i)
                 {
                     console.log(nodes[i]);
                     console.log(nodes[i].$);
                     name = nodes[i].$.name;
                     node.children[name] = {
                         type: 'object-path',
                         destination: destination,
                         attr: { size: 4096, mode: 040444 },
                         path: node.path + '/' + name
                     };
                 } 
              }

              var exeReady = false;
              var mainReady = false;
              if (path === '/' + destination && typeof(node.children.exe) == 'undefined') {
                  (function(node) {
                  bus.getConnectionUnixProcessId(destination, function(err, pid) {
                      if (!err) {
                          // TODO handle error
                          var procPath = '/proc/' + pid + '/exe';

                          require('fs').readlink(procPath, function(err, proc) {
                              // TODO: handle error
                              if (!err) {
                                  node.children.exe = {
                                      type: 'link',
                                      attr: { size: 0, mode: 0120755 },
                                      path: node.path + '/exe',
                                      target: proc
                                  };
                              }
                              console.log(err, proc);
                              console.log(node.children.exe);
                              exeReady = true;
                              if (exeReady && mainReady)
                                  cb(0, node);
                          });
                      }
                  });
                  })(node);
              } else
                  exeReady = true;
              
              // shortcut to a usually lengthy /some.service.name/some/service/name/some.service.name path if it exists
              if (path === '/' + destination && typeof(node.children.main) == 'undefined') {
                 var mainObject = destination.replace(/\./g, '/');
                 var mainIfacePath = '/' + destination + '/' + mainObject + '/' + destination;
                 lookup(mainIfacePath, function(mainIfaceNode) {
                     if (mainIfaceNode) {
                         node.children.main = {
                             type: 'link',
                             attr: { size: 0, mode: 0120755 },
                             path: node.path + '/main',
                             target: opts.mountPoint + mainIfacePath
                         };
                     }
                     mainReady = true;
                     if (exeReady && mainReady)
                         cb(0, node);
                 });
              }
              else 
                 mainReady = true;
              
              if (exeReady && mainReady)
                 cb(0, node);
          });
          return;
    default:
          throw new Error('trying to expand ' + node.type + ' node, this indicates to some logic errors');
  } 
}

function getattr(path, cb) {
  lookup(path, function(node) {
     if (!node)
        cb(-2);
     else {
        if (node.type === 'property') {
            if (node.attr) {
                return cb(0, node.attr);
            }
            bus.invoke({
                destination: node.destination,
                path:        node.objectPath,
                interface:   'org.freedesktop.DBus.Properties',
                member:      'Get',
                signature: 'ss',
                body: [ node.iface, node.member ]
            }, function(err, value) {
                if (!err) {
                   node.content = JSON.stringify(value[1][0], null, 4);
                } else {
                   node.content = JSON.stringify(err);
                }
                var mode = 0100666; // readwrite by default
                if (node.access === 'read')
                    mode = 0100444;
                if (node.access === 'write')
                    mode = 0100222;
                
                node.attr =  { size: node.content.length, mode: mode }; // TODO: test when read-only
                return cb(0, node.attr); 
            });
        } else {
          return cb(0, node.attr);
        }
     }
  });
}

function readlink(path, cb) {
    lookup(path, function(node) {
        if (!node)
           return cb(-2);
        if (node.target)
           return cb(0, node.target);
        else
           console.log(JSON.stringify(node, null, 4));
           throw new Error('link node without a target');
    });
}

function readdir(path, cb) {
  lookup(path, function(node) { 
     if (!node)
       return cb(-2);

     if (!node.children) {
       return expand(node, function() {
           readdir(path, cb);
       });
     }
     var names = Object.keys(node.children);
     cb(0, names);
  });
}

function open(path, flags, cb) {
  lookup(path, function(node) {
    if (node)
      cb(0);
    else
      cb(-2);
  });
}

//---------------------------------------------------------------------------

/*
 * Handler for the read() system call.
 * path: the path to the file
 * offset: the file offset to read from
 * len: the number of bytes to read
 * buf: the Buffer to write the data to
 * fh:  the optional file handle originally returned by open(), or 0 if it wasn't
 * cb: a callback of the form cb(err), where err is the Posix return code.
 *     A positive value represents the number of bytes actually read.
 */
function read(path, offset, len, buf, fh, cb) {
  var err = 0; // assume success
  lookup(path, function(node) {
   if (!node)
     return cb(-2);
   var data;
   var file;

   switch (node.type) {
   case 'method':
   case 'property':
     console.log('READING VALUE');
     console.log(node);
     file = node.content;
     if (offset < file.length) {
       maxBytes = file.length - offset;
       if (len > maxBytes) {
         len = maxBytes;
       }
       console.log('CONTENT:', file);
       data = file.substring(offset, len);
       buf.write(data, 0, len, 'ascii');
       err = len;
       return cb(err);
     }
     break;

  default:
    return cb(-1); // -EPERM
  }

  });
}

//---------------------------------------------------------------------------

/*
 * Handler for the write() system call.
 * path: the path to the file
 * offset: the file offset to write to
 * len: the number of bytes to write
 * buf: the Buffer to read data from
 * fh:  the optional file handle originally returned by open(), or 0 if it wasn't
 * cb: a callback of the form cb(err), where err is the Posix return code.
 *     A positive value represents the number of bytes actually written.
 */
function write(path, offset, len, buf, fh, cb) {
  var err = 0; // assume success
  var info = lookup(obj, path);
  var file = info.node;
  var name = info.name;
  var parent = info.parent;
  var beginning, blank = '', data, ending='', numBlankChars;
  cb(err);
}

/*
 * Handler for the release() system call.
 * path: the path to the file
 * fh:  the optional file handle originally returned by open(), or 0 if it wasn't
 * cb: a callback of the form cb(err), where err is the Posix return code.
 */
function release(path, fh, cb) {
  cb(0);
}

/*
 * Handler for the create() system call.
 * path: the path of the new file
 * mode: the desired permissions of the new file
 * cb: a callback of the form cb(err, [fh]), where err is the Posix return code
 *     and fh is an optional numerical file handle, which is passed to subsequent
 *     read(), write(), and release() calls (it's set to 0 if fh is unspecified)
 */
function create (path, mode, cb) {
  var err = 0; // assume success
  cb(err);
}

function unlink(path, cb) {
  cb(-1);
}

function rename(src, dst, cb) {
  var err = -2; // -ENOENT assume failure
  cb(err);
}

function mkdir(path, mode, cb) {
  var err = -2; // -ENOENT assume failure
  cb(err);
}

function rmdir(path, cb) {
  var err = -2; // -ENOENT assume failure
  cb(err);
}

function init(cb) {

  bus = dbus.systemBus();
  //bus = dbus.createClient();
  bus.listNames(function(err, names) {
    root.type = 'root';
    root.path = '/';
    root.attr = { size: 4096, mode: 040444 };
    root.children = {};
    for (var i=0; i < names.length; ++i)
      root.children[names[i]] = { type: 'service', path: '/' + names[i], destination: names[i], attr: { size: 4096, mode: 040444 } };
    console.log("File system started at " + options.mountPoint);
    console.log("To stop it, type this in another shell: fusermount -u " + options.mountPoint);
    cb();
  });
}

function destroy(cb) {
  console.log("File system stopped");      
  if (bus && bus.connection && bus.connection.state === 'connected')
     bus.connection.end();
  cb();
}

function unmount(cb)
{
  require('child_process').exec('fusermount -u ' + options.mountPoint, function() {
      cb();
  });
}

process.on('SIGINT', function() {
   unmount(function() {
       process.exit(0);
   });
});

var handlers = {
  getattr: getattr,
  readdir: readdir,
  readlink: readlink,
  open: open,
  read: read,
  write: write,
  release: release,
  create: create,
  unlink: unlink,
  rename: rename,
  mkdir: mkdir,
  rmdir: rmdir,
  init: init,
  destroy: destroy
};

function usage() {
  console.log();
  console.log("Usage: dbusfs.js mountPoint");
  console.log("(Ensure the mount point is empty and you have wrx permissions to it)\n")
  console.log();
}

// TODO use optimist
function parseArgs() {
  var i, remaining;
  var args = process.argv;
  //options.debugFuse = true;
  if (args.length < 3)
      return false;
  options.mountPoint = args[args.length - 1];
  return true;
}

//---------------------------------------------------------------------------

//(function main() {
  if (parseArgs()) {
    console.log("Mount point: " + options.mountPoint);
    if (options.debugFuse)
      console.log("FUSE debugging enabled");
    try {
      f4js.start(options.mountPoint, handlers, options.debugFuse);
    } catch (e) {
      console.log("Exception when starting file system: " + e);
    }
  } else {
    usage();
  }
//})();
