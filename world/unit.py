
from .vector import Position, Vector, e, pi


class Unit:
    uid: int
    position: Position

    def __init__(self, uid: int, position: Position):
        self.uid = uid
        self.position = position


class Motion:
    time: float
    start_position: Position
    velocity: Vector

    def __init__(self, time, start_position, velocity=Vector(0)):
        self.time = time
        self.start_position = start_position
        self.velocity = velocity

    def to_time(self, t, new_velocity: Vector = None) -> 'Motion':
        old_velocity = self.velocity
        return Motion(
            time=t,
            start_position=self.start_position + old_velocity * (t - self.time),
            velocity=old_velocity if new_velocity is None else new_velocity,
        )

    def intersect(self, m2: 'Motion', r: float):
        s = self.start_position - m2.start_position
        v = self.velocity - m2.velocity
        # TODO: calc intersection in continuum



class Mobile(Unit):
    motion: Motion = None
