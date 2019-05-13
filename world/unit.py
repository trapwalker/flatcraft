
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
    direction: float
    velocity: float

    def __init__(self, time, start_position, direction, velocity):
        self.time = time
        self.start_position = start_position
        self.direction = direction
        self.velocity = velocity

    def to_time(self, t, new_direction: float = None, new_velocity: float = None) -> 'Motion':
        old_direction = self.direction
        old_velocity = self.velocity
        return Motion(
            time=t,
            start_position=self.start_position + Vector.from_polar(old_velocity * (t - self.time), old_direction),
            direction=old_direction if new_direction is None else new_direction,
            velocity=old_velocity if new_velocity is None else new_velocity,
        )


class Mobile(Unit):
    motion: Motion = None
