import { readFile, mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

function emptyState() {
  return { signatures: {}, invites: {}, lastInvitedAt: {} };
}

export function createFileStore(directory) {
  const stateFile = path.join(directory, 'signatures.json');
  let queue = Promise.resolve();

  async function read() {
    try {
      const state = JSON.parse(await readFile(stateFile, 'utf8'));
      return {
        signatures: state.signatures && typeof state.signatures === 'object' ? state.signatures : {},
        invites: state.invites && typeof state.invites === 'object' ? state.invites : {},
        lastInvitedAt: state.lastInvitedAt && typeof state.lastInvitedAt === 'object' ? state.lastInvitedAt : {},
      };
    } catch (error) {
      if (error.code === 'ENOENT') return emptyState();
      throw error;
    }
  }

  function update(mutator) {
    const next = queue.then(async () => {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const state = await read();
      const result = await mutator(state);
      const temporary = `${stateFile}.${process.pid}.tmp`;
      await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
      await rename(temporary, stateFile);
      return result;
    });
    queue = next.catch(() => {});
    return next;
  }

  return {
    async getSigners() {
      const state = await read();
      return Object.entries(state.signatures).map(([id, saved]) => ({ id, signedAt: saved.signedAt, method: saved.method }));
    },
    issueInvite({ signerId, hash, expiresAt, now }) {
      return update((state) => {
        if (state.signatures[signerId]) return 'signed';
        const previous = Date.parse(state.lastInvitedAt[signerId] || 0);
        if (now - previous < 60_000) return 'rate-limited';
        state.lastInvitedAt[signerId] = new Date(now).toISOString();
        state.invites[hash] = { signerId, createdAt: new Date(now).toISOString(), expiresAt, usedAt: null };
        return 'created';
      });
    },
    confirmInvite({ hash, strokes, now }) {
      return update((state) => {
        const invite = state.invites[hash];
        if (!invite || invite.usedAt || Date.parse(invite.expiresAt) <= now) return false;
        if (state.signatures[invite.signerId]) return false;
        invite.usedAt = new Date(now).toISOString();
        state.signatures[invite.signerId] = { method: 'email-link', signedAt: invite.usedAt, strokes };
        return true;
      });
    },
  };
}
