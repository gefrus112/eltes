Eltes AI for Windows
====================

Portable. No installer, no service, no registry writes, no admin rights.

QUICK START
-----------
1. Unzip this whole folder somewhere you can write to (Desktop, Documents, a USB stick).
2. Double-click "eltes.bat".
3. Your browser opens http://127.0.0.1:4173/app.html.
4. Close the console window (or press Ctrl+C) to stop the server.

REQUIREMENTS
------------
Windows 10 or 11 and either:
  - Python 3 (python.org), or
  - Node.js 18 or newer (nodejs.org)

The launcher uses whichever it finds. Nothing else is required.

WHAT THE LAUNCHER DOES
----------------------
- changes into its own folder
- finds Python or Node
- starts a static file server bound to 127.0.0.1 only
- opens your default browser
- stops when you close the window

It is a plain text file. Open eltes.bat in Notepad and read it first.

OPTIONS
-------
  eltes.bat --port 8080      use another port (4173 is the default)
  eltes.bat --shortcut       add an "Eltes AI" Start-menu shortcut
  eltes.bat --no-browser     start the server without opening a tab
  eltes.bat --help           show the options

OFFLINE AND PRIVACY
-------------------
The site is fully local: HTML, CSS, JavaScript and fonts. It contacts nothing
except the model provider you connect. If a port is busy, the launcher picks the
next free one and prints the URL.

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

Eltes is open source. See LICENSE and NOTICE.md in this folder.
