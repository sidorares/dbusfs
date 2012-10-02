FUSE userspace dbus filesystem 
===

Exposes DBus services, objects, interfaces, methods and properies as filesystem objects. Implemented using [node-dbus](https://github.com/sidorares/node-dbus) [node.js](https://github.com/joyent/node) library and [fuse4js](https://github.com/vmware/fuse4js) [FUSE](http://fuse.sourceforge.net/) node.js bindings. 

### Installation

Make sure you have fuse4js [requirements](https://github.com/bcle/fuse4js#requirements)

```shell
$ npm install dbusfs
```

### Mount filesystem

Ensure the mount point is empty and you have wrx permissions to it

```shell
$ mkdir /tmp/fuse
$ dbusfs /tmp/fuse
```

Unmounting:

```shell
$ fusermount -u /tmp/fuse
```

### Mappings

First element in the path is always path name, then one or more elements of object path, then interface name, then interface member (method, property or signal).

```
/servicename/object/path/intarface.name/MethodName
/servicename/object/path/intarface.name/ReadableProperty
/servicename/object/path/intarface.name/WriteableProperty
/servicename/object/path/intarface.name/MethodAsExecutableFile
/servicename/object/path/intarface.name/MethodReturningArrayOfObjects/SymlinkToObject/other.interface.name/Property
```

Root contains list of services

```
$ ls /tmp/fuse
:1.1    :1.13   :1.16  :1.2   :1.23  :1.27  :1.5  com.ubuntu.Upstart        org.freedesktop.ConsoleKit      org.freedesktop.NetworkManager
:1.11   :1.14   :1.17  :1.20  :1.24  :1.3   :1.6  org.bluez                 org.freedesktop.DBus            org.freedesktop.PolicyKit1
:1.110  :1.15   :1.18  :1.21  :1.25  :1.30  :1.7  org.freedesktop.Accounts  org.freedesktop.DisplayManager  org.freedesktop.RealtimeKit1
:1.112  :1.153  :1.19  :1.22  :1.26  :1.34  :1.8  org.freedesktop.Avahi     org.freedesktop.ModemManager    org.freedesktop.UPower
```

If service name is the same as main interface name and object path = interface name with dots replaced with '/':

```
/some.long.service.name/some/long/service/name/some.long.service.name
```
then `main` symlink is created to 'main' interface:

```
$ ls -l /tmp/fuse/org.freedesktop.Accounts/main
lrwxr-xr-x 0 root root 0 Jan  1  1970 /tmp/fuse/org.freedesktop.Accounts/main -> /tmp/fuse/org.freedesktop.Accounts/org/freedesktop/Accounts/org.freedesktop.Accounts
$ ls -l /tmp/fuse/org.freedesktop.Accounts/main/
total 0
-r-xr-xr-x 0 root root  149 Jan  1  1970 CreateUser
-r--r--r-- 0 root root    8 Jan  1  1970 DaemonVersion
-r-xr-xr-x 0 root root  149 Jan  1  1970 DeleteUser
-r-xr-xr-x 0 root root  151 Jan  1  1970 FindUserById
-r-xr-xr-x 0 root root  153 Jan  1  1970 FindUserByName
dr--r--r-- 0 root root 4096 Jan  1  1970 ListCachedUsers
```
Methods are mapped to shell script with corresponding [dbus-send](http://dbus.freedesktop.org/doc/dbus-send.1.html) command (at the moment you need to prefix parameter types manually)

```
cat /tmp/fuse/org.freedesktop.UPower/main/Hibernate
#!/bin/sh
dbus-send --system --print-reply --dest=org.freedesktop.UPower /org/freedesktop/UPower org.freedesktop.UPower.Hibernate $1 $2 $3 $4

$ /tmp/fuse/org.freedesktop.DBus/org.freedesktop.DBus/GetNameOwner string:com.ubuntu.Upstart
method return sender=org.freedesktop.DBus -> dest=:1.55 reply_serial=2
   string ":1.1"
```


Methods with out "ao" signature are mapped to directory with symlinks

```
ls -l /tmp/fuse/org.freedesktop.UPower/main/EnumerateDevices/
total 0
lrwxr-xr-x 0 root root 0 Jan  1  1970 battery_BAT0 -> /tmp/fuse//org.freedesktop.UPower//org/freedesktop/UPower/devices/battery_BAT0
lrwxr-xr-x 0 root root 0 Jan  1  1970 line_power_AC -> /tmp/fuse//org.freedesktop.UPower//org/freedesktop/UPower/devices/line_power_AC
```

Properties are mapped to files:

```
$ ls -l /tmp/fuse/org.freedesktop.Accounts/main/DaemonVersion 
-r--r--r-- 0 root root 8 Jan  1  1970 /tmp/fuse/org.freedesktop.Accounts/main/DaemonVersion

$ cat /tmp/fuse/org.freedesktop.Accounts/main/DaemonVersion 
"0.6.15"

```

### TODO:

 - add all items from this list as github issues
 - grep TODO dbusfs.js
 - add type modifiers to dbus-send generated scripts
 - writeable properties
 - make method returning object path a symlink to an object
 - treat read properties returning object path or array of object paths same way as methods with that signature (  `/tmp/fuse/org.freedesktop.DisplayManager/org/freedesktop/DisplayManager/org.freedesktop.DisplayManager/Seats` )
 - add --help switch to generated methods script to print argument names and types
 - watch NameAcquired/NameOwnerChanged signals to track new/deleted services
 - watch ObjectManager's InterfacesAdded
 - expose some additional service properties (e.g link to /proc/[pid]/exe using org.freedesktop.DBus.GetConnectionUnixProcessID)
 - map signals ( executable shell sctipt, dbus-monitor with corresponding match string? )  
 - fix dbus crash (reproduceable as `ls -l /tmp/fuse/com.ubuntu.Upstart/com/ubuntu/Upstart/jobs/acpid/_/com.ubuntu.Upstart0_6.Instance/processes`) 
 - tests & travis-ci integration