<script setup>
import { onMounted, onBeforeUnmount } from 'vue';
import AppDemo from '../components/AppDemo.vue';

import GitHubIcon from '../compAst/icons/Brand/GitHub.vue';
import ConnectionsIcon from '../compAst/icons/Connections.vue';
import FolderIcon from '../compAst/icons/Folder.vue';
import EditLinesIcon from '../compAst/icons/EditLines.vue';
import CubeIcon from '../compAst/icons/Cube.vue';
import GlobusIcon from '../compAst/icons/Globus.vue';
import BranchIcon from '../compAst/icons/Branch.vue';
import KeyChainIcon from '../compAst/icons/KeyChain.vue';
import LockIcon from '../compAst/icons/Lock.vue';

// Point these at the real repository / release assets before shipping.
const REPO = 'https://github.com/andrey-astetik/SSHtorm';
const RELEASES = `${REPO}/releases/latest`;

let observer;
onMounted(() => {
    observer = new IntersectionObserver((entries) => {
        for (const e of entries) {
            if (e.isIntersecting) { e.target.classList.add('in'); observer.unobserve(e.target); }
        }
    }, { threshold: 0.12 });
    document.querySelectorAll('.reveal').forEach((el) => observer.observe(el));
});
onBeforeUnmount(() => observer && observer.disconnect());
</script>

