import unittest
import math
import timeit


def lstrip_code_block(text: str):
    left_pad = len(text) - len(text.lstrip())
    return '\n'.join(s[left_pad:] for s in text.split('\n'))


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
        self.d  = Motion(t0=0, p0=Position( 8, 1), v=Vector(0, 1))
        self.a5 = self.a.to_time(5)
        self.c5 = self.c.to_time(5)

    def test_compare(self):
        self.assertEqual(self.a, self.a, 'Self compare')
        self.assertEqual(self.a, self.aa, 'Same compare')
        self.assertEqual(self.a, self.a.to_time(self.a.t0), 'Zero time shifted immobility')
        self.assertEqual(self.c, self.c.to_time(self.c.t0), 'Zero time shifted motion')

        self.assertNotEqual(self.a, self.c, 'Not equal compare')
        self.assertNotEqual(self.a, self.a5, 'Time shifted compare')

    def test_intersect(self):
        a = self.a
        c = self.c
        d = self.d
        c5 = self.c5
        a5 = self.a5
        Vector = self.Vector
        self.assertEqual((8.0, 10.0), c.intersect(a, 1), 'Intersection')
        self.assertEqual((8.0, 10.0), a.intersect(c, 1), 'Reversed intersection')
        self.assertEqual((8.0, 10.0), a.intersect(c5, 1), 'Time shifted intersection')
        self.assertEqual((8.0, 10.0), c.intersect(a5, 1), 'Stationary time shifted intersection')
        self.assertEqual((None, 10.0), c.to_time(8.5).intersect(a5, 1), 'Motion started in')
        self.assertEqual((None, None), c.to_time(11.5).intersect(a5, 1), 'Motion started after')
        self.assertEqual((None, None), d.intersect(a, 2), 'Motion tangentially is not intersect')

        subtangential_intersection = d.intersect(a.to_time(a.t0, v=Vector(-1e-10, 0)), 2)
        self.assertNotEqual((None, None), subtangential_intersection, 'Motion subtangentially is intersect')
        self.assertTrue(math.isclose(*subtangential_intersection, rel_tol=1e-4), 'Subtangential intersection times is too close')
        self.assertFalse(math.isclose(*subtangential_intersection, rel_tol=1e-5), 'Subtangential intersection times is too close, but not absolutely')

        task_size = 100_000
        task_time = timeit.timeit(
            lstrip_code_block("""\
                Motion(
                    t0=0, 
                    p0=Position(8, 1), 
                    v=Vector(0, 1),
                ).intersect(
                    Motion(t0=0, p0=Position(10, 10)).to_time(0, v=Vector(-1e-10, 0)), 
                    r=2,
                )
            """),
            lstrip_code_block("""\
                import sys
                sys.path.append('..')
                from world.motion import Motion
                from world.vector import Vector, Position
            """),
            number=task_size,
        )
        print(f'Calc {task_size} intersection over {task_time:.3f}s')


if __name__ == '__main__':
    import sys
    sys.path.append('..')
    unittest.main()
