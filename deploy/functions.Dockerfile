# The edge functions as the server runs them: Orbit's functions, upstream's router (`main`), and
# every module they import already downloaded, so the runtime fetches nothing when it starts. Some
# networks cannot reach jsr.io or npm (Cloudflare) -- on 2026-10-18 a server's downloads from both
# stalled after the first kilobytes, and the functions never started.
#
# Built from the directory `deploy/orbit assemble-functions <dir>` writes, never from the
# repository: CI for each commit on main (publish-self-hosted-images in .github/workflows/main.yml),
# or the server itself when there is no image to pull (deploy/orbit, ensure_functions_image).

# deploy/orbit passes the runtime upstream pins; the default only names the kind of image it is.
ARG EDGE_RUNTIME_IMAGE=supabase/edge-runtime:v1.77.4
FROM ${EDGE_RUNTIME_IMAGE}

COPY functions /home/deno/functions
COPY db /home/deno/db
COPY warm.sh /usr/local/lib/orbit/warm-functions.sh
# The runtime keeps what a worker's first start downloads in /root/.cache/deno, so starting each
# function once here leaves all of it in the image.
RUN bash /usr/local/lib/orbit/warm-functions.sh
