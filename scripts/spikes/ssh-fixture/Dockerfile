FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl openssh-server procps && \
    useradd --create-home --shell /bin/sh --password '*' agentpanel && \
    mkdir -p /run/sshd /home/agentpanel/project && \
    chown agentpanel:agentpanel /home/agentpanel/project && \
    rm -f /etc/ssh/ssh_host_*key*

# Public official release, checksum pinned independently of the container base.
RUN set -eu; \
    case "$(uname -m)" in \
      aarch64) target=linux-aarch64; sha=b6573137d70baff24fb346c957a9879af6bdc4c641188cdf9e47a7b2a677bc92 ;; \
      x86_64) target=linux-x86_64; sha=58d6861176dc6fe905b58880d5bff07a9959be613a98e5d66b4583b04b6cfa45 ;; \
      *) exit 1 ;; \
    esac; \
    curl --fail --location "https://releases.herdr.dev/core/0.1.16/herdr-core-${target}.tar.gz" -o /tmp/hc.tar.gz; \
    printf '%s  /tmp/hc.tar.gz\n' "$sha" | sha256sum --check -; \
    mkdir /tmp/hc; tar -xzf /tmp/hc.tar.gz -C /tmp/hc; \
    install -m 755 /tmp/hc/herdr-core /usr/local/bin/herdr-core; \
    ln -s /usr/local/bin/herdr-core /usr/local/bin/hc

COPY start.sh /start.sh
ENTRYPOINT ["/bin/sh", "/start.sh"]
