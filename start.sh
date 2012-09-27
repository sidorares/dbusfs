mkdir -p /tmp/fuse
fusermount -u /tmp/fuse
export DBUS_SESSION_BUS_ADDRESS=`DISPLAY=:0 node ./node_modules/dbus-native/test/utils/address.js`
./dbusfs.js /tmp/fuse
