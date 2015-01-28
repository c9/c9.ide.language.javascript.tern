#!/bin/bash -e

MY_DIR=$(cd $(dirname $BASH_SOURCE); pwd)
NEWCLIENT_DIR=$(cd $(dirname $BASH_SOURCE)/../../..; pwd)

cd $MY_DIR
[ -e sigs_ts ] || git clone https://github.com/borisyankov/DefinitelyTyped.git sigs_ts
cd sigs_ts
git pull
REVISION=$(git rev-parse HEAD)

cd $MY_DIR
mkdir -p sigs
cd sigs
echo $REVISION > revision.txt

if ! which parallel &> /dev/null; then
    echo "Please install GNU parallel" >&2
    return 1
fi

ls ../sigs_ts | parallel '
    DIR=../sigs_ts/{1}

    find_main_file() {
        local DIR=$1
        try() {
            if [ -e $1 ]; then
                echo "$1"
            else
                return 1
            fi
        }
        
        try $DIR/$DIR.d.ts ||
        try $DIR/angular.d.ts ||
        try `ls $DIR/*.d.ts` ||
        {
            echo "Warning: could not find main signature file for $DIR" >&2
        }
    }
    
    if [ ! -d $DIR ]; then
        exit
    fi
    NAME=$(basename $DIR)
    MAIN=$(find_main_file $DIR)
    if [ "$MAIN" ]; then
        '$MY_DIR'/from_ts.sh "$MAIN" $NAME.json
    fi
'
