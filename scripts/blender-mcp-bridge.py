#!/usr/bin/env python3
"""MCP bridge to Blender Lab's OFFICIAL MCP add-on.

Josh installed Blender's own MCP add-on (maintainer "Blender Lab", from lab.blender.org),
while `~/.claude.json` was configured for the community server (`uvx blender-mcp`,
ahujasid/blender-mcp). Different projects that happen to share port 9876, and the community
server does not speak this add-on's protocol — a raw-JSON request gets NO REPLY AT ALL, so it
hangs rather than erroring, which is the worst way for a mismatch to present itself.

Written directly against the protocol rather than pulling in a third-party bridge. Established
by probing, then confirmed against the add-on's own source
(extensions/lab_blender_org/mcp/mcp_to_blender_server.py):

  · NULL-TERMINATED JSON in both directions.
  · {"type": "execute", "strict_json": true, "code": "..."} — `strict_json` AND `code` are BOTH
    TOP LEVEL. Putting the code inside `params` runs the empty string and returns a cheerful
    {"status": "ok", "result": {}}: success for having done nothing, which is the most
    misleading possible reply and took three probes to see through.
  · The code runs in a namespace pre-seeded with `result = {}`. Assign a DICT to `result` to
    return data; stdout and stderr come back when non-empty.
  · Assigning `check_is_finished` defers the reply for long jobs. Not used here.

WSL2: this machine has mirrored networking, so Windows' localhost is reachable from WSL
directly — no port forwarding, and no host IP to keep current. The previous BLENDER_HOST of
192.168.208.1 was both stale and unnecessary.

ONE TOOL, deliberately. `execute` is the add-on's only request type, so a suite of narrower
tools would be this same call with prompts wrapped around it: more surface, no more
capability, and one more place for the two sides to drift apart.
"""
import json
import os
import socket

from mcp.server.mcpserver import MCPServer

HOST = os.environ.get('BLENDER_HOST', '127.0.0.1')
PORT = int(os.environ.get('BLENDER_PORT', '9876'))
TIMEOUT = float(os.environ.get('BLENDER_TIMEOUT', '120'))

mcp = MCPServer('blender', instructions='Run Python inside a live Blender session.')


def _call(code: str) -> dict:
    s = socket.create_connection((HOST, PORT), timeout=TIMEOUT)
    try:
        s.sendall(json.dumps({'type': 'execute', 'strict_json': True, 'code': code}).encode() + b'\0')
        buf = b''
        while b'\0' not in buf:
            chunk = s.recv(1 << 20)
            if not chunk:
                break
            buf += chunk
        if not buf:
            return {'status': 'error', 'message': 'Blender closed the connection without replying.'}
        return json.loads(buf.split(b'\0')[0].decode('utf-8'))
    finally:
        s.close()


@mcp.tool()
def blender_execute(code: str) -> str:
    """Run Python inside the live Blender session and return its result.

    Assign a DICT to `result` to return data — the namespace is pre-seeded with `result = {}`
    and anything else is dropped. Values must be JSON-serialisable, so send `obj.name` rather
    than `obj`. print() output comes back as stdout.

    Example:
        import bpy
        result = {"objects": [o.name for o in bpy.data.objects]}
    """
    try:
        out = _call(code)
    except (OSError, socket.timeout) as ex:
        out = {
            'status': 'error',
            'message': (
                f'Could not reach Blender at {HOST}:{PORT} ({ex}). Is the add-on running? '
                'Blender → Edit → Preferences → Add-ons → MCP → Start MCP Server.'
            ),
        }
    return json.dumps(out, indent=2)


if __name__ == '__main__':
    mcp.run()
