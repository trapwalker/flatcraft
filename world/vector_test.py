import unittest
import cmath


class VectorTestCase(unittest.TestCase):
    def setUp(self):
        from world.vector import Vector, Position
        self.Vector = Vector
        self.Position = Position

    def test_vector_creation(self):
        Vector = self.Vector
        Position = self.Position
        self.assertTrue(cmath.isclose(3 + 5j, Vector(3, 5)), 'Vector is complex')
        self.assertTrue(cmath.isclose(3 + 5j, Position(3, 5)), 'Position is complex')
        self.assertTrue(cmath.isclose(3 + 3j, Vector.from_polar(((9 + 9) ** 0.5), cmath.pi / 4)), 'Vector from polar')


if __name__ == '__main__':
    import sys
    sys.path.append('..')
    unittest.main()
