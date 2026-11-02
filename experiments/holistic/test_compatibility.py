"""Real CPU graph tests. Requires isolated lock and downloaded public test image."""
import os
from pathlib import Path
import unittest
from scripts.benchmark_holistic import benchmark


@unittest.skipUnless(os.getenv('HOLISTIC_TEST_IMAGE'), 'Set HOLISTIC_TEST_IMAGE in isolated pinned environment')
class RealHolisticCompatibility(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.report = benchmark(Path(os.environ['HOLISTIC_TEST_IMAGE']), frames=30)

    def test_real_graph_counts_and_packing(self):
        r = self.report
        patterns = set(r['landmark_count_patterns'])
        self.assertIn((33,468,21,21), patterns)
        self.assertTrue(patterns <= {(33,468,21,21), (33,0,21,21)})
        self.assertEqual(r['sequence_shape'],[30,1662])
        self.assertEqual(r['dtype'],'float64')
        self.assertTrue(r['all_finite'])
        self.assertTrue(r['named_output_packing_exact'])

    def test_real_blank_image_and_side_alignment(self):
        self.assertTrue(self.report['blank_all_zero'])
        for side in self.report['unmirrored_wrist_diagnostics'].values():
            self.assertLess(side['same_side_distance'], side['opposite_side_distance'])
        self.assertFalse(self.report['contract']['input_mirrored'])
        self.assertFalse(self.report['classifier_trained'])

    def test_measured_cpu_and_assets(self):
        r = self.report
        self.assertGreater(r['latency_ms']['p50'],0)
        self.assertGreaterEqual(r['latency_ms']['p95'],r['latency_ms']['p50'])
        self.assertGreater(r['process_cpu_seconds'],0)
        self.assertGreater(r['max_rss_mib'],0)
        self.assertTrue(any('holistic_landmark_cpu.binarypb' in p for p in r['model_asset_manifest']))


if __name__ == '__main__':
    unittest.main()
