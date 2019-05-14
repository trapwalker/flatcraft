import unittest


class MotionUsage(unittest.TestCase):
    def setUp(self):
        from world.motion import Motion
        from world.vector import Vector, Position

        self.a  = Motion(t0=0, p0=Position(10, 10))
        self.aa = Motion(t0=0, p0=Position(10, 10))
        self.c  = Motion(t0=0, p0=Position(10, 1), v=Vector(0, 1))

    def test_comparsion(self):
        self.assertEqual(self.a, self.a)
        self.assertNotEqual(self.a, self.c)

    def test_intersection(self):
        self.assertEqual(
            self.c.intersect(self.a, 1),
            self.a.intersect(self.c, 1)
        )
        print(self.c.intersect(self.a, 1))


if __name__ == '__main__':
    import sys
    sys.path.append('..')
    unittest.main()
