import logging
from .api import make_app
logging.basicConfig(level=logging.INFO,format="%(message)s")
app=make_app()
