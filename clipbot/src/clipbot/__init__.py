import os as _os

__version__ = "0.2.2"

# Notices from the model downloader that need no action from the user.
_os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
_os.environ.setdefault("HF_HUB_VERBOSITY", "error")
_os.environ.setdefault("HF_HUB_DISABLE_IMPLICIT_TOKEN", "1")
