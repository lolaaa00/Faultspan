"""Windows compatibility shim for gltest's direct-test runner.

gltest.direct.loader._inject_message_to_fd0 creates a temp file, dup2()s it
onto stdin, then calls os.unlink() on the original path while the fd is
still open via stdin. POSIX allows removing an open file (the inode stays
alive until the last fd closes); Windows does not, and raises
PermissionError: [WinError 32]. This is a bug in the upstream gltest
package (genlayer-test), not in this project's contract or tests -- the
message-injection temp file is unlinked immediately after being duplicated
onto fd 0, so on Windows the unlink always fails.

Until upstream fixes this for Windows, tolerate the specific failure so the
direct-test suite can run cross-platform. Worst case this leaks a handful
of small temp files in the OS temp directory for the process lifetime.
"""

import os

_original_unlink = os.unlink


def _tolerant_unlink(path, *args, **kwargs):
    try:
        _original_unlink(path, *args, **kwargs)
    except PermissionError:
        pass


os.unlink = _tolerant_unlink
