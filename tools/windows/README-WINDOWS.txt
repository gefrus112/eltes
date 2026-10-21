Eltes AI for Windows
====================

Portable. No installer, no service, no registry writes, no admin rights.

QUICK START
-----------
1. Unzip this whole folder somewhere you can write to (Desktop, Documents, a USB stick).
2. Double-click "eltes.bat".
3. Your browser opens http://127.0.0.1:4173/app.html.
4. Open the Video editor tab to drop in a local clip or use a direct CORS-enabled
   video URL, change its look and playback speed, add a title, then export in your
   browser. Local source footage is not uploaded by the editor.
5. Close the console window (or press Ctrl+C) to stop the server.

The standard launcher keeps the local command runner disabled. To explicitly
opt in, open Command Prompt in this folder and run "eltes.bat --shell". This
requires Node.js 18 or newer. The server prints a one-time pairing token; enter
it under Terminal in Eltes. Never share this token. Restarting the server revokes
it. Each exact command requires browser approval.

REQUIREMENTS
------------
Windows 10 or 11 and either:
  - Python 3 (python.org), or
  - Node.js 18 or newer (nodejs.org)

The launcher uses Node.js for the local API when available, otherwise Python's
static server. The supervised command runner specifically requires Node.js.

WHAT THE LAUNCHER DOES
----------------------
- changes into its own folder
- finds Python or Node
- starts a local server bound to 127.0.0.1 only when Node.js is available;
  otherwise starts Python's static file server
- opens your default browser
- stops when you close the window

It is a plain text file. Open eltes.bat in Notepad and read it first.

OPTIONS
-------
  eltes.bat --port 8080      use another port (4173 is the default)
  eltes.bat --shortcut       add an "Eltes AI" Start-menu shortcut
  eltes.bat --no-browser     start the server without opening a tab
  eltes.bat --shell          opt in to the local command runner (Node.js required)
  eltes.bat --help           show the options

OFFLINE AND PRIVACY
-------------------
The launcher serves Eltes locally. With Node.js, its transient BYOK API routes
are also available; without Node.js, Python serves only the static files. Hosted
requests contact the provider you connect, or the Vercel backend if you configure
one in Eltes settings. If a port is busy, the launcher picks the next free one
and prints the URL.

LOCAL COMMAND RUNNER SECURITY
----------------------------
Execution is disabled by default. Only use "eltes.bat --shell" on a computer
you control and with Node.js 18 or newer. The terminal prints a one-time token;
enter it in Eltes' Terminal panel, and keep it private. Restart the server to
revoke the token. Browser approval is required for every exact command, but
commands run as your Windows account, are not sandboxed, and may access/change
files or make network requests. The server enforces loopback clients, same-origin
requests, a fixed starting directory, a 30-second time limit, and a 32 KiB output
limit. The starting directory is not a filesystem sandbox: commands can navigate
to and modify other locations allowed to your Windows account. Do not enable it
on a shared computer or expose the server to a network. Shell
support is unavailable on GitHub Pages and Vercel.

Chat history, settings and provider keys live in your browser's localStorage.
Replacing this folder with a newer build keeps them. Clearing site data removes
them, so export a backup first if a thread matters.

TROUBLESHOOTING
---------------
"No Python or Node"        Install Python 3 and tick "Add python.exe to PATH",
                           or install Node.js 18+.
Nothing opens              Start the launcher with --no-browser, then open the
                           printed URL yourself.
Browser blocks an API     Some providers refuse direct browser calls (CORS).
                           Use a provider that allows it, or a custom endpoint.
Firewall prompt            The server listens on 127.0.0.1 only. Denying public
                           network access is fine.

The source is publicly viewable, but reuse is governed by LICENSE. Third-party
components have their own terms in NOTICE.md.
