
from .vector import Position, Vector
from math import sqrt
from typing import NamedTuple


class Motion(NamedTuple):
    t0: float
    p0: Position
    v: Vector = Vector(0)

    # def __init__(self, t0, p0, v=Vector(0)):
    #     self.t0 = t0
    #     self.p0 = p0
    #     self.v = v

    def to_time(self, t, v_new: Vector = None) -> 'Motion':
        v_old = self.v
        return Motion(
            t0=t,
            p0=self.p0 + v_old * (t - self.t0),
            v=v_old if v_new is None else v_new,
        )

    def intersect(self, m2: 'Motion', r: float):
        m1 = self
        a: complex = m1.p0 - m2.p0 - m1.v * m1.t0 + m2.v * m2.t0
        b: complex = m1.v - m2.v
        # | a + t*b | < r
        aa = b.real ** 2 + b.imag ** 2
        bb = 2 * (a.real * b.real + a.imag * b.imag)
        cc = a.real ** 2 + a.imag ** 2 - r ** 2
        dd = bb ** 2 - 4 * aa * cc
        if dd <= 0:
            # No motion double intersects with radius r
            return

        dd = sqrt(dd)

        t1 = (-bb - dd) / (2 * aa)
        t2 = (-bb + dd) / (2 * aa)
        return t1, t2
