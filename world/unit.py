
from .vector import Position, Vector, e, pi
from .motion import Motion


class Unit:
    uid: int
    position: Position

    def __init__(self, uid: int, position: Position):
        self.uid = uid
        self.position = position


class Mobile(Unit):
    motion: Motion = None
