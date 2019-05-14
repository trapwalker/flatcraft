
from .vector import Position, Vector, e, pi


class Unit:
    uid: int
    position: Position

    def __init__(self, uid: int, position: Position):
        self.uid = uid
        self.position = position


class Motion:
    t0: float
    p0: Position
    v: Vector

    def __init__(self, t, p0, v=Vector(0)):
        self.t = t
        self.p0 = p0
        self.v = v

    def to_time(self, t, v_new: Vector = None) -> 'Motion':
        v_old = self.v
        return Motion(
            t=t,
            p0=self.p0 + v_old * (t - self.t),
            v=v_old if v_new is None else v_new,
        )

    def intersect(self, m2: 'Motion', r: float):
        m1 = self
        a = m1.p0 - m2.p0 - m1.v * m1.t + m2.v * m2.t
        b = m1.v - m2.v
        # | a + t*b | < r


        # TODO: calc intersection in continuum



class Mobile(Unit):
    motion: Motion = None
