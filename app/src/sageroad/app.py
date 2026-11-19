"""
The SageRoad back-end application
"""

import ctypes
import importlib.resources
import os
import pathlib
import platform

import chisel


# The SageRoad back-end WSGI application class - it serves the front end: "static_dir" is its directory (the
# package's, by default) - and this computer's system information, which a browser can't know. The front end does the
# rest in the browser - it opens and saves the user's files, plans a road with the planning tools, and asks Ollama.
class SageRoad(chisel.Application):
    __slots__ = ()


    def __init__(self, static_dir=None):
        super().__init__()

        # Back-end documentation, and the system information
        self.add_requests(chisel.create_doc_requests())
        self.add_request(get_system_info)

        # Front-end statics - the application's page is the root URL's
        static = importlib.resources.files('sageroad').joinpath('static') if static_dir is None else pathlib.Path(static_dir)
        for name, content in sorted(_static_files(static, '')):
            urls = [('GET', f'/{name}')]
            if name == 'index.html':
                urls.append(('GET', '/'))
            self.add_request(chisel.StaticRequest(name, content, urls=urls))


# Get a directory's files - their names (with their directories', from the directory) and their contents
def _static_files(directory, prefix):
    if directory.is_dir():
        for entry in directory.iterdir():
            if entry.is_dir():
                yield from _static_files(entry, f'{prefix}{entry.name}/')
            else:
                yield f'{prefix}{entry.name}', entry.read_bytes()


# The system information action - the models to download that this computer can run are its "compatible" models
@chisel.action(name='getSystemInfo', spec='''
group "SageRoad"

# Get this computer's system information
action getSystemInfo
    urls
        GET

    output
        # The total memory, in bytes, or -1 if it can't be determined
        int memory

        # If true, the computer runs MLX models - it's a Mac with Apple silicon
        bool mlx
''')
def get_system_info(unused_ctx, unused_req):
    return {
        'memory': _total_memory(),
        'mlx': platform.system() == 'Darwin' and platform.machine() == 'arm64'
    }


# Get the total memory, in bytes - -1 if it can't be determined
def _total_memory():
    if platform.system() == 'Windows':
        memory_status = MEMORYSTATUSEX()
        memory_status.dwLength = ctypes.sizeof(MEMORYSTATUSEX) # pylint: disable=invalid-name,attribute-defined-outside-init
        ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(memory_status))
        return memory_status.ullTotalPhys
    phys_pages = os.sysconf('SC_PHYS_PAGES') # pylint: disable=no-member,useless-suppression
    page_size = os.sysconf('SC_PAGE_SIZE') # pylint: disable=no-member,useless-suppression
    return phys_pages * page_size if phys_pages > 0 and page_size > 0 else -1


# Windows' memory status structure
class MEMORYSTATUSEX(ctypes.Structure):
    _fields_ = [
        ('dwLength', ctypes.c_uint),
        ('dwMemoryLoad', ctypes.c_uint),
        ('ullTotalPhys', ctypes.c_ulonglong),
        ('ullAvailPhys', ctypes.c_ulonglong),
        ('ullTotalPageFile', ctypes.c_ulonglong),
        ('ullAvailPageFile', ctypes.c_ulonglong),
        ('ullTotalVirtual', ctypes.c_ulonglong),
        ('ullAvailVirtual', ctypes.c_ulonglong),
        ('sullAvailExtendedVirtual', ctypes.c_ulonglong)
    ]
