
from collections import Counter
from io import BytesIO
import math
import sys
from time import time


ALPHABET = ''.join(map(chr, range(ord('a'), ord('a') + 26)))
LETTERS = ALPHABET + ALPHABET.upper()
BASE62 = '0123456789' + LETTERS

LAYER_SIZE = 4
LAYER_NAMES = list('qrts')

PATH_CHARS_MAP = dict(zip(
    map(str, range(LAYER_SIZE)) + LAYER_NAMES,
    range(LAYER_SIZE) * 2
))


def normalize_path(path):
    if isinstance(path, basestring):
        path = map(lambda c: PATH_CHARS_MAP[c], path)
    return path


class Node(list):
    def is_mono(self):
        x = self[0]
        if isinstance(x, Node):
            return False
        for item in self[1:LAYER_SIZE]:
            if isinstance(item, Node) or item is not x:
                return False
        return True

    def get(self, path):
        if not path:
            return Q3(self)  # todo: cover to Q3
        node = self[path[0]]
        return node.get(path[1:]) if isinstance(node, Node) else node
    
    def set(self, path, value):
        idx, rest = path[0], path[1:]        
        if rest:
            node = self[idx]
            if not isinstance(node, Node):
                node = Node([node] * LAYER_SIZE)
            if node.set(rest, value):
                node = value
            self[idx] = node
        else:
            self[idx] = value

        return self.is_mono()

    def __repr__(self):
        return '<{}>'.format(', '.join(map(repr, self)))


STD_COLOR_MAP = {Node: '+', None: '~', 255: 'Z'}
STD_COLOR_MAP.update(zip(xrange(len(BASE62)), BASE62))
        

class Q3(object):
    def __init__(self, value=None, items=()):
        self.root = value
        for path, value in items:
            self.set(path, value)

    def is_mono(self):
        return not isinstance(self.root, Node) or self.root.is_mono()

    def get(self, path):
        path = normalize_path(path)

        root = self.root
        if not path or not isinstance(root, Node):
            return root
        else:
            return root.get(path)

    def set(self, path, value):
        path = normalize_path(path)

        if path:
            root = self.root
            if not isinstance(root, Node):
                root = Node([root] * LAYER_SIZE)

            if root.set(path, value):
                root = value

            self.root = root
        else:
            self.root = value

    def __repr__(self):
        root = self.root
        return repr(root) if isinstance(root, Node) else '<{}>'.format(repr(root))

    def __delitem__(self, path):
        self[path] = None
        
    __getitem__ = get
    __setitem__ = set

    def _save(self, stream, color_map):
        stack = [self.root]
        node_code = color_map[Node]
        while stack:
            value = stack.pop(-1)
            if isinstance(value, Node):
                stream.write(node_code)  # todo: node map
                stack.extend(reversed(value))
            else:
                #print value, color_map[value], 
                stream.write(color_map[value])

    def save(self, out=None, color_map=None):  # todo: strict mode flag
        if color_map is None:
            color_map = STD_COLOR_MAP
            
        if out:
            if isinstance(out, basestring):
                stream = open(out, 'w')
            else:
                stream = out
        else:
            stream = BytesIO()

        try:
            self._save(stream=stream, color_map=color_map)
            if not out:
                return stream.getvalue()
        finally:
            if out and isinstance(out, basestring):
                stream.close()

    def load_from_image(self, image, color_map_func=None):
        from tileid import Tileid
        width, height = image.size
        percent = height * width / 100
        z = int(math.ceil(math.log(max(image.size), 2)))
        color_set = set()

        def iter_pixels():
            for y in xrange(height):
                for x in xrange(width):
                    yield x, y

        #def iter_pixels():        
        #    for t in Tileid().iter_square(z):
        #        yield t.xyz()[:2]

        t = time()
        for i, (x, y) in enumerate(iter_pixels()):
            c = image.getpixel((x, y))
            if color_map_func:
                c = color_map_func(c)
            self.set(Tileid(x, y, z), c)
            color_set.add(c)

            if i % percent == 0:
                sys.stderr.write('.')

        sys.stderr.write('[{:.2f}s]\n'.format(time() - t))
        return z, color_set
        

if __name__ == '__main__':
    import Image
    q = Q3()
    
    img = Image.open(r'images\10s17w.png')
    print q.load_from_image(img)
