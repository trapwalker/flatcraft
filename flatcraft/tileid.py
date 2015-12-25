# -*- coding: utf-8 -*-


class ETileException(Exception):
    pass


QRTS = 'qrts'
QRTS2BIN = dict(zip('qrtsQRTS', range(4) * 2))
ROOTBIN = 0b11  # зависит от метода представления тайла в памяти


def bin2str(binary):  # зависит от метода представл ения тайла в памяти
    u"""Преобразование бинарного представления индекса тайла в qrts-строку"""
    s = ''
    x = int(binary)
    while x > 0b11:
        s += QRTS[x & 0b11]
        x >>= 2
    if x != 0b11:
        raise ETileException(
            u'Некорректный бинарный формат индекса тайла: {}'.format(bin(binary)))
    return s


def str2bin(string):  #
    u"""Преобразование qrts-строки в бинарное представление индекса тайла.
    Зависит от метода представления тайла в памяти.
    """
    s = string.lower()
    x = 0b11
    try:
        for i in reversed(s):
            x = (x << 2) | QRTS2BIN[i]
    except:
        raise ETileException(
            u'Некорректный текстовый qrts-формат индекса тайла: {}'.format(string))
    return x


def bin2xyz(binary):
    u"""
    Преобразование бинарного представления индекса тайла в кортеж (x, y, zoom).
    Зависит от метода представления тайла в памяти.
    """
    b = int(binary)
    x = y = z = 0
    while b > 0b11:
        x = x * 2 + (1 if b & 0b01 else 0)
        y = y * 2 + (1 if b & 0b10 else 0)
        z += 1
        b >>= 2
    if b != 0b11:
        raise ETileException(
            u'Некорректный бинарный формат индекса тайла: {}'.format(bin(binary)))
    return x, y, z


def xyz2bin(x, y, z):
    u"""
    Преобразование кортежа (x, y, zoom) в бинарное представление индекса тайла.
    Зависит от метода представления тайла в памяти.
    """
    b = 0b11
    for i in xrange(z):
        b <<= 1
        b |= y & 1
        b <<= 1
        b |= x & 1
        y >>= 1
        x >>= 1
    return b


def iterbin(binary):  # зависит от метода представления тайла в памяти
    b = int(binary)
    while b > 0b11:
        yield int(b & 0b11)
        b >>= 2
    assert b == 0b11, u'Некорректный бинарный формат индекса; {}'.format(bin(binary))


def iter2bin(itr):  # зависит от метода представления тайла в памяти
    shift = 0
    t = 0
    for i in itr:
        assert 0 <= i < 4, u'Некорректный список для инициализации индекса тайла: {}'.format(itr)
        t |= (0b11 & i) << shift
        shift += 2
    t |= 0b11 << shift
    return int(t)


