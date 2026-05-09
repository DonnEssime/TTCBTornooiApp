import type { Plugin } from 'vite';

/**
 * When the dev server runs inside WSL but the browser runs on Windows, `http://localhost:5173`
 * relies on WSL localhost forwarding. If that path is broken, Windows shows ERR_CONNECTION_REFUSED
 * even though `curl http://127.0.0.1:5173` from inside WSL returns 200.
 */
export function wslDevHints(): Plugin {
  return {
    name: 'wsl-dev-hints',
    configureServer(server) {
      server.httpServer?.once('listening', () => {
        if (!process.env.WSL_DISTRO_NAME) return;
        console.log(
          '\n\x1b[33m[WSL]\x1b[0m If Windows/Edge shows \x1b[33mERR_CONNECTION_REFUSED\x1b[0m for localhost:5173 but this log says Vite is ready:\n' +
            '  \x1b[36m1)\x1b[0m Prefer \x1b[1mWSL networkingMode=mirrored\x1b[0m (Windows 11 22H2+): create/edit \x1b[1m%USERPROFILE%\\.wslconfig\x1b[0m:\n' +
            '       [wsl2]\n' +
            '       networkingMode=mirrored\n' +
            '     Then run: \x1b[1mwsl --shutdown\x1b[0m and reopen your terminal.\n' +
            '  \x1b[36m2)\x1b[0m Or use \x1b[1mVS Code / Cursor Remote-WSL\x1b[0m and open the Simple Browser / forwarded port from the WSL side.\n' +
            '  \x1b[36m3)\x1b[0m Or run \x1b[1mnpm run dev:web\x1b[0m from \x1b[1mWindows PowerShell\x1b[0m (Node on Windows) so the server binds the Windows network stack.\n' +
            '  \x1b[36m4)\x1b[0m Or run (Admin PowerShell): \x1b[1m.\\scripts\\Set-WslVitePortProxy.ps1\x1b[0m to forward 127.0.0.1:5173 to this WSL instance (re-run if WSL IP changes).\n' +
            '     See: https://learn.microsoft.com/windows/wsl/networking\n',
        );
      });
    },
  };
}