<template>
    <div class="min-h-full">
        <!-- Nav -->
        <header class="sticky top-0 z-30 backdrop-blur-md bg-[color-mix(in_srgb,var(--crust)_78%,transparent)] border-b border-[var(--surface0)]">
            <div class="mx-auto max-w-6xl px-5 h-15 py-3.5 flex items-center justify-between">
                <a href="#top" class="flex items-center gap-2 font-semibold tracking-tight">
                    <span class="grid place-items-center w-7 h-7 rounded-lg bg-[var(--base)] border border-[var(--surface0)] font-mono text-[var(--blue)]">&gt;_</span>
                    SSHtorm
                </a>
                <nav class="flex items-center gap-6 text-sm c-sub">
                    <a href="#features" class="hidden sm:inline hover:text-[var(--text)] transition-colors">Features</a>
                    <a href="#security" class="hidden sm:inline hover:text-[var(--text)] transition-colors">Security</a>
                    <a :href="REPO" class="hover:text-[var(--text)] transition-colors inline-flex items-center gap-1.5">
                        <GitHubIcon size="1.05em" /> GitHub
                    </a>
                    <a :href="RELEASES" class="rounded-lg bg-[var(--blue)] text-[var(--crust)] font-medium px-3.5 py-1.5 hover:opacity-90 transition-opacity">Download</a>
                </nav>
            </div>
        </header>

        <main id="top">
            <!-- Hero -->
            <section class="relative overflow-hidden">
                <div class="pointer-events-none absolute inset-0 hero-glow"></div>
                <div class="pointer-events-none absolute inset-0 grid-bg opacity-60"></div>

                <div class="relative mx-auto max-w-6xl px-5 pt-20 sm:pt-28 pb-16 text-center">
                    <h1 class="text-4xl sm:text-6xl font-bold tracking-tight leading-[1.05]">
                        Every tool for your server.<br />
                        <span class="text-[var(--blue)]">One SSH session.</span>
                    </h1>

                    <p class="mx-auto mt-6 max-w-2xl text-lg c-sub leading-relaxed">
                        Terminal, SFTP file browser, editor, Docker and a tunnelled browser — in one
                        window, each tied to the connection. Everything runs over SSH/SFTP on the
                        client side, so nothing is installed on the server.
                    </p>

                    <div class="mt-9 flex flex-wrap items-center justify-center gap-3">
                        <a :href="RELEASES" class="rounded-lg bg-[var(--blue)] text-[var(--crust)] font-semibold px-5 py-2.5 hover:opacity-90 transition-opacity">
                            Download
                        </a>
                        <a :href="REPO" class="inline-flex items-center gap-2 rounded-lg border border-[var(--surface1)] px-5 py-2.5 font-medium hover:bg-[var(--base)] transition-colors">
                            <GitHubIcon size="1.15em" /> View source
                        </a>
                    </div>

                    <!-- Animated app demo -->
                    <div class="reveal mt-16 mx-auto max-w-5xl">
                        <AppDemo />
                    </div>
                </div>
            </section>

            <!-- Features -->
            <section id="features" class="mx-auto max-w-6xl px-5 py-20 sm:py-28">
                <div class="max-w-2xl">
                    <h2 class="text-3xl sm:text-4xl font-bold tracking-tight">One window instead of ten</h2>
                    <p class="mt-4 c-sub text-lg">
                        The usual setup is separate apps, none tied to a session — so several
                        servers at once means juggling windows and per-host tabs. Here every tool
                        belongs to its connection.
                    </p>
                </div>

                <div class="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <div class="reveal rounded-xl border border-[var(--surface0)] bg-[var(--base)] p-6 hover:border-[var(--surface1)] transition-colors">
                        <div class="text-[var(--blue)]"><ConnectionsIcon size="1.6em" /></div>
                        <h3 class="mt-4 font-semibold">Multiple sessions</h3>
                        <p class="mt-2 text-sm c-sub leading-relaxed">Connect to several hosts at once. Every terminal, file browser and Docker view belongs to its own session.</p>
                    </div>

                    <div class="reveal rounded-xl border border-[var(--surface0)] bg-[var(--base)] p-6 hover:border-[var(--surface1)] transition-colors">
                        <div class="text-[var(--mauve)] font-mono text-2xl leading-none">&gt;_</div>
                        <h3 class="mt-4 font-semibold">Terminal</h3>
                        <p class="mt-2 text-sm c-sub leading-relaxed">A real shell over SSH with a WebGL renderer (xterm.js). Open as many as you need.</p>
                    </div>

                    <div class="reveal rounded-xl border border-[var(--surface0)] bg-[var(--base)] p-6 hover:border-[var(--surface1)] transition-colors">
                        <div class="text-[var(--peach)]"><FolderIcon size="1.6em" /></div>
                        <h3 class="mt-4 font-semibold">Files over SFTP</h3>
                        <p class="mt-2 text-sm c-sub leading-relaxed">Browse directories, open a terminal in a folder, change permissions (chmod matrix, chown, recursive).</p>
                    </div>

                    <div class="reveal rounded-xl border border-[var(--surface0)] bg-[var(--base)] p-6 hover:border-[var(--surface1)] transition-colors">
                        <div class="text-[var(--green)]"><EditLinesIcon size="1.6em" /></div>
                        <h3 class="mt-4 font-semibold">Editor</h3>
                        <p class="mt-2 text-sm c-sub leading-relaxed">Edit remote files with syntax highlighting and save with <span class="font-mono text-xs">Ctrl+S</span>. No editor needed on the box.</p>
                    </div>

                    <div class="reveal rounded-xl border border-[var(--surface0)] bg-[var(--base)] p-6 hover:border-[var(--surface1)] transition-colors">
                        <div class="text-[var(--blue)]"><CubeIcon size="1.6em" /></div>
                        <h3 class="mt-4 font-semibold">Docker</h3>
                        <p class="mt-2 text-sm c-sub leading-relaxed">List, start, stop and remove containers and images over the SSH exec channel. Logs and <span class="font-mono text-xs">exec</span> open as terminal tabs.</p>
                    </div>

                    <div class="reveal rounded-xl border border-[var(--surface0)] bg-[var(--base)] p-6 hover:border-[var(--surface1)] transition-colors">
                        <div class="text-[var(--teal)]"><GlobusIcon size="1.6em" /></div>
                        <h3 class="mt-4 font-semibold">Tunnelled browser</h3>
                        <p class="mt-2 text-sm c-sub leading-relaxed">A browser whose traffic leaves only through the session's SSH tunnel — fail-closed, with UA and timezone matched to the host.</p>
                    </div>
                </div>
            </section>

            <!-- Client-side band -->
            <section class="border-y border-[var(--surface0)] bg-[var(--mantle)]">
                <div class="mx-auto max-w-6xl px-5 py-20 sm:py-24 grid lg:grid-cols-2 gap-12 items-center">
                    <div class="reveal">
                        <div class="text-[var(--peach)]"><BranchIcon size="1.7em" /></div>
                        <h2 class="mt-4 text-3xl sm:text-4xl font-bold tracking-tight">Client-side by design</h2>
                        <p class="mt-4 c-sub text-lg leading-relaxed">
                            The file browser, editor and Docker panel all run over the standard
                            SSH/SFTP channel. No agent, no exposed daemon socket, not even
                            <span class="font-mono text-[var(--text)]">vi</span> on the box — you edit
                            a config in a real editor and it saves back over SFTP.
                        </p>
                    </div>

                    <!-- little client → SSH → server diagram -->
                    <div class="reveal grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-center">
                        <div class="rounded-xl border border-[var(--surface0)] bg-[var(--base)] p-5">
                            <div class="font-mono text-2xl text-[var(--blue)]">&gt;_</div>
                            <div class="mt-2 text-sm font-medium">SSHtorm</div>
                            <div class="text-xs c-sub">your machine</div>
                        </div>
                        <div class="flex flex-col items-center text-xs c-sub">
                            <span class="font-mono text-[var(--green)]">SSH / SFTP</span>
                            <span class="my-1 w-16 border-t border-dashed border-[var(--surface1)]"></span>
                            <span>one channel</span>
                        </div>
                        <div class="rounded-xl border border-[var(--surface0)] bg-[var(--base)] p-5">
                            <div class="text-2xl">🖥️</div>
                            <div class="mt-2 text-sm font-medium">server</div>
                            <div class="text-xs c-sub">nothing installed</div>
                        </div>
                    </div>
                </div>
            </section>

            <!-- Security -->
            <section id="security" class="mx-auto max-w-6xl px-5 py-20 sm:py-28">
                <h2 class="text-3xl sm:text-4xl font-bold tracking-tight">Security</h2>
                <div class="mt-10 grid gap-4 md:grid-cols-3">
                    <div class="reveal rounded-xl border border-[var(--surface0)] bg-[var(--base)] p-6">
                        <div class="text-[var(--yellow)]"><KeyChainIcon size="1.6em" /></div>
                        <h3 class="mt-4 font-semibold">Host key pinning</h3>
                        <p class="mt-2 text-sm c-sub leading-relaxed">Keys are pinned on first connect (TOFU). A changed key drops the connection and asks before trusting the new one.</p>
                    </div>
                    <div class="reveal rounded-xl border border-[var(--surface0)] bg-[var(--base)] p-6">
                        <div class="text-[var(--mauve)]"><LockIcon size="1.6em" /></div>
                        <h3 class="mt-4 font-semibold">Encrypted vault</h3>
                        <p class="mt-2 text-sm c-sub leading-relaxed">Hosts, passwords and key fingerprints live in a single AES-256-GCM file behind a master password. Never in plaintext.</p>
                    </div>
                    <div class="reveal rounded-xl border border-[var(--surface0)] bg-[var(--base)] p-6">
                        <div class="text-[var(--teal)]"><GlobusIcon size="1.6em" /></div>
                        <h3 class="mt-4 font-semibold">Fail-closed browser</h3>
                        <p class="mt-2 text-sm c-sub leading-relaxed">Its only route is the SSH tunnel — no tunnel, no traffic. Local schemes and permission prompts are blocked.</p>
                    </div>
                </div>
            </section>

            <!-- Download CTA -->
            <section class="border-t border-[var(--surface0)]">
                <div class="mx-auto max-w-6xl px-5 py-20 sm:py-24 text-center">
                    <h2 class="text-3xl sm:text-4xl font-bold tracking-tight">Get SSHtorm</h2>
                    <p class="mt-4 c-sub">Free and open source. Builds for macOS and Windows.</p>
                    <div class="mt-8 flex flex-wrap items-center justify-center gap-3">
                        <a :href="RELEASES" class="rounded-lg bg-[var(--blue)] text-[var(--crust)] font-semibold px-5 py-2.5 hover:opacity-90 transition-opacity">Download for macOS</a>
                        <a :href="RELEASES" class="rounded-lg border border-[var(--surface1)] px-5 py-2.5 font-medium hover:bg-[var(--base)] transition-colors">Download for Windows</a>
                    </div>
                </div>
            </section>
        </main>

        <footer class="border-t border-[var(--surface0)]">
            <div class="mx-auto max-w-6xl px-5 py-10 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm c-sub">
                <span>Built with Electron, Vue and ssh2.</span>
                <a :href="REPO" class="inline-flex items-center gap-1.5 hover:text-[var(--text)] transition-colors">
                    <GitHubIcon size="1em" /> Source on GitHub
                </a>
            </div>
        </footer>
    </div>
</template>
