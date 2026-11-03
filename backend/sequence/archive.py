"""Strict, lazy ZIP reader preserving full label paths and numeric frame order."""
import io
from pathlib import PurePosixPath
import zipfile
import numpy as np
from .schema import frame, sequence, FRAMES


class SequenceArchive:
    def __init__(self, path):
        self.path = path
        self.index = {}
        with zipfile.ZipFile(path) as z:
            names = set()
            for info in z.infolist():
                name = info.filename
                p = PurePosixPath(name)
                if name in names or p.is_absolute() or '..' in p.parts or '\\' in name:
                    raise ValueError('Duplicate or unsafe ZIP path')
                names.add(name)
                if info.is_dir():
                    continue
                parts = p.parts
                if (len(parts) < 4 or parts[0] != 'MP_Data' or p.suffix != '.npy'
                        or not parts[-2].isdigit() or not p.stem.isdigit()):
                    raise ValueError(f'Unexpected member: {name}')
                if info.file_size > 1024 * 1024:
                    raise ValueError('Oversized NPY member')
                # Keep raw sequence IDs; reject numerical aliases instead of merging.
                if parts[-2] != str(int(parts[-2])) or p.stem != str(int(p.stem)):
                    raise ValueError('Noncanonical numeric sequence/frame ID')
                key = ('/'.join(parts[1:-2]), parts[-2])
                frames = self.index.setdefault(key, {})
                i = int(p.stem)
                if i in frames:
                    raise ValueError('Duplicate frame index')
                frames[i] = name
        if not self.index:
            raise ValueError('Empty sequence archive')
        for frames in self.index.values():
            if sorted(frames) != list(range(FRAMES)):
                raise ValueError('Sequence must contain exactly frame indices 0–29')

    def read(self, label, sequence_id):
        with zipfile.ZipFile(self.path) as z:
            return self._read(z, self.index[(label, str(sequence_id))])

    @staticmethod
    def _read(z, members):
        arrays = [frame(np.load(io.BytesIO(z.read(members[i])), allow_pickle=False))
                  for i in range(FRAMES)]
        return sequence(np.stack(arrays))

    def iter_sequences(self):
        # Keep one central directory in memory; one sequence array at a time.
        with zipfile.ZipFile(self.path) as z:
            for key in sorted(self.index, key=lambda k: (k[0], int(k[1]))):
                yield key, self._read(z, self.index[key])
