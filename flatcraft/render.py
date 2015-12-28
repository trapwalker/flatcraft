# -*- coding: utf-8 -*-

from itertools import chain
from tileid import Tileid


def test_tile_rect(x1, y1, x2, y2):
    def test(tile, deep):
        x, y, z = tile.xyz()
        delta = deep - z + 1

        t_x1 = x * delta
        t_y1 = y * delta
        t_x2 = (x + 1) * delta
        t_y2 = (y + 1) * delta

        if (x2 < t_x1) or (x1 > t_x2) or (y2 < t_y1) or (y1 > t_y2):
            return 0
        if (x1 > t_x1) and (x2 < t_x2) and (y1 > t_y1) and (y2 < t_y2):
            return 2
        return 1

    return test


def iter_fill(ftest, tile=Tileid(0, 0, 0), deep=16):
    r = ftest(tile, deep)
    if r == 2:
        yield tile
    # rodo: Нужно сделать ограничение максимальной глубины детализации.
    # Если пиксел пересек область заливки, но не попал в неё полностью, нужно его детализировать
    # только если он не глубже заданной максимальной глубины.
    elif r == 1:
        for c in tile.childs():
            for t in iter_fill(ftest, c):
                yield t


if __name__ == '__main__':
    tester = test_tile_rect(100, 100, 200, 200)

    for t in iter_fill(tester):
        print t
        print 
