"""Recoverable single-writer snapshots and CSV exports.

The snapshot is the commit point. CSV suffixes are journaled with their original
byte offsets, so recovery can replay them without counting a trade twice.
Run one engine process per DATA_DIR; the lock protects dashboard threads only.
"""
import copy
import csv
import io
import json
import os
import tempfile
import threading
from contextlib import contextmanager


class PersistenceError(RuntimeError):
    pass


def atomic_write(path, data):
    directory = os.path.dirname(os.path.abspath(path))
    fd, temporary = tempfile.mkstemp(prefix='.write-', dir=directory)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        directory_fd = os.open(directory, os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


class SnapshotStore:
    def __init__(self, state_file, lock=None):
        self.path = state_file
        self.directory = os.path.dirname(os.path.abspath(state_file))
        self.lock = lock or threading.RLock()
        self.local = threading.local()

    def _write_state(self, state):
        atomic_write(self.path, json.dumps(state, indent=2, allow_nan=False).encode())

    def _recover(self, state):
        pending = state.get('_pending_csv', {})
        for name, item in pending.items():
            if name != os.path.basename(name):
                raise PersistenceError('Invalid CSV journal path')
            path = os.path.join(self.directory, name)
            previous = open_bytes(path)
            if len(previous) < item['offset']:
                raise PersistenceError(f'CSV was truncated: {name}')
            atomic_write(path, previous[:item['offset']] + item['suffix'].encode())
        if pending:
            state.pop('_pending_csv')
            self._write_state(state)
        return state

    def load(self):
        with self.lock:
            try:
                with open(self.path, encoding='utf-8') as stream:
                    state = json.load(stream)
                if not isinstance(state, dict):
                    raise ValueError('Snapshot must be an object')
                return self._recover(state)
            except FileNotFoundError:
                # Missing exports during recovery are not a missing snapshot.
                if os.path.exists(self.path):
                    raise PersistenceError('Snapshot recovery failed')
                return None
            except (OSError, ValueError, TypeError, KeyError) as exc:
                raise PersistenceError('Cannot load state; refusing to reset accounts') from exc

    def save(self, state, rows=()):
        with self.lock:
            try:
                pending = {}
                grouped = {}
                for path, row, columns in rows:
                    grouped.setdefault(path, []).append((row, columns))
                for path, entries in grouped.items():
                    previous = open_bytes(path)
                    columns = entries[0][1]
                    if previous:
                        header = next(csv.reader(io.StringIO(previous.decode('utf-8'))))
                        if header != list(columns):
                            raise ValueError(f'CSV schema mismatch: {path}')
                    stream = io.StringIO(newline='')
                    writer = csv.DictWriter(stream, fieldnames=columns)
                    if not previous:
                        writer.writeheader()
                    for row, row_columns in entries:
                        if row_columns != columns:
                            raise ValueError('Mixed CSV schemas in a transaction')
                        writer.writerow(row)
                    pending[os.path.basename(path)] = {'offset': len(previous), 'suffix': stream.getvalue()}
                snapshot = copy.deepcopy(state)
                if pending:
                    snapshot['_pending_csv'] = pending
                self._write_state(snapshot)
                self._recover(snapshot)
            except (OSError, ValueError, TypeError, KeyError) as exc:
                raise PersistenceError('Commit/export failed; restart to recover the snapshot') from exc

    def append(self, path, row, columns):
        if not hasattr(self.local, 'rows'):
            raise PersistenceError('CSV writes require a state transaction')
        self.local.rows.append((path, copy.deepcopy(row), list(columns)))

    @contextmanager
    def transaction(self, state):
        with self.lock:
            if hasattr(self.local, 'rows'):
                yield
                return
            before = copy.deepcopy(state)
            self.local.rows = []
            try:
                try:
                    yield
                except BaseException:
                    state.clear()
                    state.update(before)
                    raise
                self.save(state, self.local.rows)
            finally:
                del self.local.rows


def open_bytes(path):
    try:
        with open(path, 'rb') as stream:
            return stream.read()
    except FileNotFoundError:
        return b''
