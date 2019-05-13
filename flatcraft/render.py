# -*- coding: utf-8 -*-

from itertools import chain
from tileid import Tileid

'''
def get_coord(tid, deep):
    u"""Возвращает координаты тайла на плоскости"""
    x, y, z = tid.xyz()
    step = 2 ** (deep - z)
    x0 = x * step
    y0 = y * step
    return x0, y0, step
#'''


def test_tile_rect(x1, y1, x2, y2):
    assert x1 <= x2 and y1 <= y2
    def test(tile, deep):
        #print 'test', repr(tile), repr(deep)
        ax, ay, bx, by = tile.get_deep_rect(deep)

        if (x2 < ax) or (x1 > bx) or (y2 < ay) or (y1 > by):
            return 0
        if (x1 <= ax) and (x2 >= bx) and (y1 <= ay) and (y2 >= by):
            return 2
        return 1

    return test


def iter_fill(ftest, tile=Tileid(0, 0, 0), deep=4):
    r = ftest(tile, deep)
    if r == 2:
        yield tile
    # rodo: Нужно сделать ограничение максимальной глубины детализации.
    # Если пиксел пересек область заливки, но не попал в неё полностью, нужно его детализировать
    # только если он не глубже заданной максимальной глубины.
    elif r == 1 and tile.z() < deep:        
        for c in tile.childs():
            for t in iter_fill(ftest, c):
                yield t


if __name__ == '__main__':
    tester = test_tile_rect(10, 10, 20, 20)

    for t in iter_fill(tester):
        print repr(t)
