FROM node:22-bookworm

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    bubblewrap \
    curl \
    git \
    gnupg \
    ripgrep \
  && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /etc/apt/keyrings \
  && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    | dd of=/etc/apt/keyrings/githubcli-archive-keyring.gpg \
  && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    > /etc/apt/sources.list.d/github-cli.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends gh \
  && rm -rf /var/lib/apt/lists/*

RUN npm install -g @openai/codex @playwright/test@1.59.1 \
  && playwright install --with-deps chromium \
  && chmod -R 0777 /ms-playwright

WORKDIR /workspace