class Tileid(long):
    u"""
    Индекс тайла.
    Представляется в виде бинарной qrts-последовательности,
    финализируемой двумя старшими незначащими единичными разрядами.
    Индекс в бинарном формате должен соответствовать регекспу:
    "0b11([01][01])*"
    """

    def __new__(cls, *args):
        if len(args) == 0:
            return long.__new__(cls, ROOTBIN)

        elif len(args) == 3:
            return long.__new__(cls, xyz2bin(*args))

        elif len(args) == 1:
            arg = args[0]
            if isinstance(arg, Tileid):
                return arg

            if arg is None:
                return long.__new__(cls, ROOTBIN)

            if isinstance(arg, (int, long)):
                bitlen = arg.bit_length()  # int.bit_length python 2.5 incompatible
                assert (((bitlen % 2) == 0) and (bitlen >= 2) and (arg >> bitlen - 2 == 3)), \
                    u'Incorrect binary tile id format: {}'.format(bin(arg))
                return long.__new__(cls, arg)

            if isinstance(arg, basestring):
                return long.__new__(cls, str2bin(arg))

            # todo: use collections.Iterable
            if hasattr(arg, '__getitem__') or hasattr(arg, 'next') or hasattr(arg, '__iter__'):
                return long.__new__(cls, iter2bin(arg))

        raise ETileException(u'''Некорректный набор параметров "{!r}".
            Ожидается: <qrts_bin>|<qrts_str>|(x, y, z)|<list>|<Tileid>
            где: qrts_bin -- int; qrts_str -- str;
            (x, y, z) -- tuple of three int
            <list> -- qrts-путь -- список с элементами 0..3
            <Tileid> -- объект типа Tileid'''.format(args))

    def isroot(self):
        return self == ROOTBIN

    def parent(self, levelup=1):
        u"""
        Возвращает предка на levelup уровней выше.
        При попытке получить предка корня генерируется исключение.
        Зависит от метода представления тайла в памяти.
        """
        z = self.zoom()
        assert 0 <= levelup <= z, u'Некорректно указан относительный уровень предка.'
        mask = 2 ** ((z - levelup) * 2) - 1
        return Tileid((self & mask) | (0b11 << ((z - levelup) * 2)))

    def child(self, *args):
        u"""
        Возвращает определйнного аргументом child потомка.
        child может быть индексом потомка (int), списком индексов [0,1,2,3],
        строкой 'qrts'. В случае строки или списка потомки берутся по цепочке вниз.
        Зависит от метода представления тайла в памяти.
        """
        if len(args) == 1:
            child = args[0]
            if isinstance(child, (int, long)) and not isinstance(child, Tileid):
                child = [child]
            elif isinstance(child, basestring):
                child = Tileid(child)

            if isinstance(child, list):
                child = Tileid(child)

            if isinstance(child, Tileid):
                return Tileid(self & (2 ** (self.zoom() * 2) - 1) | (child << (self.zoom() * 2)))
        elif len(args) == 3:
            return self.child(Tileid(*args))
        else:
            raise Exception(u'Некорректный набор параметров: {!r}'.format(args))

    def childs(self, level=1):
        u"""Итератор, перечисляющий всех потомков на уровне level вниз от текущего."""
        assert isinstance(level, int) and level >= 0, \
            u'Некорректное значение аргумента level: {}'.format(level)
        size = 2 ** level
        for y in xrange(size):
            for x in xrange(size):
                yield self.child(Tileid(x, y, level))

    def qrts(self):
        u"""Представление индекса в виде qrts-строки."""
        if not hasattr(self, '_qrts'):
            #noinspection PyAttributeOutsideInit
            self._qrts = bin2str(self)
        return self._qrts

    def xyz(self):
        u"""Представление индекса в виде кортежа (x, y, zoom)."""
        if not hasattr(self, '_x'):
            #noinspection PyAttributeOutsideInit
            self._x, self._y, self._z = bin2xyz(self)
        return self._x, self._y, self._z

    def zoom(self):
        u"""Возвращает масштаб тайла."""
        if not hasattr(self, '_z'):
            #noinspection PyAttributeOutsideInit
            self._x, self._y, self._z = bin2xyz(self)
        return self._z

    def __mod__(self, depth):
        u"""Возвращает хвост пути длиной depth."""
        return Tileid(self[-depth:])

    def __getitem__(self, idx):
        u"""
        @param slice|int idx: Index or slice for get item or subset of tileid
        """
        if isinstance(idx, slice):
            return list(self)[idx]
        zoom = self.zoom()
        if idx < 0:
            idx = zoom + idx
        if idx >= zoom:
            raise IndexError(u'Tileid path index {} is out of range [0-{})'.format(idx, zoom))
        return int((self >> (idx * 2)) & 0b11)

    def __reversed__(self):
        i = self.zoom() - 1
        while i >= 0:
            yield int((self >> (i * 2)) & 0b11)
            i -= 1

    __len__ = zoom
    __iter__ = iterbin

    def __repr__(self):
        return r'Tileid{!r}'.format(self.xyz())

    def __str__(self):
        return self.qrts()


ROOT = Tileid()
##############################################################################
if __name__ == '__main__':
    from pytile import test_tileid
    test_tileid.test_main()
