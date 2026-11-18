from contextlib import contextmanager
import os
from tempfile import TemporaryDirectory


# Helper context manager to create a list of files in a temporary directory - a file's path is a tuple of its path's
# names, and its content is text or bytes
@contextmanager
def create_test_files(file_defs):
    tempdir = TemporaryDirectory()
    try:
        for path_parts, content in file_defs:
            path = os.path.join(tempdir.name, *path_parts)
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, 'wb') as file_:
                file_.write(content.encode('utf-8') if isinstance(content, str) else content)
        yield os.path.realpath(tempdir.name)
    finally:
        tempdir.cleanup()
