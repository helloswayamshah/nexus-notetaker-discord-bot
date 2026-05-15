# Route modules are imported directly in app/main.py
# This file exists to make the routes directory a proper Python package.
from app.api.routes import orgs, events, artifacts, action_items, platform_links, auth, insights
