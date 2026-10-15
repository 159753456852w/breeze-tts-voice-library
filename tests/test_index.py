"""Focused integrity checks for filenames, missing metadata and immutable audio."""
import importlib.util
import json
from pathlib import Path
import struct
import tempfile
import unittest
from urllib.parse import unquote

spec = importlib.util.spec_from_file_location("indexer", Path(__file__).resolve().parents[1] / "scripts/generate_voice_index.py")
indexer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(indexer)


class IndexTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        (self.root / 'output').mkdir()
        (self.root / 'metadata').mkdir()
        self.name = '聲音 A #7.wav'
        samples = struct.pack('<4f', .1, -.2, .3, -.1)
        fmt = struct.pack('<HHIIHH', 3, 1, 24000, 96000, 4, 32)
        chunks = b'fmt ' + struct.pack('<I', len(fmt)) + fmt + b'data' + struct.pack('<I', len(samples)) + samples
        (self.root / 'output' / self.name).write_bytes(b'RIFF' + struct.pack('<I', len(chunks)+4) + b'WAVE' + chunks)

    def tearDown(self):
        self.temp.cleanup()

    def test_actual_arbitrary_filename_and_metadata_fallback(self):
        before = (self.root/'output'/self.name).read_bytes()
        row = indexer.build_index(self.root, 1)['voices'][0]
        self.assertEqual(row['filename'], self.name)
        self.assertEqual(unquote(row['audio']), 'output/'+self.name)
        self.assertEqual(row['description'], '尚未提供聲音描述。')
        self.assertEqual((self.root/'output'/self.name).read_bytes(), before)

    def test_missing_audio_fails_count_check(self):
        with self.assertRaisesRegex(ValueError, 'Expected 2 WAVs'):
            indexer.build_index(self.root, 2)

    def test_changed_original_audio_is_rejected(self):
        manifest = [{'filename':self.name, 'sha256':'incorrect', 'bytes':(self.root/'output'/self.name).stat().st_size}]
        (self.root/'metadata/audio-manifest.json').write_text(json.dumps(manifest), encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'Original WAV changed'):
            indexer.build_index(self.root, 1)

    def test_lfs_pointer_or_truncated_wav_is_rejected(self):
        (self.root/'output'/self.name).write_text('version https://git-lfs.github.com/spec/v1', encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'Not a RIFF WAV'):
            indexer.build_index(self.root, 1)


if __name__ == '__main__':
    unittest.main()
