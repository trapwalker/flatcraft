
from .vector import Position, Vector
from typing import NamedTuple


class Motion(NamedTuple):
    t0: float
    p0: Position
    v: Vector = Vector(0)

    def to_time(self, t, *, v: Vector = None) -> 'Motion':
        v_old = self.v
        return Motion(
            t0=t,
            p0=self.p0 + v_old * (t - self.t0),
            v=v_old if v is None else v,
        )

    def intersect(self, m2: 'Motion', r: float):
        m1 = self
        a: complex = m1.p0 - m2.p0 - m1.v * m1.t0 + m2.v * m2.t0
        b: complex = m1.v - m2.v
        # | a + t*b | < r
        # aa * t ** 2 + bb * t + cc == 0
        aa = b.real ** 2 + b.imag ** 2
        bb = 2 * (a.real * b.real + a.imag * b.imag)
        cc = a.real ** 2 + a.imag ** 2 - r ** 2
        dd = bb ** 2 - 4 * aa * cc
        if dd <= 0:
            # No motion double intersects with radius r
            return None, None

        dd = dd ** 0.5

        early_time = max(m1.t0, m2.t0)
        t1 = (-bb - dd) / (2 * aa)
        t2 = (-bb + dd) / (2 * aa)
        # Drop the time if it was earlier than most late starting of motion
        # we are do not known what was happens before then late motion starts
        return (
            t1 if t1 >= early_time else None,
            t2 if t2 >= early_time else None,
        )
