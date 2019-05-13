
import re
import os
import sys
import Image
import glob
import math

from tileset2 import Q3
from tileid import Tileid


TILES_PATH = "images/"
TS_DEST_PATH = "ts/"
SHIFT_X = 50
SHIFT_Y = 32
TS_BLACK = Q3(0)
TS_WHITE = Q3(1)

class WrongTileFileName(Exception):
    pass


def fn2xy(fn):
    fn = os.path.split(fn)[-1]
    f, ext = os.path.splitext(fn)
    match = re.match('(\d+)([sn])(\d+)([ew])', f.lower())
    if match is None:
        raise WrongTileFileName(fn)
    lat, sn, lon, ew = match.groups()
    lat = int(lat)
    lon = int(lon)
    x = lon if ew == 'e' else (1 - lon)
    y = lat if sn == 'n' else (1 - lat)
    return x, y


def xy2fn(x, y, path=TILES_PATH):
    fn = '{yy}{ns}{xx}{ew}.png'.format(
        xx=x if x > 0 else (1-x),
        yy=y if y > 0 else (1-y),
        ew='e' if x > 0 else 'w',
        ns='n' if y > 0 else 's',
    )
    fn = os.path.join(path, fn)
    solid = None
    if not os.path.isfile(fn):
        solid = 'white' if y > 0 else 'black'        
        fn = "{color}.png".format(color=solid)
        fn = os.path.join(path, fn)

    return fn, solid


def iter_tiles(path=TILES_PATH, lines=xrange(-32, 32), columns=xrange(-50, 50)):
    count = len(lines) * len(columns)

    i = 0
    for y in lines:
        for x in columns:
            yield xy2fn(x, y, path=path) + ((x, y), (i, count))
            i += 1


def iter_files(path=TILES_PATH):
    files = glob.glob(os.path.join(path, '*.png'))
    count = len(files)

    for i, f in enumerate(files):
        solid = None
        try:            
            x, y = fn2xy(f)
            yield f, solid, (x, y), (i, count)
        except WrongTileFileName:
            if 'white' in f:
                solid = 'white'
            elif 'black' in f:
                solid = 'black'
            else:
                count -= 1

            yield f, solid, (x, y), (i, count)
    

def img2ts(img):
    q = Q3()
    z, colors = q.load_from_image(img, color_map_func=lambda c: 0 if c < 128 else 1)
    #colors = sorted(colors)
    return q
    

def gen_tilesets(src=TILES_PATH, dest=TS_DEST_PATH, clean_dest=False):
    if clean_dest:
        files = glob.glob(os.path.join(dest, "*.ts"))
        for f in files:
            os.remove(f)
        print 'old files removed'

    iterator = iter_files
    #iterator = iter_tiles
    
    for fn, solid, (x, y), (i, count) in iterator(path=src):
        x = x + SHIFT_X
        y = y + SHIFT_Y
        ts_fn = os.path.join(dest, '{x:03},{y:03}.ts'.format(x=x, y=y))
        if not os.path.isfile(ts_fn):
            if not solid:
                print >>sys.stderr, '{i:4}/{count}: [{fn:20}] -> [{ts_fn:20}] ({x:3}, {y:4})'.format(**locals())
                img = Image.open(fn)
                ts = img2ts(img)
                del img
            else:
                ts = {'white': TS_WHITE, 'black': TS_BLACK}[solid]

            with open(ts_fn, 'w') as f:
                ts.save(out=f)


if __name__ == '__main__':
    gen_tilesets()        
    print 'ok'
