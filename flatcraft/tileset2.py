
from collections import Counter
from StringIO import StringIO
import pickle


LAYER_SIZE = 4
LAYER_NAMES = list('qrts')
NODE_CODE = 0xFF

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
    
    def _load(self, stream):
        while self:
            self.pop()
        for i in xrange(LAYER_SIZE):
            v = ord(stream.read(1))
            if v == NODE_CODE:
                v = Node()
                v._load(stream)
            self.append(v)

    def remap(self, d):
        for i, item in enumerate(self):
            if isinstance(item, Node):
                item.remap(d)
            else:
                self[i] = d[item]

    def save(self, colors, stream=None):
        out = stream or StringIO()
        
        out.write(chr(NODE_CODE))
        for item in self:
            if isinstance(item, Node):
                item.save(colors, stream=out)
            else:
                code = colors.get(item)
                if code is None:
                    code = max(colors.values() + [-1]) + 1
                    colors[item] = code
                out.write(chr(code))

        if stream is None:
            return out.getvalue()

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
        

class Q3(object):
    def __init__(self, value=None):
        self.root = value

    def remap(self, d):
        root = self.root
        if isinstance(root, Node):
            root.remap(d)
        else:
            self.root = d[root]

    def load(self, stream):
        v = stream.read(1)
        if v == chr(NODE_CODE):
            self.root = Node()
            self.root._load(stream)
        else:
            self.root = v

        rest = stream.read()
        print '-->', len(rest)
        colors = pickle.loads(rest)
        self.remap(colors)
            
    def save(self, stream=None):
        colors = {}
        if isinstance(self.root, Node):
            res = self.root.save(colors, stream=stream)
        else:
            colors[self.root] = 0
            res = chr(0)
            if stream:
                stream.write(res)

        colors = {v: k for k, v in colors.items()}  # inversed key-value pairs
        meta = pickle.dumps(colors)
        if stream:
            stream.write(meta)
        else:
            res += meta
        return res

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


class TestStream(object):
    def write(self, buf):
        for c in buf:
            print >>sys.stderr, ord(c),


if __name__ == '__main__':
    import sys
    from tileid import Tileid
    from random import gauss, choice
    q = Q3()
    #q['qq'] = 1
    print 'q =', q

    d = {}
    #print repr(q.root.save(d)).replace('\\x', ' ')
    deep = 16
    w = 2 ** (deep - 1)
    n = 1000

    print 'Gen {n} in field {size}:\t'.format(size=w * 2, **locals()),
    for i in xrange(n):
        q[Tileid(int(gauss(w, w / 6)), int(gauss(w, w / 6)), deep)] = choice('abcdefghij')

    print 'done'
    print 'Save:\t',
    with open('test.ts', 'wb') as f:
        q.save(stream=f)
    print 'done'

    qq = Q3()
    with open('test.ts', 'rb') as f:
        qq.load(f)

    with open('test2.ts', 'wb') as f:
        qq.save(stream=f)
