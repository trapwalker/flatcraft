
import cmath
from cmath import pi, e


class Vector(complex):
    @classmethod
    def from_polar(cls, r, fi):
        return cls(cmath.rect(r, fi))

    def polar(self):
        return cmath.polar(self)

    @property
    def direction(self):
        return self.polar()[1]

    def angle_to(self, another_vector: 'Vector') -> float:
        return another_vector.direction - self.direction

    def shift_to(self, r: float, fi: float) -> 'Vector':
        return self + Vector.from_polar(r, fi)

    def turn(self, angle: float) -> 'Vector':
        return type(self)(self * e ** (1j * angle))


class Position(Vector):
    def direction_to(self, another_position: 'Position') -> float:
        return (another_position - self).direction

    def dist_to(self, another_position: 'Position') -> float:
        return abs(another_position - self)

    def turn(self, angle: float, around: 'Position' = None) -> 'Vector':
        if around:
            return type(self)((self - around) * e ** (1j * angle) + around)

        return super().turn(angle)
