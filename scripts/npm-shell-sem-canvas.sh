#!/bin/sh
# Usado somente na instalação de compatibilidade em Linux.
# npm mantém os scripts de todos os outros pacotes no shell padrão.
if [ "$DISABLE_CANVAS" = "true" ] && [ "$npm_package_name" = "canvas" ] && [ "$npm_lifecycle_event" = "install" ]; then
  echo '[compatibilidade] Canvas: instalação nativa omitida explicitamente (DISABLE_CANVAS=true).' >&2
  exit 0
fi
exec /bin/sh "$@"
