"""Where the editor keeps its own files (never inside a project folder)."""

import os
import sys
from pathlib import Path

APP_NAME = 'saktumiva-editor'


def config_dir() -> Path:
    """Recent projects and other preferences."""
    if os.environ.get('SAKTUMIVA_EDITOR_HOME'):
        return Path(os.environ['SAKTUMIVA_EDITOR_HOME']) / 'config'
    if sys.platform == 'win32':
        return Path(os.environ.get('APPDATA') or Path.home() / 'AppData' / 'Roaming') / APP_NAME
    if sys.platform == 'darwin':
        return Path.home() / 'Library' / 'Application Support' / APP_NAME
    return Path(os.environ.get('XDG_CONFIG_HOME') or Path.home() / '.config') / APP_NAME


def cache_dir() -> Path:
    """Alignments the editor has computed, so each passage is collated only once. Safe to delete."""
    if os.environ.get('SAKTUMIVA_EDITOR_HOME'):
        return Path(os.environ['SAKTUMIVA_EDITOR_HOME']) / 'cache'
    if sys.platform == 'win32':
        return Path(os.environ.get('LOCALAPPDATA') or Path.home() / 'AppData' / 'Local') / APP_NAME / 'Cache'
    if sys.platform == 'darwin':
        return Path.home() / 'Library' / 'Caches' / APP_NAME
    return Path(os.environ.get('XDG_CACHE_HOME') or Path.home() / '.cache') / APP_NAME
