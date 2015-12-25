from collections import Counter

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

    def write2stream(self, stream, colors):
        stream.write(chr(0xff))
        for item in self:
            if isinstance(item, Node):
                item.write2stream(stream, colors)
            else:
                code = colors.get(item)
                if code is None:
                    code = max(colors.values() + [-1]) + 1
                    colors[item] = code
                stream.write(chr(code))

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
    q = Q3()
    q['qq'] = 1
    print 'q =', q

    d = {}
    q.root.write2stream(TestStream(), d)
