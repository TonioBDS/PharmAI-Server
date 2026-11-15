# Image de l'app Home Assistant : l'image publiée du serveur, avec les réglages propres à HA.
# Le Supervisor passe BUILD_VERSION (= version de config.yaml) : on prend l'image de cette version.
ARG BUILD_VERSION=latest
FROM ghcr.io/toniobds/pharmai-server:${BUILD_VERSION}

ARG BUILD_VERSION
# /data appartient à root dans Home Assistant : le serveur y écrit sa base pharmai.db
USER root
# Options saisies dans l'interface de Home Assistant
ENV OPTIONS_FILE=/data/options.json

LABEL \
  io.hass.version="${BUILD_VERSION}" \
  io.hass.type="app" \
  io.hass.arch="aarch64|amd64" \
  org.opencontainers.image.title="Home Assistant App: PharmAI Server" \
  org.opencontainers.image.source="https://github.com/TonioBDS/PharmAI-Server" \
  org.opencontainers.image.licenses="AGPL-3.0-only"
