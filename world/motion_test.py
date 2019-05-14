import unittest


class MotionUsage(unittest.TestCase):
    def setUp(self):
        from world.motion import Motion
        from world.vector import Vector, Position

        self.Motion = Motion
        self.Vector = Vector
        self.Position = Position

        self.a  = Motion(t0=0, p0=Position(10, 10))
        self.aa = Motion(t0=0, p0=Position(10, 10))
        self.c  = Motion(t0=0, p0=Position(10, 1), v=Vector(0, 1))
        self.a5 = self.a.to_time(5)
        self.c5 = self.c.to_time(5)

    def test_compare(self):
        self.assertEqual(self.a, self.a, 'Self compare')
        self.assertEqual(self.a, self.aa, 'Same compare')

        self.assertNotEqual(self.a, self.c, 'Not equal compare')
        self.assertNotEqual(self.a, self.a5, 'Time shifted compare')

    def test_intersect(self):
        a = self.a
        c = self.c
        c5 = self.c5
        a5 = self.a5
        tt = (8.0, 10.0)
        self.assertEqual(tt, c.intersect(a, 1), 'Intersection')
        self.assertEqual(tt, a.intersect(c, 1), 'Reversed intersection')
        self.assertEqual(tt, a.intersect(c5, 1), 'Time shifted intersection')
        self.assertEqual(tt, c.intersect(a5, 1), 'Stationary time shifted intersection')


if __name__ == '__main__':
    import sys
    sys.path.append('..')
    unittest.main()
