
from cmath import pi, e, rect, polar


class Vector(complex):
    x = complex.real
    y = complex.imag

    @classmethod
    def from_polar(cls, r, fi):
        return cls(rect(r, fi))

    def polar(self):
        return polar(self)

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


__ALL__ = [pi, e, Vector, Position]
