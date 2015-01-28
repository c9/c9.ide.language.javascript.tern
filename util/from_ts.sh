#!/bin/bash -e

NEWCLIENT_DIR=$(cd $(dirname $BASH_SOURCE)/../../..; pwd)

: ${2:?Usage: from_ts.sh (PATH|URL) TARGET.json}

readonly SOURCE=$1
readonly TARGET=$2

echo -n $TARGET

if ! ERROR=$($NEWCLIENT_DIR/node_modules/tern/bin/from_ts "$SOURCE" 2>&1 >$TARGET.tmp); then
    rm $TARGET.tmp
    DETAILS=$(echo "$ERROR" | grep Error:)
    echo " - $DETAILS"
else
    mv $TARGET.tmp $TARGET
    echo
fi

