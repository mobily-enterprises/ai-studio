ARG AI_STUDIO_BASE_IMAGE=ai-studio-base-toolchain:0.1.0
ARG DEBIAN_FRONTEND=noninteractive

FROM ${AI_STUDIO_BASE_IMAGE}
ARG DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    build-essential \
    ccache \
    clang \
    clang-tidy \
    cmake \
    gdb \
    lld \
    make \
    meson \
    ninja-build \
    pkg-config \
  && rm -rf /var/lib/apt/lists/* \
  && c++ --version \
  && cmake --version \
  && ninja --version \
  && make --version \
  && meson --version

WORKDIR /workspace
