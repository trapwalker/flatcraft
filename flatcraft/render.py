from itertools import chain
from tileid import Tileid


def test_tile_rect(x1, y1, x2, y2):
    def test(tile, deep):
        delta = deep - tile.z + 1

        t_x1 = tile.x * delta
        t_y1 = tile.y * delta
        t_x2 = (tile.x + 1) * delta
        t_y2 = (tile.y + 1) * delta

        if (x2 < t_x1) or (x1 > t_x2) or (y2 < t_y1) or (y1 > t_y2):
            return 0
        if (x1 > t_x1) and (x2 < t_x2) and (y1 > t_y1) and (y2 < t_y2):
            return 2
        return 1

    return test


def iter_fill(ftest, tile=Tileid(0,0,0), deep=16):
    r = ftest(tile, deep)
    if r == 2:
        yield tile
    elif r == 1:
        chain(
            iter_fill(ftest, tile.childs()),
            iter_fill(ftest, tile.childs()),
            iter_fill(ftest, tile.childs()),
            iter_fill(ftest, tile.childs())
        )