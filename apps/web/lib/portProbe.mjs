// Opens a connection to a mail server and reads its greeting line, nothing more:
// no login, no credentials. It answers one question, whether an outgoing mail
// port is reachable from where this code runs (a Vercel function).
import net from 'node:net';
import tls from 'node:tls';

// → { ok, ms, detail } where detail is the greeting line or the reason it failed
export function probePort(host, port, useTls, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = useTls ? tls.connect({ host, port, servername: host }) : net.connect({ host, port });
    const done = (ok, detail) => {
      socket.destroy();
      resolve({ ok, ms: Date.now() - started, detail });
    };
    socket.setTimeout(timeoutMs, () => done(false, 'timed out'));
    socket.once('error', (e) => done(false, e.code || 'connection failed'));
    socket.once('data', (buf) => done(true, String(buf).split('\r\n')[0].slice(0, 80)));
  });
}
